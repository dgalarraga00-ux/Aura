-- Migration 011: parent-child chunk support
-- Adds parent_chunk_id and chunk_type to knowledge_chunks.
-- Existing rows are backfilled as chunk_type = 'child' (fully backward compatible).

ALTER TABLE knowledge_chunks
  ADD COLUMN IF NOT EXISTS parent_chunk_id uuid REFERENCES knowledge_chunks(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS chunk_type text NOT NULL DEFAULT 'child';

-- Index for filtering by type — used in match_knowledge_chunks RPC
CREATE INDEX IF NOT EXISTS knowledge_chunks_tenant_type_idx
  ON knowledge_chunks (tenant_id, chunk_type);

-- Update match_knowledge_chunks to search only child chunks.
-- Parents have no embedding, so restricting to 'child' is both correct and required.
CREATE OR REPLACE FUNCTION match_knowledge_chunks(
  query_embedding vector(1536),
  match_tenant_id uuid,
  match_count int DEFAULT 5,
  match_threshold float DEFAULT 0.5
)
RETURNS TABLE (
  id uuid,
  source_id uuid,
  chunk_index int,
  content text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    kc.id,
    kc.source_id,
    kc.chunk_index,
    kc.content,
    1 - (kc.embedding <=> query_embedding) AS similarity
  FROM knowledge_chunks kc
  WHERE kc.tenant_id = match_tenant_id
    AND kc.chunk_type = 'child'
    AND 1 - (kc.embedding <=> query_embedding) >= match_threshold
  ORDER BY kc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- RPC: fetch the parent chunk for a given child chunk.
-- SECURITY: tenant_id filter on BOTH child and parent rows is mandatory.
CREATE OR REPLACE FUNCTION get_parent_chunk(
  p_chunk_id uuid,
  p_tenant_id uuid
)
RETURNS TABLE (
  id uuid,
  content text
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT p.id, p.content
  FROM knowledge_chunks c
  JOIN knowledge_chunks p ON p.id = c.parent_chunk_id
  WHERE c.id = p_chunk_id
    AND c.tenant_id = p_tenant_id
    AND p.tenant_id = p_tenant_id;
END;
$$;
