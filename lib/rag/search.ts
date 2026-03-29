import { embedText } from '@/lib/llm/client';
import { createServiceClient } from '@/lib/supabase/service';

// Default minimum cosine similarity score when tenant has no override configured.
const DEFAULT_RAG_SCORE_THRESHOLD = 0.5;

export interface RagChunk {
  id: string;
  sourceId: string;
  chunkIndex: number;
  content: string;
  score: number;
}

/**
 * Perform a semantic search over the knowledge base for a given tenant.
 *
 * SECURITY: tenantId filter is NON-NEGOTIABLE.
 * Executing this query without tenant isolation is a data leak.
 * Throws immediately if tenantId is empty or missing.
 *
 * Implementation:
 * - Generates a 1536-dim embedding via text-embedding-3-small (uses hydeQuery if provided)
 * - Calls a Supabase RPC `match_knowledge_chunks` that uses pgvector's `<=>` (cosine distance)
 * - Filters results to score >= threshold (cosine similarity, 0–1)
 * - Returns chunks ordered by score descending
 *
 * @param query     - The user's original message text (used for guard checks)
 * @param tenantId  - UUID of the tenant — REQUIRED, never empty
 * @param limit     - Maximum number of chunks to return (default 5)
 * @param threshold - Minimum cosine similarity score (0–1). Defaults to DEFAULT_RAG_SCORE_THRESHOLD
 * @param hydeQuery - Optional HyDE-transformed query to embed instead of the raw query
 * @returns Array of RagChunk with score >= threshold, ordered by relevance
 */
export async function semanticSearch(
  query: string,
  tenantId: string,
  limit = 5,
  threshold?: number,
  hydeQuery?: string
): Promise<RagChunk[]> {
  // ── MANDATORY TENANT GUARD ────────────────────────────────────────────────
  if (!tenantId || tenantId.trim() === '') {
    throw new Error('tenant_id required for vector search');
  }

  // Skip search if there is nothing to search for
  if (!query || query.trim() === '') {
    return [];
  }

  // ── Generate query embedding (HyDE: use hypothetical answer if provided) ───
  const embedding = await embedText(hydeQuery ?? query);

  // ── Execute pgvector cosine similarity search via Supabase RPC ────────────
  // The RPC `match_knowledge_chunks` is defined in the DB migration and accepts:
  //   query_embedding vector(1536)
  //   match_tenant_id uuid
  //   match_count     int
  //   match_threshold float (cosine similarity, 0–1)
  // Returns: id, source_id, chunk_index, content, similarity (1 - cosine_distance)
  const supabase = createServiceClient();

  // PostgREST does not auto-cast JSON arrays to vector(1536).
  // Passing as a bracketed string forces pgvector's text → vector cast.
  const embeddingString = `[${embedding.join(',')}]`;

  const { data, error } = await supabase.rpc('match_knowledge_chunks', {
    // PostgREST does not accept number[] for vector(1536); cast through unknown to string.
    query_embedding: embeddingString as unknown as string,
    match_tenant_id: tenantId,
    match_count: limit,
    match_threshold: threshold ?? DEFAULT_RAG_SCORE_THRESHOLD,
  });

  if (error) {
    throw new Error(`RAG vector search failed: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return [];
  }

  // ── Map RPC result to RagChunk ─────────────────────────────────────────────
  return data.map((row) => ({
    id: row.id,
    sourceId: row.source_id,
    chunkIndex: row.chunk_index,
    content: row.content,
    score: row.similarity,
  }));
}
