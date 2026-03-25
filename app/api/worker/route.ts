import { NextRequest, NextResponse } from 'next/server';
import { verifyQStashSignature } from '@/lib/qstash/verifier';
import { createServiceClient } from '@/lib/supabase/service';
import { semanticSearch, type RagChunk } from '@/lib/rag/search';
import { getRedisClient, ragScoreCounterKey } from '@/lib/redis/client';
import { getDecryptedToken } from '@/lib/vault/secrets';
import { sendTextMessage } from '@/lib/meta/api';
import { buildSystemPrompt, getConversationHistory, chatWithTools } from '@/lib/llm/chat';
import { analyzeImage } from '@/lib/llm/vision';
import { transcribeAudio } from '@/lib/media/whisper';
import { handleVideo } from '@/lib/media/video';
import { triggerHandoff } from '@/lib/handoff/trigger';
import { checkKeywordTrigger, buildKeywordList } from '@/lib/handoff/keywords';
import type { WorkerJob } from '@/types/messages';

// ─── Vercel Runtime Config ────────────────────────────────────────────────────
// maxDuration=60 enables long-running execution on Vercel Pro.
// QStash timeout is set to 55s (see lib/qstash/client.ts) to leave 5s buffer.
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// ─── POST — QStash Worker Consumer ───────────────────────────────────────────

