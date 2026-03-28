import { NextRequest, NextResponse } from 'next/server';
import { verifyQStashSignature } from '@/lib/qstash/verifier';
import { createServiceClient } from '@/lib/supabase/service';
import { runRagAndLlm, type BotConfig } from '@/lib/worker/pipeline';
import { setupMessageRecord, fetchTenantWithToken, handleKeywordHandoff, processMediaContent } from '@/lib/worker/setup';
import type { WorkerJob } from '@/types/messages';

// ─── Vercel Runtime Config ────────────────────────────────────────────────────
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * POST /api/worker — QStash consumer. Processes a single WhatsApp message
 * through the full pipeline. Returns 200 to acknowledge delivery.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const isValid = await verifyQStashSignature(req.clone());
  if (!isValid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let job: WorkerJob;
  try { job = (await req.json()) as WorkerJob; }
  catch { return NextResponse.json({ error: 'Invalid payload' }, { status: 400 }); }

  const { tenantId, messageExternalId, contactPhone, type } = job;
  if (!tenantId || !messageExternalId || !contactPhone) {
    return NextResponse.json({ error: 'Malformed job payload' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const startTime = Date.now();

  let setup;
  try { setup = await setupMessageRecord(supabase, job); }
  catch { return NextResponse.json({ error: 'Database error' }, { status: 500 }); }
  if (setup.isDuplicate) return NextResponse.json({ status: 'duplicate' }, { status: 200 });

  if (type === 'unknown') {
    await supabase.from('messages').update({ status: 'unsupported' }).eq('message_external_id', messageExternalId);
    return NextResponse.json({ status: 'unsupported' }, { status: 200 });
  }

  const { conversationId } = setup;
  let tenantData;
  try { tenantData = await fetchTenantWithToken(supabase, tenantId); }
  catch { return NextResponse.json({ error: 'Tenant not found' }, { status: 500 }); }

  const { tenant, accessToken } = tenantData;
  const botConfig = tenant.bot_config as BotConfig;
  const isKeyword = await handleKeywordHandoff(supabase, job.text ?? '', botConfig, conversationId, tenantId, contactPhone, messageExternalId, startTime);
  if (isKeyword) return NextResponse.json({ status: 'ok', handoff: 'keyword' }, { status: 200 });
  const mediaResult = await processMediaContent(supabase, job, tenant, contactPhone, messageExternalId, tenantId, accessToken, startTime);
  if (mediaResult.audioError) return NextResponse.json({ status: 'error', reason: 'audio_transcription_failed' }, { status: 200 });
  if (mediaResult.earlyReturn) return NextResponse.json(mediaResult.earlyReturn.json, { status: mediaResult.earlyReturn.status });

  try {
    const result = await runRagAndLlm(supabase, mediaResult.effectiveText, tenantId, conversationId, contactPhone, messageExternalId, botConfig, tenant, accessToken, startTime);
    if (result.type === 'handoff') return NextResponse.json({ status: 'ok', handoff: result.trigger }, { status: 200 });
    return NextResponse.json({ status: 'ok' }, { status: 200 });
  } catch (llmErr) {
    const msg = llmErr instanceof Error ? llmErr.message : String(llmErr);
    console.error(`[worker] LLM failed msgId=${messageExternalId}: ${msg}`);
    await supabase.from('messages').update({ status: 'error', error: `LLM failed: ${msg}`, processing_ms: Date.now() - startTime }).eq('message_external_id', messageExternalId).eq('tenant_id', tenantId);
    return NextResponse.json({ error: 'LLM processing failed' }, { status: 500 });
  }
}
