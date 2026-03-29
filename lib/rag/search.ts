import { embedText } from '@/lib/llm/client';
import { createServiceClient } from '@/lib/supabase/service';

const DEFAULT_RAG_SCORE_THRESHOLD = 0.5;

export interface RagChunk {
  id: string;
  sourceId: string;
  chunkIndex: number;
  content: string;
  score: number;
}

interface MatchChunkRow {
  id: string;
  source_id: string;
  chunk_index: number;
  content: string;
  similarity: number;
}

interface ParentChunkRow {
  id: string;
  content: string;
}

/** Execute the pgvector cosine similarity RPC and return typed rows. */
async function executeVectorSearch(
  embeddingString: string,
  tenantId: string,
  limit: number,
  threshold: number,
  supabase: ReturnType<typeof createServiceClient>
): Promise<MatchChunkRow[]> {
  // PostgREST does not auto-cast number[] to vector(1536). Pass as bracketed string
  // so pgvector's text→vector cast fires. Cast through unknown to satisfy type checker.
  const { data, error } = await supabase.rpc('match_knowledge_chunks', {
    query_embedding: embeddingString as unknown as number[],
    match_tenant_id: tenantId,
    match_count: limit,
    match_threshold: threshold,
  });
  if (error) throw new Error(`RAG vector search failed: ${error.message}`);
  return (data as MatchChunkRow[] | null) ?? [];
}

/**
 * Replace each child chunk's content with its parent chunk content (if any).
 * Parents (~1000 chars) provide richer LLM context than children (~250 chars).
 * Child score is preserved for ranking. Falls back to child content on any error.
 * SECURITY: tenant_id is enforced inside the get_parent_chunk RPC.
 */
async function enrichWithParentContent(
  chunks: RagChunk[],
  tenantId: string,
  supabase: ReturnType<typeof createServiceClient>
): Promise<RagChunk[]> {
  return Promise.all(
    chunks.map(async (chunk) => {
      try {
        const { data } = await supabase.rpc('get_parent_chunk', {
          p_chunk_id: chunk.id,
          p_tenant_id: tenantId,
        });
        const parent = (data as ParentChunkRow[] | null)?.[0];
        if (!parent?.content) return chunk;
        return { ...chunk, content: parent.content };
      } catch {
        return chunk;
      }
    })
  );
}

/**
 * Semantic search over the tenant's knowledge base.
 *
 * SECURITY: tenantId filter is NON-NEGOTIABLE. Throws if empty.
 *
 * @param query     - User's original message (used for guard + fallback embedding)
 * @param tenantId  - UUID of the tenant — REQUIRED, never empty
 * @param limit     - Max chunks to return (default 5)
 * @param threshold - Min cosine similarity 0–1 (default DEFAULT_RAG_SCORE_THRESHOLD)
 * @param hydeQuery - Optional HyDE-transformed query to embed instead of raw query
 */
export async function semanticSearch(
  query: string,
  tenantId: string,
  limit = 5,
  threshold?: number,
  hydeQuery?: string
): Promise<RagChunk[]> {
  if (!tenantId || tenantId.trim() === '') throw new Error('tenant_id required for vector search');
  if (!query || query.trim() === '') return [];

  const embedding = await embedText(hydeQuery ?? query);
  const embeddingString = `[${embedding.join(',')}]`;
  const supabase = createServiceClient();

  const rows = await executeVectorSearch(
    embeddingString, tenantId, limit, threshold ?? DEFAULT_RAG_SCORE_THRESHOLD, supabase
  );
  if (rows.length === 0) return [];

  const childChunks: RagChunk[] = rows.map((row) => ({
    id: row.id,
    sourceId: row.source_id,
    chunkIndex: row.chunk_index,
    content: row.content,
    score: row.similarity,
  }));

  return enrichWithParentContent(childChunks, tenantId, supabase);
}
