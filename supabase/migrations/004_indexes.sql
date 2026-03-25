-- Migration: 004_indexes
-- Description: Create performance indexes including HNSW for vector search
-- Reversible:
--   DROP INDEX IF EXISTS idx_messages_tenant_created;
--   DROP INDEX IF EXISTS idx_messages_conversation;
--   DROP INDEX IF EXISTS idx_conversations_tenant_escalated;
--   DROP INDEX IF EXISTS idx_knowledge_chunks_tenant;
--   DROP INDEX IF EXISTS idx_knowledge_chunks_hnsw;

-- HNSW index for cosine similarity vector search
-- m=16 and ef_construction=64 are good defaults for most datasets
CREATE INDEX idx_knowledge_chunks_hnsw ON knowledge_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Tenant filter index for vector searches (used alongside HNSW)
CREATE INDEX idx_knowledge_chunks_tenant ON knowledge_chunks(tenant_id);

-- Conversations: filter escalated by tenant (handoff inbox)
CREATE INDEX idx_conversations_tenant_escalated ON conversations(tenant_id, is_escalated);

-- Messages: thread view (ordered by date within a conversation)
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at DESC);

-- Messages: tenant analytics (messages per day queries)
CREATE INDEX idx_messages_tenant_created ON messages(tenant_id, created_at DESC);
