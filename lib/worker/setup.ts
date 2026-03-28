import { SupabaseClient } from '@supabase/supabase-js';
import { sendTextMessage } from '@/lib/meta/api';
import { analyzeImage } from '@/lib/llm/vision';
import { transcribeAudio } from '@/lib/media/whisper';
import { handleVideo } from '@/lib/media/video';
import { triggerHandoff } from '@/lib/handoff/trigger';
import { checkKeywordTrigger, buildKeywordList } from '@/lib/handoff/keywords';
import { getDecryptedToken } from '@/lib/vault/secrets';
import type { WorkerJob } from '@/types/messages';
import type { BotConfig, TenantRow } from './pipeline';

// ─── Contact + Conversation ────────────────────────────────────────────────────

export async function upsertContact(
  supabase: SupabaseClient,
  tenantId: string,
  contactPhone: string,
  contactName: string | undefined
): Promise<string> {
  const { data, error } = await supabase
    .from('contacts')
    .upsert(
      { tenant_id: tenantId, phone: contactPhone, name: contactName },
      { onConflict: 'tenant_id,phone', ignoreDuplicates: false }
    )
    .select('id')
    .single();
  if (error || !data) throw new Error(`upsertContact failed: ${error?.message}`);
  return data.id;
}

export async function resolveConversation(
  supabase: SupabaseClient,
  tenantId: string,
  contactId: string
): Promise<string> {
  const { data: existing, error: queryErr } = await supabase
    .from('conversations')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('contact_id', contactId)
    .is('resolved_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (queryErr) throw new Error(`resolveConversation query failed: ${queryErr.message}`);
  if (existing) return existing.id;
  const { data: created, error: createErr } = await supabase
    .from('conversations')
    .insert({ tenant_id: tenantId, contact_id: contactId, is_escalated: false })
    .select('id')
    .single();
  if (createErr || !created) throw new Error(`resolveConversation create failed: ${createErr?.message}`);
  return created.id;
}

// ─── Message Record ────────────────────────────────────────────────────────────

export interface SetupResult {
  contactId: string;
  conversationId: string;
  isDuplicate: boolean;
}

export async function setupMessageRecord(
  supabase: SupabaseClient,
  job: WorkerJob
): Promise<SetupResult> {
  const { tenantId, contactPhone, contactName, messageExternalId, type, text, mediaUrl, mediaMimeType } = job;
  const contactId = await upsertContact(supabase, tenantId, contactPhone, contactName);
  const conversationId = await resolveConversation(supabase, tenantId, contactId);
  const dbType = type as 'text' | 'audio' | 'image' | 'video' | 'document' | 'unknown';
  const { data: rows, error } = await supabase
    .from('messages')
    .insert({ tenant_id: tenantId, conversation_id: conversationId, message_external_id: messageExternalId, direction: 'inbound' as const, message_type: dbType, content: text, media_url: mediaUrl, media_mime_type: mediaMimeType, status: 'processing' as const })
    .select('id');
  if (error) {
    const pg = error as { code?: string };
    if (pg.code === '23505') return { contactId, conversationId, isDuplicate: true };
    throw new Error(`insertMessage failed: ${error.message}`);
  }
  return { contactId, conversationId, isDuplicate: !rows || rows.length === 0 };
}

// ─── Tenant + Token ────────────────────────────────────────────────────────────

export async function fetchTenantWithToken(
  supabase: SupabaseClient,
  tenantId: string
): Promise<{ tenant: TenantRow; accessToken: string | null }> {
  const { data, error } = await supabase
    .from('tenants')
    .select('phone_number_id, vault_secret_id, bot_config')
    .eq('id', tenantId)
    .single();
  if (error || !data) throw new Error(`fetchTenant failed: ${error?.message}`);
  const tenant = data as TenantRow;
  let accessToken: string | null = null;
  if (tenant.vault_secret_id) {
    try { accessToken = await getDecryptedToken(tenantId, tenant.vault_secret_id); } catch { /* continue without token */ }
  }
  return { tenant, accessToken };
}

// ─── Keyword Handoff ───────────────────────────────────────────────────────────

export async function handleKeywordHandoff(
  supabase: SupabaseClient,
  messageText: string,
  botConfig: BotConfig,
  conversationId: string,
  tenantId: string,
  contactPhone: string,
  messageExternalId: string,
  startTime: number
): Promise<boolean> {
  if (!messageText || !checkKeywordTrigger(messageText, buildKeywordList(botConfig.handoff_keywords ?? []))) {
    return false;
  }
  try { await triggerHandoff(conversationId, tenantId, 'keyword_match', 'keyword', contactPhone, messageText.substring(0, 100)); } catch { /* log only */ }
  await supabase.from('messages').update({ status: 'sent', processing_ms: Date.now() - startTime }).eq('message_external_id', messageExternalId).eq('tenant_id', tenantId);
  return true;
}

// ─── Media Content ─────────────────────────────────────────────────────────────

export interface MediaResult {
  effectiveText: string;
  earlyReturn?: { json: Record<string, string>; status: number };
  audioError?: string;
}

export async function processMediaContent(
  supabase: SupabaseClient,
  job: WorkerJob,
  tenant: TenantRow,
  contactPhone: string,
  messageExternalId: string,
  tenantId: string,
  accessToken: string | null,
  startTime: number
): Promise<MediaResult> {
  if (job.type === 'audio' && accessToken) {
    try {
      const audioMediaId = job.mediaUrl ?? messageExternalId;
      const transcription = await transcribeAudio(audioMediaId, accessToken);
      job.text = transcription;
    } catch (audioErr) {
      const msg = audioErr instanceof Error ? audioErr.message : String(audioErr);
      await supabase.from('messages').update({ status: 'error', error: msg, processing_ms: Date.now() - startTime }).eq('message_external_id', messageExternalId).eq('tenant_id', tenantId);
      return { effectiveText: '', audioError: msg };
    }
  }
  if (job.type === 'video') {
    const videoText = await handleVideo(job.mediaUrl ?? '', accessToken ?? '', job.text ?? '');
    if (accessToken && tenant.phone_number_id) {
      try { await sendTextMessage(tenant.phone_number_id, contactPhone, videoText, accessToken); } catch { /* log only */ }
    }
    await supabase.from('messages').update({ status: 'sent', processing_ms: Date.now() - startTime }).eq('message_external_id', messageExternalId).eq('tenant_id', tenantId);
    return { effectiveText: '', earlyReturn: { json: { status: 'ok', type: 'video_passthrough' }, status: 200 } };
  }
  let effectiveText = job.text ?? '';
  if (job.type === 'image' && job.mediaUrl) {
    try {
      const description = await analyzeImage(job.mediaUrl, effectiveText, tenantId);
      job.text = description;
      effectiveText = description;
    } catch { /* continue with original text */ }
  }
  return { effectiveText };
}
