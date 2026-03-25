import OpenAI from 'openai';
import { getOpenAIClient } from '@/lib/llm/client';
import { createServiceClient } from '@/lib/supabase/service';
import type { RagChunk } from '@/lib/rag/search';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type ChatResponse =
  | { type: 'text'; content: string; tokensUsed: number; toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] | null }
  | { type: 'handoff'; reason: string; summary: string; tokensUsed: number };

interface TenantBotConfig {
  system_prompt: string;
  language: string;
  max_tokens: number;
}

// ─── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'escalate_to_human',
      description:
        'Escalar la conversación a un agente humano cuando el cliente lo solicita explícitamente, está frustrado, o el tema está fuera del dominio del bot.',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            enum: ['user_requested', 'out_of_domain', 'frustrated_user', 'complex_issue'],
            description: 'Motivo del handoff',
          },
          summary: {
            type: 'string',
            description: 'Resumen en 1-2 oraciones del problema del cliente para el agente humano',
          },
        },
        required: ['reason', 'summary'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_image_response',
      description: 'Enviar un archivo de imagen al cliente desde la knowledge base.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'URL pública de la imagen a enviar',
          },
          caption: {
            type: 'string',
            description: 'Texto acompañante para la imagen',
          },
        },
        required: ['url'],
      },
    },
  },
];

// ─── Public Functions ──────────────────────────────────────────────────────────

/**
 * Build the system prompt for the LLM, injecting tenant instructions and RAG context.
 *
 * @param tenant    - Tenant config from the database (bot_config field)
 * @param ragChunks - RAG search results to inject as knowledge context
 * @returns Formatted system prompt string
 */
export function buildSystemPrompt(tenant: TenantBotConfig, ragChunks: RagChunk[]): string {
  const lines: string[] = [];

  // Base instructions from tenant configuration
  if (tenant.system_prompt && tenant.system_prompt.trim().length > 0) {
    lines.push(tenant.system_prompt.trim());
    lines.push('');
  }

  // Language instruction
  lines.push(`Responde siempre en ${tenant.language ?? 'es'}.`);
  lines.push('');

  // Tool call instructions
  lines.push('## Herramientas disponibles');
  lines.push(
    '- Usa `escalate_to_human` cuando el cliente solicite hablar con un humano, esté frustrado, o el tema esté fuera de tu dominio.'
  );
  lines.push(
    '- Usa `send_image_response` cuando tengas una imagen relevante para responder la consulta.'
  );
  lines.push('');

  // RAG context injection
  if (ragChunks.length > 0) {
    lines.push('## Contexto de conocimiento relevante');
    lines.push('Usa la siguiente información para responder la consulta del cliente:');
    lines.push('');

    ragChunks.forEach((chunk, idx) => {
      lines.push(`### Fragmento ${idx + 1} (relevancia: ${(chunk.score * 100).toFixed(0)}%)`);
      lines.push(chunk.content.trim());
      lines.push('');
    });

    lines.push('Si el contexto de arriba no es suficiente para responder con precisión, usa `escalate_to_human`.');
  } else {
    lines.push('No hay contexto de conocimiento disponible para esta consulta.');
    lines.push('Si no puedes responder con confianza, usa `escalate_to_human`.');
  }

  return lines.join('\n');
}

/**
 * Retrieve the last N messages from a conversation, formatted for the OpenAI API.
 *
 * Fetches messages with direction 'inbound' (user) and 'outbound' (assistant),
 * ordered by created_at DESC, then reverses to get chronological order.
 *
 * @param conversationId - UUID of the conversation to fetch history for
 * @param limit          - Maximum number of messages to return (default 10)
 * @returns Array of ChatMessage in chronological order (oldest first)
 */
export async function getConversationHistory(
  conversationId: string,
  limit = 10
): Promise<ChatMessage[]> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('messages')
    .select('direction, content, llm_response')
    .eq('conversation_id', conversationId)
    .in('direction', ['inbound', 'outbound'])
    .not('content', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[chat][getConversationHistory] DB error:', error.message);
    // Return empty history rather than throwing — LLM can still respond without history
    return [];
  }

  if (!data || data.length === 0) {
    return [];
  }

  // Reverse to get chronological order (oldest first)
  const reversed = [...data].reverse();

  return reversed.map((msg) => {
    if (msg.direction === 'inbound') {
      return { role: 'user' as const, content: msg.content ?? '' };
    } else {
      // For outbound messages, prefer llm_response (what the LLM actually said)
      return { role: 'assistant' as const, content: msg.llm_response ?? msg.content ?? '' };
    }
  });
}

/**
 * Call GPT-4o-mini with Tool Calls enabled, handling handoff and text responses.
 *
 * If the LLM invokes `escalate_to_human`, returns a handoff response with reason and summary.
 * For normal text responses, returns the content with token usage.
 *
 * @param systemPrompt - Pre-built system prompt (from buildSystemPrompt)
 * @param history      - Previous conversation messages (from getConversationHistory)
 * @param userMessage  - The current user message text
 * @param tenantId     - Tenant ID for logging
 * @returns ChatResponse — either { type: 'text', content } or { type: 'handoff', reason }
 */
export async function chatWithTools(
  systemPrompt: string,
  history: ChatMessage[],
  userMessage: string,
  tenantId: string
): Promise<ChatResponse> {
  const client = getOpenAIClient();

  // Build the messages array: system + history + current user message
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userMessage },
  ];

  let completion: OpenAI.Chat.ChatCompletion;

  try {
    completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      tools: TOOLS,
      tool_choice: 'auto',
      max_tokens: 500,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[chat][chatWithTools] OpenAI API error tenant=${tenantId}: ${msg}`);
  }

  const choice = completion.choices[0];
  const tokensUsed = completion.usage?.total_tokens ?? 0;

  if (!choice) {
    throw new Error(`[chat][chatWithTools] Empty response from OpenAI tenant=${tenantId}`);
  }

  // ── Check for tool call invocations ────────────────────────────────────────
  const toolCalls = choice.message.tool_calls;

  if (toolCalls && toolCalls.length > 0) {
    // Find escalate_to_human tool call
    const handoffCall = toolCalls.find((tc) => tc.function.name === 'escalate_to_human');

    if (handoffCall) {
      let parsedArgs: { reason: string; summary: string } = {
        reason: 'complex_issue',
        summary: '',
      };

      try {
        parsedArgs = JSON.parse(handoffCall.function.arguments) as {
          reason: string;
          summary: string;
        };
      } catch {
        console.warn(
          `[chat][chatWithTools] Failed to parse escalate_to_human args tenant=${tenantId}`
        );
      }

      console.info(
        `[chat][chatWithTools] LLM invoked escalate_to_human reason=${parsedArgs.reason} tenant=${tenantId}`
      );

      return {
        type: 'handoff',
        reason: parsedArgs.reason,
        summary: parsedArgs.summary,
        tokensUsed,
      };
    }

    // Non-handoff tool calls (e.g. send_image_response) — return text with tool calls attached
    const textContent = choice.message.content ?? '';

    return {
      type: 'text',
      content: textContent,
      tokensUsed,
      toolCalls,
    };
  }

  // ── Normal text response ────────────────────────────────────────────────────
  const content = choice.message.content ?? '';

  if (!content.trim()) {
    console.warn(`[chat][chatWithTools] Empty text response from LLM tenant=${tenantId}`);
  }

  return {
    type: 'text',
    content,
    tokensUsed,
    toolCalls: null,
  };
}
