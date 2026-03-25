import { embedText } from '@/lib/llm/client';
import { createServiceClient } from '@/lib/supabase/service';

// Minimum cosine similarity score to include a chunk in results.
// Cosine distance (<=>) ranges 0–2; similarity = 1 - distance.
// score >= 0.75 means distance <= 0.25
const RAG_SCORE_THRESHOLD = 0.75;

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
 * - Generates a 1536-dim embedding of the query via text-embedding-3-small
 * - Calls a Supabase RPC `match_knowledge_chunks` that uses pgvector's `<=>` (cosine distance)
 * - Filters results to score >= 0.75 (cosine similarity, not distance)
 * - Returns chunks ordered by score descending
 *
 * @param query    - The user's message text to search for
 * @param tenantId - UUID of the tenant — REQUIRED, never empty
 * @param limit    - Maximum number of chunks to return (default 5)
 * @returns Array of RagChunk with score >= 0.75, ordered by relevance
 */
export async function semanticSearch(
  query: string,
  tenantId: string,
  limit = 5
): Promise<RagChunk[]> {
  // ── MANDATORY TENANT GUARD ────────────────────────────────────────────────
  if (!tenantId || tenantId.trim() === '') {
    throw new Error('tenant_id required for vector search');
  }

  // Skip search if there is nothing to search for
  if (!query || query.trim() === '') {
    return [];
  }

  // ── Generate query embedding ───────────────────────────────────────────────
  const embedding = await embedText(query);

  // ── Execute pgvector cosine similarity search via Supabase RPC ────────────
  // The RPC `match_knowledge_chunks` is defined in the DB migration and accepts:
  //   query_embedding vector(1536)
  //   match_tenant_id uuid
  //   match_count     int
  //   match_threshold float (cosine similarity, 0–1)
  // Returns: id, source_id, chunk_index, content, similarity (1 - cosine_distance)
  const supabase = createServiceClient();

  const { data, error } = await supabase.rpc('match_knowledge_chunks', {
    query_embedding: embedding,
    match_tenant_id: tenantId,
    match_count: limit,
    match_threshold: RAG_SCORE_THRESHOLD,
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
