import { SupabaseClient } from '@supabase/supabase-js';
import { semanticSearch, type RagChunk } from '@/lib/rag/search';
import { hydeTransform } from '@/lib/rag/hyde';
import { rerankChunks } from '@/lib/rag/reranker';
import { getRedisClient, ragScoreCounterKey } from '@/lib/redis/client';
import { sendTextMessage } from '@/lib/meta/api';
import { buildSystemPrompt, getConversationHistory, chatWithTools, type ChatMessage } from '@/lib/llm/chat';
import { triggerHandoff } from '@/lib/handoff/trigger';

// ─── Shared Types ──────────────────────────────────────────────────────────────

export interface BotConfig {
  system_prompt: string;
  handoff_keywords: string[];
  rag_score_threshold: number;
  language: string;
  max_tokens: number;
}

export interface TenantRow {
  phone_number_id: string | null;
  vault_secret_id: string | null;
  bot_config: BotConfig;
}

// ─── RAG Search ────────────────────────────────────────────────────────────────

export interface RagResult {
  chunks: RagChunk[];
  score: number;
  handoffTriggered: boolean;
}

export async function runRagSearch(
  supabase: SupabaseClient,
  effectiveText: string,
  tenantId: string,
  conversationId: string,
  contactPhone: string,
  messageExternalId: string,
  botConfig: BotConfig
): Promise<RagResult> {
  const hydeQuery = await hydeTransform(effectiveText, { language: botConfig.language });
  const rawChunks = await semanticSearch(effectiveText, tenantId, 5, botConfig.rag_score_threshold ?? 0.5, hydeQuery);
  const chunks = rawChunks.length > 0 ? await rerankChunks(effectiveText, rawChunks) : rawChunks;
  const score = chunks[0]?.score ?? 0;
  const redis = getRedisClient();
  const counterKey = ragScoreCounterKey(conversationId);

  if (chunks.length === 0) {
    const count = await redis.incr(counterKey);
    await redis.expire(counterKey, 3600);
    console.info(`[pipeline][RAG] No chunks msgId=${messageExternalId} lowScoreCount=${count}`);
    if (count >= 3) {
      console.warn(`[pipeline][RAG] 3 consecutive low-score — triggering handoff conv=${conversationId}`);
      await redis.del(counterKey);
      await triggerHandoff(conversationId, tenantId, 'rag_score_below_threshold_3_consecutive', 'rag_score', contactPhone, effectiveText.substring(0, 100));
      await supabase.from('messages').update({ status: 'sent', rag_score: score }).eq('message_external_id', messageExternalId).eq('tenant_id', tenantId);
      return { chunks, score, handoffTriggered: true };
    }
  } else {
    await redis.del(counterKey);
    console.info(`[pipeline][RAG] Found ${chunks.length} chunks msgId=${messageExternalId} topScore=${score.toFixed(3)}`);
  }

  await supabase.from('messages').update({ rag_score: score }).eq('message_external_id', messageExternalId).eq('tenant_id', tenantId);
  return { chunks, score, handoffTriggered: false };
}

// ─── LLM Response ──────────────────────────────────────────────────────────────

async function persistHandoffResponse(
  supabase: SupabaseClient,
  conversationId: string,
  tenantId: string,
  contactPhone: string,
  messageExternalId: string,
  effectiveText: string,
  reason: string,
  summary: string,
  tokensUsed: number,
  startTime: number
): Promise<void> {
  await triggerHandoff(conversationId, tenantId, reason, 'llm_tool', contactPhone, effectiveText.substring(0, 100));
  await supabase.from('messages').update({
    tool_calls: [{ name: 'escalate_to_human', reason, summary }],
    tokens_used: tokensUsed,
    processing_ms: Date.now() - startTime,
    status: 'sent',
  }).eq('message_external_id', messageExternalId).eq('tenant_id', tenantId);
}

