-- Migration 008: handoffs table for escalation audit trail
-- Tracks every human handoff event with trigger type, reason, and resolution details
-- Referenced by lib/handoff/trigger.ts (insert) and app/api/handoffs/[id]/resolve/route.ts (update)

CREATE TABLE IF NOT EXISTS handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  trigger_type text NOT NULL CHECK (trigger_type IN ('keyword', 'llm_tool', 'rag_score')),
  reason text,
  resolved_by uuid REFERENCES users(id),
  resolved_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE handoffs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON handoffs
  USING (tenant_id = auth_tenant_id());
