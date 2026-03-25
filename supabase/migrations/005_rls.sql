-- Migration: 005_rls
-- Description: Enable Row Level Security on all tenant tables with helper functions
-- Reversible:
--   DROP POLICY IF EXISTS ... (all policies below)
--   DROP FUNCTION IF EXISTS auth_role();
--   DROP FUNCTION IF EXISTS auth_tenant_id();
--   ALTER TABLE ... DISABLE ROW LEVEL SECURITY; (all tables)

-- Enable RLS on all tenant-scoped tables
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingestion_jobs ENABLE ROW LEVEL SECURITY;

-- Helper: resolve tenant_id of the authenticated user
-- SECURITY DEFINER allows reading users table with elevated privileges
CREATE OR REPLACE FUNCTION auth_tenant_id()
RETURNS UUID AS $$
  SELECT tenant_id FROM users WHERE id = auth.uid()
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Helper: resolve role of the authenticated user
CREATE OR REPLACE FUNCTION auth_role()
RETURNS TEXT AS $$
  SELECT role FROM users WHERE id = auth.uid()
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- TENANTS: saas_admin sees all; tenant users see only their own
CREATE POLICY tenants_select ON tenants
  FOR SELECT USING (
    auth_role() = 'saas_admin' OR id = auth_tenant_id()
  );

CREATE POLICY tenants_update ON tenants
  FOR UPDATE USING (
    auth_role() IN ('saas_admin', 'tenant_admin')
    AND (auth_role() = 'saas_admin' OR id = auth_tenant_id())
  );

-- USERS: saas_admin sees all; users see only their tenant's users
CREATE POLICY users_select ON users
  FOR SELECT USING (
    auth_role() = 'saas_admin' OR tenant_id = auth_tenant_id()
  );

CREATE POLICY users_update ON users
  FOR UPDATE USING (
    auth_role() = 'saas_admin'
    OR (tenant_id = auth_tenant_id() AND auth_role() = 'tenant_admin')
  );

-- CONTACTS: full tenant isolation
CREATE POLICY contacts_tenant ON contacts
  FOR ALL USING (
    tenant_id = auth_tenant_id() OR auth_role() = 'saas_admin'
  );

-- CONVERSATIONS: full tenant isolation
CREATE POLICY conversations_tenant ON conversations
  FOR ALL USING (
    tenant_id = auth_tenant_id() OR auth_role() = 'saas_admin'
  );

-- MESSAGES: full tenant isolation
CREATE POLICY messages_tenant ON messages
  FOR ALL USING (
    tenant_id = auth_tenant_id() OR auth_role() = 'saas_admin'
  );

-- KNOWLEDGE_CHUNKS: full tenant isolation
CREATE POLICY knowledge_chunks_tenant ON knowledge_chunks
  FOR ALL USING (
    tenant_id = auth_tenant_id() OR auth_role() = 'saas_admin'
  );

-- KNOWLEDGE_SOURCES: full tenant isolation
CREATE POLICY knowledge_sources_tenant ON knowledge_sources
  FOR ALL USING (
    tenant_id = auth_tenant_id() OR auth_role() = 'saas_admin'
  );

-- INGESTION_JOBS: full tenant isolation
CREATE POLICY ingestion_jobs_tenant ON ingestion_jobs
  FOR ALL USING (
    tenant_id = auth_tenant_id() OR auth_role() = 'saas_admin'
  );

-- NOTE: The worker and webhook routes use the service_role key which bypasses RLS.
-- This is intentional — server-side routes are trusted and must use service_role ONLY.
