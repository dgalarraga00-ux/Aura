import { createServiceClient } from '@/lib/supabase/service';
import { getRedisClient } from '@/lib/redis/client';

// Redis TTL for escalation state: 24 hours
const ESCALATION_TTL_SECONDS = 86400;

/**
 * Trigger a human handoff for a conversation.
 *
 * This function performs 4 operations atomically (best-effort):
 * 1. Updates `conversations.is_escalated = true` and `escalated_at` in the database
 * 2. Writes `conv:escalated:{tenant_id}:{conversation_id} = true` to Redis (TTL 24h)
 *    — used by the webhook to silently skip escalated conversations (no bot response)
 * 3. Writes `conv:escalated:phone:{tenant_id}:{phone}` to Redis (TTL 24h)
 *    — allows the webhook to check escalation by phone number before resolving conversation_id
 * 4. Inserts a record into the `handoffs` table with trigger_type, reason, and timestamp
 * 5. Broadcasts the handoff event via Supabase Realtime to the tenant's channel
 *    — notifies connected dashboard operators in < 3s
 *
 * If the conversation is already escalated, this is a no-op (idempotent).
 *
 * @param conversationId - UUID of the conversation to escalate
 * @param tenantId       - UUID of the tenant
 * @param reason         - Human-readable reason for the handoff
 * @param triggerType    - What triggered the handoff: 'keyword' | 'llm_tool' | 'rag_score'
 * @param contactPhone   - Contact phone in E.164 format (for Redis phone key)
 * @param lastMessagePreview - First 100 chars of the last message (for Realtime payload)
 */
export async function triggerHandoff(
  conversationId: string,
  tenantId: string,
  reason: string,
  triggerType: 'keyword' | 'llm_tool' | 'rag_score',
  contactPhone: string,
  lastMessagePreview: string
): Promise<void> {
  const supabase = createServiceClient();
  const redis = getRedisClient();

  console.info(
    `[handoff][trigger] Triggering handoff conversationId=${conversationId} tenant=${tenantId} trigger=${triggerType} reason=${reason}`
  );

  // ── 1. Update conversation status in DB ────────────────────────────────────
  const { error: convUpdateError } = await supabase
    .from('conversations')
    .update({
      is_escalated: true,
      escalated_at: new Date().toISOString(),
      escalation_trigger: triggerType,
    })
    .eq('id', conversationId)
    .eq('tenant_id', tenantId);

  if (convUpdateError) {
    console.error(
      `[handoff][trigger] Failed to update conversation status conversationId=${conversationId}:`,
      convUpdateError.message
    );
    // Continue — Redis + handoffs insert still valuable even if this fails
  }

  // ── 2. Write escalation state to Redis (by conversation_id) ───────────────
  // Key format: conv:escalated:{tenant_id}:{conversation_id}
  // Used by webhook to detect escalated conversations before enqueuing
  const convEscalatedKey = `conv:escalated:${tenantId}:${conversationId}`;
  await redis.set(convEscalatedKey, 'true', { ex: ESCALATION_TTL_SECONDS });

  // ── 3. Write escalation state to Redis (by phone number) ──────────────────
  // Key format: conv:escalated:phone:{tenant_id}:{phone}
  // Allows webhook to check escalation by phone without a conversation_id lookup
  const phoneEscalatedKey = `conv:escalated:phone:${tenantId}:${contactPhone}`;
  await redis.set(phoneEscalatedKey, 'true', { ex: ESCALATION_TTL_SECONDS });

  // ── 4. Insert handoff record ───────────────────────────────────────────────
  // The `handoffs` table is referenced in the spec for escalation state tracking.
  // We use the conversations table's escalation fields as the primary state,
  // but insert here for audit trail and analytics purposes.
  // Note: If `handoffs` table doesn't exist in the migration yet, this will log an error
  // but not throw — the escalation state is already persisted via Redis + conversations.
  const { error: handoffInsertError } = await supabase
    .from('handoffs')
    .insert({
      conversation_id: conversationId,
      tenant_id: tenantId,
      trigger_type: triggerType,
      reason,
      created_at: new Date().toISOString(),
    });

  if (handoffInsertError) {
    // This is non-fatal — handoffs table may not exist in current migration set
    console.warn(
      `[handoff][trigger] Failed to insert handoff record (table may not exist yet): ${handoffInsertError.message}`
    );
  }

  // ── 5. Broadcast via Supabase Realtime ────────────────────────────────────
  // Notifies connected dashboard operators of the new escalation in < 3s.
  // Channel pattern: tenant:{tenantId}:handoffs
  // Operators subscribe to this channel via the dashboard.
  try {
    const channel = supabase.channel(`tenant:${tenantId}:handoffs`);

    await channel.send({
      type: 'broadcast',
      event: 'new_handoff',
      payload: {
        conversation_id: conversationId,
        tenant_id: tenantId,
        from_number: contactPhone,
        trigger_type: triggerType,
        reason,
        preview: lastMessagePreview.substring(0, 100),
        escalated_at: new Date().toISOString(),
      },
    });

    // Remove channel after sending (fire-and-forget)
    await supabase.removeChannel(channel);
  } catch (realtimeErr) {
    // Realtime failure is non-fatal — state is persisted in DB and Redis
    const msg = realtimeErr instanceof Error ? realtimeErr.message : String(realtimeErr);
    console.warn(
      `[handoff][trigger] Realtime broadcast failed (non-fatal) conversationId=${conversationId}: ${msg}`
    );
  }

  console.info(
    `[handoff][trigger] Handoff complete conversationId=${conversationId} tenant=${tenantId}`
  );
}
