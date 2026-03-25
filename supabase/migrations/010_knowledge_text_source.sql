-- Add raw_text column to knowledge_sources for free-text entries
-- (source_type = 'text' already exists in the CHECK constraint)
ALTER TABLE knowledge_sources
  ADD COLUMN IF NOT EXISTS raw_text TEXT;
