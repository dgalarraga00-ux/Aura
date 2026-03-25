-- Migration: 002_enums
-- Description: Create domain enums for messages, escalations, and ingestion
-- Reversible:
--   DROP TYPE IF EXISTS ingestion_status_enum;
--   DROP TYPE IF EXISTS escalation_trigger_enum;
--   DROP TYPE IF EXISTS message_direction_enum;
--   DROP TYPE IF EXISTS message_type_enum;

CREATE TYPE message_type_enum AS ENUM (
  'text',
  'audio',
  'image',
  'video',
  'document',
  'unknown'
);

CREATE TYPE message_direction_enum AS ENUM (
  'inbound',
  'outbound'
);

CREATE TYPE escalation_trigger_enum AS ENUM (
  'keyword',
  'llm_tool',
  'rag_score'
);

CREATE TYPE ingestion_status_enum AS ENUM (
  'pending',
  'processing',
  'completed',
  'failed'
);
