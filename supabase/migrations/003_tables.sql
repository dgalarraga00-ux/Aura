-- Migration: 003_tables
-- Description: Create all core tables for the WhatsApp SaaS multi-tenant platform
-- Reversible:
--   DROP TABLE IF EXISTS ingestion_jobs CASCADE;
--   DROP TABLE IF EXISTS knowledge_chunks CASCADE;
--   DROP TABLE IF EXISTS knowledge_sources CASCADE;
--   DROP TABLE IF EXISTS messages CASCADE;
--   DROP TABLE IF EXISTS conversations CASCADE;
--   DROP TABLE IF EXISTS contacts CASCADE;
--   DROP TABLE IF EXISTS users CASCADE;
--   DROP TABLE IF EXISTS tenants CASCADE;

-- TENANTS
CREATE TABLE tenants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  waba_id         TEXT NOT NULL,
  phone_number_id TEXT NOT NULL,
  -- access_token stored in Vault, referenced by vault_secret_id
  vault_secret_id UUID,
  is_active       BOOLEAN NOT NULL DEFAULT false,
  bot_config      JSONB NOT NULL DEFAULT '{
    "system_prompt": "",
    "handoff_keywords": [],
    "rag_score_threshold": 0.75,
    "language": "es",
    "max_tokens": 500
  }'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- USERS (operators and admins — linked to Supabase Auth)
CREATE TABLE users (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('saas_admin', 'tenant_admin', 'tenant_operator')),
  full_name   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CONTACTS (end customers of each tenant)
CREATE TABLE contacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone       TEXT NOT NULL, -- E.164 format
  name        TEXT,
  metadata    JSONB DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, phone)
);

-- CONVERSATIONS
CREATE TABLE conversations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id         UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  is_escalated       BOOLEAN NOT NULL DEFAULT false,
  escalated_at       TIMESTAMPTZ,
  escalation_trigger escalation_trigger_enum,
  resolved_at        TIMESTAMPTZ,
  resolved_by        UUID REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- MESSAGES
CREATE TABLE messages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id     UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_external_id TEXT NOT NULL UNIQUE, -- idempotency key (wa_msg_id)
  direction           message_direction_enum NOT NULL,
  message_type        message_type_enum NOT NULL,
  content             TEXT,          -- text or transcription
  media_url           TEXT,          -- Supabase Storage URL
  media_mime_type     TEXT,
  llm_response        TEXT,
  tool_calls          JSONB,         -- raw GPT tool calls
  rag_score           FLOAT,
  tokens_used         INTEGER,
  processing_ms       INTEGER,
  status              TEXT NOT NULL DEFAULT 'processing'
                        CHECK (status IN ('processing', 'sent', 'error', 'unsupported')),
  error               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- KNOWLEDGE SOURCES
CREATE TABLE knowledge_sources (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  source_type  TEXT NOT NULL CHECK (source_type IN ('pdf', 'url', 'csv', 'text')),
  storage_path TEXT,   -- Supabase Storage path (for pdf/csv)
  source_url   TEXT,   -- for URL scraping
  chunk_count  INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- KNOWLEDGE BASE CHUNKS (pgvector)
-- chunk_index is stored as a real column for the composite UNIQUE constraint
-- used by upsert ON CONFLICT (tenant_id, source_id, chunk_index) DO UPDATE
CREATE TABLE knowledge_chunks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_id   UUID NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  content     TEXT NOT NULL,
  embedding   vector(1536),
  metadata    JSONB DEFAULT '{}'::jsonb, -- page, chunk_index copy, source_type, etc.
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, source_id, chunk_index)
);

-- INGESTION JOBS
CREATE TABLE ingestion_jobs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_id    UUID NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  status       ingestion_status_enum NOT NULL DEFAULT 'pending',
  error        TEXT,
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
