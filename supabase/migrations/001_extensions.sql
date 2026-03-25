-- Migration: 001_extensions
-- Description: Enable required PostgreSQL extensions
-- Reversible: DROP EXTENSION IF EXISTS pg_net; DROP EXTENSION IF EXISTS vector;

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_net;
