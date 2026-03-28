import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getDecryptedToken } from '@/lib/vault/secrets';
import { sendTextMessage } from '@/lib/meta/api';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * POST /api/agent/reply/[conversationId]
 * Body: { text: string }
 *
 * Sends a WhatsApp message from a human agent on an escalated conversation.
 * Requires the caller to be authenticated and belong to the same tenant.
 */

interface AuthResult {
  user: { id: string };
  tenantId: string | null;
  role: string;
}

interface ConvRow {
  id: string;
  tenant_id: string;
  is_escalated: boolean;
  resolved_at: string | null;
  contact_id: string;
}

interface ConversationData {
  conversation: ConvRow;
  contact: { phone: string };
  tenant: { phone_number_id: string; vault_secret_id: string };
}

async function getAuthenticatedTenantUser(
  req: NextRequest
): Promise<AuthResult | NextResponse> {
  void req;
  const supabaseUser = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabaseUser.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: userDataRaw, error: userError } = await supabaseUser
    .from('users')
    .select('role, tenant_id')
    .eq('id', user.id)
    .single();

  const userData = userDataRaw as { role: string; tenant_id: string | null } | null;

  if (userError || !userData) {
    return NextResponse.json({ error: 'User not found' }, { status: 403 });
  }

  return { user, tenantId: userData.tenant_id, role: userData.role };
}

async function fetchConversationData(
  conversationId: string,
  service: SupabaseClient
): Promise<ConversationData | NextResponse> {
  const { data: rawConversation, error: convError } = await service
    .from('conversations')
    .select('id, tenant_id, is_escalated, resolved_at, contact_id')
    .eq('id', conversationId)
    .single();

  const conversation = rawConversation as ConvRow | null;

  if (convError || !conversation) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
  }

  const { data: rawContact, error: contactError } = await service
    .from('contacts')
    .select('phone')
    .eq('id', conversation.contact_id)
    .single();

  const contact = rawContact as { phone: string } | null;

  if (contactError || !contact) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  }

  const { data: rawTenant, error: tenantError } = await service
    .from('tenants')
    .select('phone_number_id, vault_secret_id')
    .eq('id', conversation.tenant_id)
    .single();

  const tenant = rawTenant as { phone_number_id: string | null; vault_secret_id: string | null } | null;

  if (tenantError || !tenant?.phone_number_id || !tenant?.vault_secret_id) {
    return NextResponse.json({ error: 'Tenant not configured' }, { status: 500 });
  }

  return {
    conversation,
    contact,
    tenant: { phone_number_id: tenant.phone_number_id, vault_secret_id: tenant.vault_secret_id },
  };
}

async function persistAgentMessage(
  conversationId: string,
  tenantId: string,
  text: string,
  metaMessageId: string,
  service: SupabaseClient
): Promise<{ id: string } | NextResponse> {
  const { data: newMessage, error: insertError } = await service
    .from('messages')
    .insert({
      conversation_id: conversationId,
      tenant_id: tenantId,
      message_external_id: metaMessageId,
      direction: 'outbound',
      message_type: 'text',
      content: text,
      status: 'sent',
    })
    .select('id')
    .single();

  if (insertError) {
    console.error('[agent/reply] DB insert failed:', insertError.message);
    return NextResponse.json({ error: 'Message sent but failed to record' }, { status: 500 });
  }

  return newMessage as { id: string };
}

async function sendAndPersist(
  data: ConversationData,
  conversationId: string,
  text: string,
  service: ReturnType<typeof createServiceClient>
): Promise<{ messageId: string } | NextResponse> {
  let accessToken: string;
  try {
    accessToken = await getDecryptedToken(data.conversation.tenant_id, data.tenant.vault_secret_id);
  } catch (err) {
    console.error('[agent/reply] Token decryption failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to retrieve credentials' }, { status: 500 });
  }
  let metaResponse: Awaited<ReturnType<typeof sendTextMessage>>;
  try {
    metaResponse = await sendTextMessage(data.tenant.phone_number_id, data.contact.phone, text, accessToken);
  } catch (err) {
    console.error('[agent/reply] Meta API send failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to send message' }, { status: 502 });
  }
  const metaMessageId = metaResponse.messages[0]?.id ?? `agent-${Date.now()}`;
  const result = await persistAgentMessage(conversationId, data.conversation.tenant_id, text, metaMessageId, service);
  if (result instanceof NextResponse) return result;
  return { messageId: result.id };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
): Promise<NextResponse> {
  const { conversationId } = await params;
  const body = await req.json().catch(() => ({})) as { text?: string };
  const text = body?.text?.trim() ?? '';
  if (!text) return NextResponse.json({ error: 'text is required' }, { status: 400 });

  const authResult = await getAuthenticatedTenantUser(req);
  if (authResult instanceof NextResponse) return authResult;

  const service = createServiceClient();
  const convDataResult = await fetchConversationData(conversationId, service);
  if (convDataResult instanceof NextResponse) return convDataResult;

  const { conversation } = convDataResult;
  if (authResult.role !== 'saas_admin' && authResult.tenantId !== conversation.tenant_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!conversation.is_escalated || conversation.resolved_at) {
    return NextResponse.json({ error: 'Conversation is not escalated' }, { status: 409 });
  }

  const sendResult = await sendAndPersist(convDataResult, conversationId, text, service);
  if (sendResult instanceof NextResponse) return sendResult;

  console.info(`[agent/reply] conversationId=${conversationId} userId=${authResult.user.id} metaId=${sendResult.messageId}`);
  return NextResponse.json({ success: true, messageId: sendResult.messageId });
}
