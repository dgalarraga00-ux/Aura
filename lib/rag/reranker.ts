import { getOpenAIClient } from '@/lib/llm/client';
import type { RagChunk } from '@/lib/rag/search';

const RERANKER_SYSTEM_PROMPT =
  'You are a relevance judge. Given a question and numbered passages, reply ONLY with ' +
  'the numbers of the most relevant passages in order, comma-separated. Example: 3,1,2';

function buildUserPrompt(query: string, chunks: RagChunk[], topN: number): string {
  const numbered = chunks
    .map((c, i) => `[${i + 1}] ${c.content.substring(0, 300)}`)
    .join('\n\n');
  return `Question: ${query}\n\nPassages:\n${numbered}\n\nMost relevant passage numbers (up to ${topN}):`;
}

function parseIndices(raw: string, maxIndex: number): number[] {
  return raw
    .split(',')
    .map((s) => parseInt(s.trim(), 10) - 1)
    .filter((i) => !isNaN(i) && i >= 0 && i < maxIndex);
}

/**
 * LLM-based reranker using gpt-4o-mini.
 *
 * After vector search returns top-K candidates, the reranker asks the LLM
 * which chunks are actually most relevant to the query. Works for both
 * service-based content (small businesses) and product catalogs (large tenants).
 *
 * FALLBACK: On any error, silently returns the original chunks sliced to topN.
 */
export async function rerankChunks(query: string, chunks: RagChunk[], topN = 3): Promise<RagChunk[]> {
  if (chunks.length === 0) return chunks;
  if (chunks.length <= topN) return chunks;

  try {
    const client = getOpenAIClient();
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 100,
      messages: [
        { role: 'system', content: RERANKER_SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(query, chunks, topN) },
      ],
    });
    const raw = response.choices[0]?.message?.content?.trim() ?? '';
    const indices = parseIndices(raw, chunks.length);
    if (indices.length === 0) return chunks.slice(0, topN);
    return indices.slice(0, topN).map((i) => chunks[i]);
  } catch {
    // Silent fallback — never block the pipeline
    return chunks.slice(0, topN);
  }
}
