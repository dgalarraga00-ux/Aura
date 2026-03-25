import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getRedisClient } from '@/lib/redis/client';

/**
 * POST /api/handoffs/[id]/resolve
 *
 * Resolves a human handoff for a conversation. The [id] param is the conversation_id.
 *
 * Actions:
 * 1. Verify the caller is authenticated.
 * 2. Fetch the conversation to get tenant_id and contact phone (for Redis cleanup).
 * 3. Update conversations.is_escalated = false, resolved_at = now(), resolved_by = user.id.
 * 4. Delete Redis keys: conv:escalated:{tenantId}:{conversationId} and conv:escalated:phone:{tenantId}:{phone}
 * 5. Update handoffs record: resolved_by + resolved_at (if exists).
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id: conversationId } = await params;

  // ── 1. Authenticate caller ────────────────────────────────────────────────
  const supabaseUser = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabaseUser.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Fetch caller role and tenant_id
  const { data: userDataRaw, error: userError } = await supabaseUser
    .from('users')
    .select('role, tenant_id')
    .eq('id', user.id)
    .single();

  const userData = userDataRaw as { role: string; tenant_id: string | null } | null;

  if (userError || !userData) {
    return NextResponse.json({ error: 'User not found' }, { status: 403 });
  }

  // Use service client for writes (bypasses RLS for mutation operations)
  const supabase = createServiceClient();
  const redis = getRedisClient();

  // ── 2. Fetch conversation ─────────────────────────────────────────────────
  type ConvRow = {
    id: string;
    tenant_id: string;
    is_escalated: boolean;
    resolved_at: string | null;
    contact_id: string;
  };

  const { data: rawConversation, error: convError } = await supabase
    .from('conversations')
    .select('id, tenant_id, is_escalated, resolved_at, contact_id')
    .eq('id', conversationId)
    .single();

  const conversation = rawConversation as ConvRow | null;

  if (convError || !conversation) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
  }

  // Ensure the caller belongs to the same tenant (saas_admin can resolve any)
  if (
    userData.role !== 'saas_admin' &&
    userData.tenant_id !== conversation.tenant_id
  ) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!conversation.is_escalated || conversation.resolved_at) {
    return NextResponse.json({ error: 'Conversation is not escalated' }, { status: 400 });
  }

  // Fetch contact phone for Redis cleanup
  const { data: rawContact } = await supabase
    .from('contacts')
    .select('phone')
    .eq('id', conversation.contact_id)
    .single();
  const contact = rawContact as { phone: string } | null;

  const tenantId = conversation.tenant_id;
  const now = new Date().toISOString();

  // ── 3. Update conversation in DB ──────────────────────────────────────────
  const { error: updateError } = await supabase
    .from('conversations')
    .update({
      is_escalated: false,
      resolved_at: now,
      resolved_by: user.id,
    })
    .eq('id', conversationId)
    .eq('tenant_id', tenantId);

  if (updateError) {
    console.error('[handoffs][resolve] DB update failed:', updateError.message);
    return NextResponse.json({ error: 'Failed to resolve handoff' }, { status: 500 });
  }

  // ── 4. Delete Redis escalation keys ──────────────────────────────────────
  const convKey = `conv:escalated:${tenantId}:${conversationId}`;
  await redis.del(convKey);

  if (contact?.phone) {
    const phoneKey = `conv:escalated:phone:${tenantId}:${contact.phone}`;
    await redis.del(phoneKey);
  }

  // ── 5. Update handoffs record ─────────────────────────────────────────────
  try {
    const { error: handoffError } = await supabase
      .from('handoffs')
      .update({ resolved_by: user.id, resolved_at: now })
      .eq('conversation_id', conversationId)
      .is('resolved_at', null);
    if (handoffError) {
      console.warn('[handoffs][resolve] handoffs table update failed (non-fatal):', handoffError.message);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[handoffs][resolve] handoffs update threw unexpectedly (non-fatal):', msg);
  }

  console.info(
    `[handoffs][resolve] Resolved conversationId=${conversationId} by userId=${user.id}`
  );

  return NextResponse.json({ success: true });
}