/**
 * POST /api/worker
 *
 * Consumed exclusively by QStash. Processes a single WhatsApp message through
 * the full pipeline. Must return 200 to acknowledge delivery.
 *
 * Pipeline (Phase 4 — complete):
 * 1. Verify QStash signature
 * 2. Parse WorkerJob from body
 * 3. Idempotency check (message_external_id UNIQUE in DB)
 * 4. Upsert contact
 * 5. Get or create conversation
 * 6. Fetch tenant config + decrypt access token
 * 7. Keyword pre-check → triggerHandoff if match
 * 8. [Phase 6 stub] Whisper transcription for audio
 * 9. analyzeImage for image messages (GPT-4o Vision)
 * 10. RAG search with low-score counter
 * 11. Build system prompt + fetch conversation history
 * 12. chatWithTools (GPT-4o-mini)
 * 13. Handle LLM tool calls (escalate_to_human → triggerHandoff)
 * 14. Send response via Meta API
 * 15. Persist assistant message + update processing metadata
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 1. Verify QStash Signature ───────────────────────────────────────────────
  // We must clone the request because verifyQStashSignature reads the body.
  const reqForVerification = req.clone();
  const isValid = await verifyQStashSignature(reqForVerification);

  if (!isValid) {
    console.warn('[worker][POST] Invalid QStash signature — rejecting');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── 2. Parse WorkerJob ────────────────────────────────────────────────────────
  let job: WorkerJob;
  try {
    job = (await req.json()) as WorkerJob;
  } catch {
    console.error('[worker][POST] Failed to parse request body as JSON');
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const { tenantId, messageExternalId, contactPhone, contactName, type, text, mediaUrl, mediaMimeType, timestamp } = job;

  if (!tenantId || !messageExternalId || !contactPhone) {
    console.error('[worker][POST] Missing required fields in WorkerJob', { tenantId, messageExternalId });
    return NextResponse.json({ error: 'Malformed job payload' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const startTime = Date.now();

  // ── 3. Idempotency Check ──────────────────────────────────────────────────────
  // Try to insert the message record immediately.
  // ON CONFLICT DO NOTHING: if the external ID already exists, the insert
  // returns 0 rows affected — meaning this is a duplicate delivery from QStash.
  //
  // We need a conversation_id to insert a message. We resolve contact + conversation
  // first, then do the idempotent insert.

  // ── 4. Upsert Contact ────────────────────────────────────────────────────────
  const { data: contact, error: contactError } = await supabase
    .from('contacts')
    .upsert(
      {
        tenant_id: tenantId,
        phone: contactPhone,
        name: contactName,
      },
      {
        onConflict: 'tenant_id,phone',
        ignoreDuplicates: false, // DO UPDATE to refresh name if changed
      }
    )
    .select('id')
    .single();

  if (contactError || !contact) {
    console.error('[worker][POST] Failed to upsert contact:', contactError);
    // Return 500 so QStash retries
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }

  const contactId = contact.id;

  // ── 5. Get or Create Conversation ────────────────────────────────────────────
  // Look for an open (unresolved) conversation between this tenant and contact.
  // If none exists, create one.
  let conversationId: string;

  const { data: existingConv, error: convQueryError } = await supabase
    .from('conversations')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('contact_id', contactId)
    .is('resolved_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (convQueryError) {
    console.error('[worker][POST] Failed to query conversation:', convQueryError);
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }

  if (existingConv) {
    conversationId = existingConv.id;
  } else {
    // Create a new conversation
    const { data: newConv, error: convCreateError } = await supabase
      .from('conversations')
      .insert({
        tenant_id: tenantId,
        contact_id: contactId,
        is_escalated: false,
      })
      .select('id')
      .single();

    if (convCreateError || !newConv) {
      console.error('[worker][POST] Failed to create conversation:', convCreateError);
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }

    conversationId = newConv.id;
  }

  // ── 3 (continued). Idempotent Message Insert ──────────────────────────────────
  // Map WorkerJob type to the DB enum. 'document' and 'unknown' are supported enums.
  const dbMessageType = (type === 'document' || type === 'unknown' ? type : type) as
    | 'text'
    | 'audio'
    | 'image'
    | 'video'
    | 'document'
    | 'unknown';

  // Use ON CONFLICT DO NOTHING via the insert — if message_external_id already exists
  // the insert silently no-ops and returns data=[] (empty array).
  // We detect the duplicate by checking if data is empty.
  const { data: insertedRows, error: insertError } = await supabase
    .from('messages')
    .insert({
      tenant_id: tenantId,
      conversation_id: conversationId,
      message_external_id: messageExternalId,
      direction: 'inbound' as const,
      message_type: dbMessageType,
      content: text,
      media_url: mediaUrl,
      media_mime_type: mediaMimeType,
      status: 'processing' as const,
    })
    .select('id');

  if (insertError) {
    // Postgres unique constraint violation code = '23505'
    const pgError = insertError as { code?: string };
    if (pgError.code === '23505') {
      console.info(`[worker][POST] Duplicate delivery (constraint) for msgId=${messageExternalId}`);
      return NextResponse.json({ status: 'duplicate' }, { status: 200 });
    }
    console.error('[worker][POST] Failed to insert message record:', insertError);
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }

  // If insert returned no rows, it was a silent ON CONFLICT DO NOTHING duplicate
  if (!insertedRows || insertedRows.length === 0) {
    console.info(`[worker][POST] Duplicate delivery for msgId=${messageExternalId}, acking`);
    return NextResponse.json({ status: 'duplicate' }, { status: 200 });
  }

  // ── 6. Handle Unsupported Message Types ──────────────────────────────────────
  // MessageAdapter already classified the type; 'unknown' means unsupported
  // (sticker, reaction, etc.). Mark and ack without further processing.
  if (type === 'unknown') {
    console.info(`[worker][POST] Unsupported message type for msgId=${messageExternalId}, marking unsupported`);
    await supabase
      .from('messages')
      .update({ status: 'unsupported' })
      .eq('message_external_id', messageExternalId);
    return NextResponse.json({ status: 'unsupported' }, { status: 200 });
  }

  console.info(
    `[worker][POST] Processing msgId=${messageExternalId} type=${type} tenant=${tenantId} conversation=${conversationId}`
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // FETCH TENANT CONFIG + ACCESS TOKEN
  // ─────────────────────────────────────────────────────────────────────────────

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('phone_number_id, vault_secret_id, bot_config')
    .eq('id', tenantId)
    .single();

  if (tenantError || !tenant) {
    console.error('[worker][POST] Failed to fetch tenant config:', tenantError);
    return NextResponse.json({ error: 'Tenant not found' }, { status: 500 });
  }

  // Decrypt the Meta access token (Redis-cached, TTL=5min)
  let accessToken: string | null = null;
  if (tenant.vault_secret_id) {
    try {
      accessToken = await getDecryptedToken(tenantId, tenant.vault_secret_id);
    } catch (tokenErr) {
      const msg = tokenErr instanceof Error ? tokenErr.message : String(tokenErr);
      console.error(`[worker][POST] Failed to decrypt access token tenant=${tenantId}: ${msg}`);
      // Continue without token — we can still process but can't send response
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PHASE 4 PIPELINE
  // ─────────────────────────────────────────────────────────────────────────────

  // ── 7. Keyword Pre-check (handoff trigger — runs before LLM) ─────────────────
  // If the user's message matches any handoff keyword, escalate immediately
  // without calling the LLM. This saves latency and respects user intent.
  const messageText = job.text ?? '';
  const botConfig = tenant.bot_config as {
    system_prompt: string;
    handoff_keywords: string[];
    rag_score_threshold: number;
    language: string;
    max_tokens: number;
  };

  const keywordList = buildKeywordList(botConfig.handoff_keywords ?? []);

  if (messageText && checkKeywordTrigger(messageText, keywordList)) {
    console.info(
      `[worker][POST] Keyword trigger matched for msgId=${messageExternalId} — triggering handoff`
    );

    try {
      await triggerHandoff(
        conversationId,
        tenantId,
        'keyword_match',
        'keyword',
        contactPhone,
        messageText.substring(0, 100)
      );
    } catch (handoffErr) {
      const msg = handoffErr instanceof Error ? handoffErr.message : String(handoffErr);
      console.error(`[worker][POST] triggerHandoff failed (keyword): ${msg}`);
    }

    // Update message status — human takes over from here
    await supabase
      .from('messages')
      .update({ status: 'sent' })
      .eq('message_external_id', messageExternalId)
      .eq('tenant_id', tenantId);

    const processingMs = Date.now() - startTime;
    await supabase
      .from('messages')
      .update({ processing_ms: processingMs })
      .eq('message_external_id', messageExternalId)
      .eq('tenant_id', tenantId);

    return NextResponse.json({ status: 'ok', handoff: 'keyword' }, { status: 200 });
  }

  // ── 8. Whisper Transcription (audio messages) ─────────────────────────────────
  // Download audio from Meta and transcribe via Whisper before RAG + LLM.
  // On failure we mark the message as errored and return 200 — QStash must NOT
  // retry transcription failures (they would keep failing and waste quota).
  if (type === 'audio' && accessToken) {
    const audioMediaId = job.mediaUrl ?? messageExternalId;
    try {
      console.info(`[worker][POST] Starting Whisper transcription for msgId=${messageExternalId}`);
      const transcription = await transcribeAudio(audioMediaId, accessToken);
      job.text = transcription;
      console.info(
        `[worker][POST] Whisper transcription complete msgId=${messageExternalId} chars=${transcription.length}`
      );
    } catch (audioErr) {
      const msg = audioErr instanceof Error ? audioErr.message : String(audioErr);
      const isTooBig = (audioErr as { code?: string })?.code === 'audio_too_large';
      console.error(
        `[worker][POST] Whisper transcription failed msgId=${messageExternalId} tooBig=${isTooBig}: ${msg}`
      );

      const processingMs = Date.now() - startTime;
      await supabase
        .from('messages')
        .update({
          status: 'error',
          error: msg,
          processing_ms: processingMs,
        })
        .eq('message_external_id', messageExternalId)
        .eq('tenant_id', tenantId);

      // Return 200 — do NOT let QStash retry audio failures
      return NextResponse.json({ status: 'error', reason: 'audio_transcription_failed' }, { status: 200 });
    }
  }

  // ── 8b. Video pass-through ────────────────────────────────────────────────────
  // Meta Cloud API does not support direct video analysis via Vision (v1).
  // Respond with a standard message directly — skip RAG and LLM entirely.
  if (type === 'video') {
    console.info(`[worker][POST] Video message — sending standard response msgId=${messageExternalId}`);
    const videoResponse = await handleVideo(
      job.mediaUrl ?? '',
      accessToken ?? '',
      job.text ?? ''
    );

    if (accessToken && tenant.phone_number_id) {
      try {
        await sendTextMessage(tenant.phone_number_id, contactPhone, videoResponse, accessToken);
      } catch (sendErr) {
        const msg = sendErr instanceof Error ? sendErr.message : String(sendErr);
        console.error(`[worker][POST] Failed to send video response msgId=${messageExternalId}: ${msg}`);
      }
    }

    const processingMs = Date.now() - startTime;
    await supabase
      .from('messages')
      .update({ status: 'sent', processing_ms: processingMs })
      .eq('message_external_id', messageExternalId)
      .eq('tenant_id', tenantId);

    return NextResponse.json({ status: 'ok', type: 'video_passthrough' }, { status: 200 });
  }

  // ── 9. Vision Analysis (image messages → GPT-4o Vision) ──────────────────────
  // For image messages, use GPT-4o Vision to get a textual description.
  // The description is then used as the search query for RAG + passed to the LLM.
  let effectiveText = job.text ?? '';

  if (type === 'image' && mediaUrl) {
    try {
      console.info(`[worker][POST] Running vision analysis for msgId=${messageExternalId}`);
      const imageDescription = await analyzeImage(mediaUrl, effectiveText, tenantId);
      // Replace effective text with vision description for downstream RAG + LLM
      effectiveText = imageDescription;
      job.text = imageDescription;
    } catch (visionErr) {
      const msg = visionErr instanceof Error ? visionErr.message : String(visionErr);
      console.error(`[worker][POST] Vision analysis failed for msgId=${messageExternalId}: ${msg}`);
      // Continue with original text (if any) — vision failure should not block pipeline
    }
  }

  // ── 10. RAG Search ────────────────────────────────────────────────────────────
  // Only run RAG if there is text content to search (skip for pure media without transcription)
  let ragChunks: RagChunk[] = [];
  let ragScore = 0;

  if (effectiveText && effectiveText.trim().length > 0) {
    try {
      ragChunks = await semanticSearch(effectiveText, tenantId);
      ragScore = ragChunks[0]?.score ?? 0;

      // Track consecutive low-score queries per conversation for handoff triggering.
      // Uses ragScoreCounterKey in Redis (TTL: 3600s) — see lib/redis/client.ts
      const redis = getRedisClient();
      const counterKey = ragScoreCounterKey(conversationId);

      if (ragChunks.length === 0) {
        // No chunk passed the 0.75 threshold — increment low-score counter
        const count = await redis.incr(counterKey);
        await redis.expire(counterKey, 3600);

        console.info(
          `[worker][RAG] No relevant chunks for msgId=${messageExternalId} conversationId=${conversationId} lowScoreCount=${count}`
        );

        if (count >= 3) {
          // 3 consecutive low-score queries → escalate to human
          console.warn(
            `[worker][RAG] 3 consecutive low-score queries — conversation=${conversationId} tenant=${tenantId} — triggering handoff`
          );

          // Reset counter after triggering so we don't re-trigger on the same conversation
          await redis.del(counterKey);

          try {
            await triggerHandoff(
              conversationId,
              tenantId,
              'rag_score_below_threshold_3_consecutive',
              'rag_score',
              contactPhone,
              effectiveText.substring(0, 100)
            );
          } catch (handoffErr) {
            const msg = handoffErr instanceof Error ? handoffErr.message : String(handoffErr);
            console.error(`[worker][POST] triggerHandoff failed (rag_score): ${msg}`);
          }

          await supabase
            .from('messages')
            .update({ status: 'sent', rag_score: ragScore })
            .eq('message_external_id', messageExternalId)
            .eq('tenant_id', tenantId);

          const processingMs = Date.now() - startTime;
          await supabase
            .from('messages')
            .update({ processing_ms: processingMs })
            .eq('message_external_id', messageExternalId)
            .eq('tenant_id', tenantId);

          return NextResponse.json({ status: 'ok', handoff: 'rag_score' }, { status: 200 });
        }
      } else {
        // Good score — reset low-score counter
        await redis.del(counterKey);
        console.info(
          `[worker][RAG] Found ${ragChunks.length} chunk(s) for msgId=${messageExternalId} topScore=${ragScore.toFixed(3)}`
        );
      }

      // Persist best RAG score to the message record for analytics
      await supabase
        .from('messages')
        .update({ rag_score: ragScore })
        .eq('message_external_id', messageExternalId)
        .eq('tenant_id', tenantId);
    } catch (ragErr) {
      // RAG failure should not block the pipeline — log and continue
      const ragMessage = ragErr instanceof Error ? ragErr.message : String(ragErr);
      console.error(`[worker][RAG] Search failed for msgId=${messageExternalId}: ${ragMessage}`);
    }
  }

  // ── 11. Build System Prompt + Conversation History ────────────────────────────
  const systemPrompt = buildSystemPrompt(botConfig, ragChunks);
  const history = await getConversationHistory(conversationId);

  // ── 12. LLM Call (GPT-4o-mini with Tool Calls) ────────────────────────────────
  // If there is no effective text at this point (e.g. audio without transcription),
  // skip the LLM call and return early.
  if (!effectiveText || effectiveText.trim().length === 0) {
    console.info(
      `[worker][POST] No text content for LLM call, skipping — msgId=${messageExternalId}`
    );

    const processingMs = Date.now() - startTime;
    await supabase
      .from('messages')
      .update({ status: 'sent', processing_ms: processingMs })
      .eq('message_external_id', messageExternalId)
      .eq('tenant_id', tenantId);

    return NextResponse.json({ status: 'ok' }, { status: 200 });
  }

  let tokensUsed = 0;

  try {
    const chatResponse = await chatWithTools(systemPrompt, history, effectiveText, tenantId);
    tokensUsed = chatResponse.tokensUsed;

    // ── 13. Handle Tool Calls ──────────────────────────────────────────────────

    if (chatResponse.type === 'handoff') {
      // LLM invoked escalate_to_human → trigger handoff and stop bot response
      console.info(
        `[worker][POST] LLM tool call: escalate_to_human reason=${chatResponse.reason} msgId=${messageExternalId}`
      );

      try {
        await triggerHandoff(
          conversationId,
          tenantId,
          chatResponse.reason,
          'llm_tool',
          contactPhone,
          effectiveText.substring(0, 100)
        );
      } catch (handoffErr) {
        const msg = handoffErr instanceof Error ? handoffErr.message : String(handoffErr);
        console.error(`[worker][POST] triggerHandoff failed (llm_tool): ${msg}`);
      }

      // Persist tool call data + processing metadata
      const processingMs = Date.now() - startTime;
      await supabase
        .from('messages')
        .update({
          tool_calls: [{ name: 'escalate_to_human', reason: chatResponse.reason, summary: chatResponse.summary }],
          tokens_used: tokensUsed,
          processing_ms: processingMs,
          status: 'sent',
        })
        .eq('message_external_id', messageExternalId)
        .eq('tenant_id', tenantId);

      return NextResponse.json({ status: 'ok', handoff: 'llm_tool' }, { status: 200 });
    }

    // ── 14. Send Response via Meta API ─────────────────────────────────────────
    const llmText = chatResponse.content;

    if (llmText && llmText.trim().length > 0 && accessToken && tenant.phone_number_id) {
      try {
        await sendTextMessage(tenant.phone_number_id, contactPhone, llmText, accessToken);
        console.info(
          `[worker][POST] Response sent via Meta API msgId=${messageExternalId} chars=${llmText.length}`
        );
      } catch (sendErr) {
        const msg = sendErr instanceof Error ? sendErr.message : String(sendErr);
        console.error(`[worker][POST] Failed to send Meta response msgId=${messageExternalId}: ${msg}`);

        const processingMs = Date.now() - startTime;
        await supabase
          .from('messages')
          .update({
            status: 'error',
            error: `Meta send failed: ${msg}`,
            llm_response: llmText,
            tokens_used: tokensUsed,
            processing_ms: processingMs,
          })
          .eq('message_external_id', messageExternalId)
          .eq('tenant_id', tenantId);

        // Return 500 so QStash retries
        return NextResponse.json({ error: 'Failed to send WhatsApp message' }, { status: 500 });
      }
    } else if (!accessToken) {
      console.warn(
        `[worker][POST] No access token available — skipping Meta send msgId=${messageExternalId}`
      );
    }

    // ── 15. Persist Assistant Message + Update Metadata ───────────────────────
    const processingMs = Date.now() - startTime;

    // Insert the outbound (assistant) message record
    await supabase.from('messages').insert({
      tenant_id: tenantId,
      conversation_id: conversationId,
      message_external_id: `${messageExternalId}:response`,
      direction: 'outbound' as const,
      message_type: 'text' as const,
      content: llmText,
      llm_response: llmText,
      status: 'sent' as const,
    });

    // Update the inbound message record with LLM metadata
    await supabase
      .from('messages')
      .update({
        llm_response: llmText,
        tool_calls: chatResponse.toolCalls ? JSON.parse(JSON.stringify(chatResponse.toolCalls)) : null,
        tokens_used: tokensUsed,
        processing_ms: processingMs,
        status: 'sent',
      })
      .eq('message_external_id', messageExternalId)
      .eq('tenant_id', tenantId);

    console.info(
      `[worker][POST] Pipeline complete msgId=${messageExternalId} processingMs=${processingMs} tokensUsed=${tokensUsed}`
    );

  } catch (llmErr) {
    const msg = llmErr instanceof Error ? llmErr.message : String(llmErr);
    console.error(`[worker][POST] LLM call failed msgId=${messageExternalId}: ${msg}`);

    const processingMs = Date.now() - startTime;
    await supabase
      .from('messages')
      .update({
        status: 'error',
        error: `LLM failed: ${msg}`,
        processing_ms: processingMs,
      })
      .eq('message_external_id', messageExternalId)
      .eq('tenant_id', tenantId);

    // Return 500 so QStash retries
    return NextResponse.json({ error: 'LLM processing failed' }, { status: 500 });
  }

  return NextResponse.json({ status: 'ok' }, { status: 200 });
}