async function persistTextResponse(
  supabase: SupabaseClient,
  tenantId: string,
  conversationId: string,
  messageExternalId: string,
  llmText: string,
  toolCalls: unknown,
  tokensUsed: number,
  startTime: number
): Promise<void> {
  const processingMs = Date.now() - startTime;
  await supabase.from('messages').insert({
    tenant_id: tenantId, conversation_id: conversationId,
    message_external_id: `${messageExternalId}:response`,
    direction: 'outbound' as const, message_type: 'text' as const,
    content: llmText, llm_response: llmText, status: 'sent' as const,
  });
  await supabase.from('messages').update({
    llm_response: llmText,
    tool_calls: toolCalls ? JSON.parse(JSON.stringify(toolCalls)) : null,
    tokens_used: tokensUsed, processing_ms: processingMs, status: 'sent',
  }).eq('message_external_id', messageExternalId).eq('tenant_id', tenantId);
  console.info(`[pipeline] Complete msgId=${messageExternalId} processingMs=${processingMs} tokensUsed=${tokensUsed}`);
}

export async function persistAndSendLlmResponse(
  supabase: SupabaseClient,
  tenant: TenantRow,
  tenantId: string,
  conversationId: string,
  contactPhone: string,
  messageExternalId: string,
  effectiveText: string,
  accessToken: string | null,
  botConfig: BotConfig,
  ragChunks: RagChunk[],
  history: ChatMessage[],
  startTime: number
): Promise<void> {
  const systemPrompt = buildSystemPrompt(botConfig, ragChunks);
  const chatResponse = await chatWithTools(systemPrompt, history, effectiveText, tenantId);
  const tokensUsed = chatResponse.tokensUsed;
  if (chatResponse.type === 'handoff') {
    console.info(`[pipeline] LLM escalate_to_human reason=${chatResponse.reason} msgId=${messageExternalId}`);
    await persistHandoffResponse(supabase, conversationId, tenantId, contactPhone, messageExternalId, effectiveText, chatResponse.reason, chatResponse.summary, tokensUsed, startTime);
    return;
  }
  const llmText = chatResponse.content;
  if (llmText && llmText.trim().length > 0 && accessToken && tenant.phone_number_id) {
    await sendTextMessage(tenant.phone_number_id, contactPhone, llmText, accessToken);
    console.info(`[pipeline] Meta send done msgId=${messageExternalId} chars=${llmText.length}`);
  }
  await persistTextResponse(supabase, tenantId, conversationId, messageExternalId, llmText, chatResponse.toolCalls, tokensUsed, startTime);
}

// ─── Combined RAG + LLM Stage ──────────────────────────────────────────────────

export type RagLlmResult = { type: 'ok' } | { type: 'handoff'; trigger: 'rag_score' } | { type: 'skip' };

export async function runRagAndLlm(
  supabase: SupabaseClient,
  effectiveText: string,
  tenantId: string,
  conversationId: string,
  contactPhone: string,
  messageExternalId: string,
  botConfig: BotConfig,
  tenant: TenantRow,
  accessToken: string | null,
  startTime: number
): Promise<RagLlmResult> {
  if (!effectiveText.trim()) {
    await supabase.from('messages').update({ status: 'sent', processing_ms: Date.now() - startTime }).eq('message_external_id', messageExternalId).eq('tenant_id', tenantId);
    return { type: 'skip' };
  }

  let ragChunks: RagChunk[] = [];
  try {
    const ragResult = await runRagSearch(supabase, effectiveText, tenantId, conversationId, contactPhone, messageExternalId, botConfig);
    if (ragResult.handoffTriggered) {
      await supabase.from('messages').update({ processing_ms: Date.now() - startTime }).eq('message_external_id', messageExternalId).eq('tenant_id', tenantId);
      return { type: 'handoff', trigger: 'rag_score' };
    }
    ragChunks = ragResult.chunks;
  } catch (ragErr) {
    console.error(`[pipeline][RAG] Search failed msgId=${messageExternalId}: ${ragErr instanceof Error ? ragErr.message : String(ragErr)}`);
  }

  const history: ChatMessage[] = await getConversationHistory(conversationId);
  await persistAndSendLlmResponse(supabase, tenant, tenantId, conversationId, contactPhone, messageExternalId, effectiveText, accessToken, botConfig, ragChunks, history, startTime);
  return { type: 'ok' };
}
