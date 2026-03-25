-- Migration 007: RPC function for pgvector semantic search
-- Used by lib/rag/search.ts to perform cosine similarity search over knowledge_chunks
-- Returns chunks ordered by cosine similarity descending, filtered by tenant and threshold

CREATE OR REPLACE FUNCTION match_knowledge_chunks(
  query_embedding vector(1536),
  match_tenant_id uuid,
  match_count int DEFAULT 5,
  match_threshold float DEFAULT 0.75
)
RETURNS TABLE (id uuid, source_id uuid, chunk_index int, content text, similarity float)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT kc.id, kc.source_id, kc.chunk_index, kc.content,
    1 - (kc.embedding <=> query_embedding) AS similarity
  FROM knowledge_chunks kc
  WHERE kc.tenant_id = match_tenant_id
    AND 1 - (kc.embedding <=> query_embedding) >= match_threshold
  ORDER BY kc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
