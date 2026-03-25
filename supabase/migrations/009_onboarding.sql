-- Migration: 009_onboarding
-- Description: Add onboarding fields to tenants table
--   - onboarding_completed: tracks whether the tenant has finished WABA setup
--   - webhook_verify_token: tenant-specific token for Meta webhook verification
--   - Make waba_id, phone_number_id nullable so a tenant row can be created at
--     registration time (before onboarding) and populated during setup
-- Reversible:
--   ALTER TABLE tenants DROP COLUMN IF EXISTS onboarding_completed;
--   ALTER TABLE tenants DROP COLUMN IF EXISTS webhook_verify_token;
--   ALTER TABLE tenants ALTER COLUMN waba_id SET NOT NULL;
--   ALTER TABLE tenants ALTER COLUMN phone_number_id SET NOT NULL;

-- Allow tenant row to exist before WABA credentials are provided
ALTER TABLE tenants ALTER COLUMN waba_id DROP NOT NULL;
ALTER TABLE tenants ALTER COLUMN phone_number_id DROP NOT NULL;

-- Track whether the tenant has completed onboarding
ALTER TABLE tenants
  ADD COLUMN onboarding_completed BOOLEAN NOT NULL DEFAULT false;

-- Per-tenant webhook verification token (set during onboarding)
ALTER TABLE tenants
  ADD COLUMN webhook_verify_token TEXT;

-- RPC wrapper: exposes vault.create_secret to the service_role via PostgREST.
-- Only callable with the service_role key (SECURITY DEFINER runs as the function owner).
-- Returns the UUID of the newly created vault secret.
CREATE OR REPLACE FUNCTION create_vault_secret(p_secret TEXT, p_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, public
AS $$
DECLARE
  v_id UUID;
BEGIN
  SELECT vault.create_secret(p_secret, p_name) INTO v_id;
  RETURN v_id;
END;
$$;

-- Revoke from public, grant only to service_role
REVOKE ALL ON FUNCTION create_vault_secret(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_vault_secret(TEXT, TEXT) TO service_role;
