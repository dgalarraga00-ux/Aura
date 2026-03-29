import { getOpenAIClient } from '@/lib/llm/client';

export interface HydeOptions {
  language?: string;
  maxTokens?: number;
}

/**
 * Hypothetical Document Embedding (HyDE) query transform.
 *
 * Generates a short hypothetical answer to the query using gpt-4o-mini,
 * then returns it for embedding. A hypothetical answer produces a more
 * semantically similar vector to actual knowledge base chunks than the
 * raw question does.
 *
 * FALLBACK: On any error, silently returns the original query so the
 * RAG pipeline is never blocked by this step.
 */
export async function hydeTransform(query: string, options: HydeOptions = {}): Promise<string> {
  if (!query.trim()) return query;

  const { language = 'es', maxTokens = 150 } = options;
  const langNote = language === 'en'
    ? 'Answer in English.'
    : 'Responde en español.';

  try {
    const client = getOpenAIClient();
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: maxTokens,
      messages: [
        {
          role: 'system',
          content: `Write a short factual answer as if from a business knowledge base. ${langNote} Be concise.`,
        },
        { role: 'user', content: query },
      ],
    });
    const hypothetical = response.choices[0]?.message?.content?.trim();
    return hypothetical ? hypothetical : query;
  } catch {
    // Silent fallback — never block the pipeline
    return query;
  }
}
