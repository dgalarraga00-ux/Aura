-- Migration: 006_triggers
-- Description: Auto-update updated_at timestamps via triggers
-- Reversible:
--   DROP TRIGGER IF EXISTS conversations_updated_at ON conversations;
--   DROP TRIGGER IF EXISTS tenants_updated_at ON tenants;
--   DROP FUNCTION IF EXISTS update_updated_at();

-- Generic updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to tenants
CREATE TRIGGER tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Apply to conversations
CREATE TRIGGER conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
