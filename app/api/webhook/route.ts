import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import {
  getRedisClient,
  rateLimitTenantKey,
  rateLimitPhoneKey,
} from '@/lib/redis/client';
import { publishMessage } from '@/lib/qstash/client';
import { MessageAdapter } from '@/lib/adapters/MessageAdapter';
import { WebhookVerifySchema, WebhookPayloadSchema } from '@/lib/validators/webhook';
import type { z } from 'zod';

type WebhookChange = z.infer<typeof WebhookPayloadSchema>['entry'][number]['changes'][number];
import type { WorkerJob } from '@/types/messages';
import { validateHmac } from '@/lib/webhook/hmac';
import { resolveTenantId } from '@/lib/webhook/tenant';

// ─── Rate Limiting Constants ───────────────────────────────────────────────────
// Token bucket implemented as Redis INCR + EXPIRE per window.
const RATE_LIMIT_TENANT_MAX = 20;    // max requests per 1-second window per tenant
const RATE_LIMIT_TENANT_WINDOW = 1;  // window in seconds
const RATE_LIMIT_PHONE_MAX = 10;     // max requests per 60-second window per phone
const RATE_LIMIT_PHONE_WINDOW = 60;  // window in seconds

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a WorkerJob from a normalized message. */
function buildWorkerJob(standardMsg: ReturnType<typeof MessageAdapter.normalize>): WorkerJob {
  return {
    tenantId: standardMsg.tenantId,
    messageExternalId: standardMsg.externalId,
    contactPhone: standardMsg.contactPhone,
    contactName: standardMsg.contactName,
    type: standardMsg.type,
    text: standardMsg.text,
    mediaUrl: standardMsg.mediaUrl,
    mediaMimeType: standardMsg.mediaMimeType,
    timestamp: standardMsg.timestamp.toISOString(),
  };
}

/**
 * Handle escalation check, rate limiting, and QStash publish for a single change.
 * Returns NextResponse to short-circuit (rate limit or queue error), or null to continue.
 */
async function processChange(
  change: WebhookChange,
  tenantId: string,
  redis: ReturnType<typeof getRedisClient>,
  supabase: ReturnType<typeof createServiceClient>
): Promise<NextResponse | null> {
  const { value } = change;

  for (const message of value.messages ?? []) {
    // Escalation Check: phone-level key lets webhook skip enqueue without knowing conversation ID
    const isEscalated = await redis.get<string>(`conv:escalated:phone:${tenantId}:${message.from}`);
    if (isEscalated === '1') {
      console.info(`[webhook][POST] Phone ${message.from} escalated — bot silent`);
      continue;
    }

    // Rate Limiting — per-tenant token bucket (20 req / 1s)
    const tenantRlKey = rateLimitTenantKey(tenantId);
    const tenantCount = await redis.incr(tenantRlKey);
    if (tenantCount === 1) await redis.expire(tenantRlKey, RATE_LIMIT_TENANT_WINDOW);
    if (tenantCount > RATE_LIMIT_TENANT_MAX) {
      console.warn(`[webhook][POST] Tenant rate limit exceeded tenant=${tenantId}`);
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    // Rate Limiting — per-phone token bucket (10 req / 60s)
    const phoneRlKey = rateLimitPhoneKey(tenantId, message.from);
    const phoneCount = await redis.incr(phoneRlKey);
    if (phoneCount === 1) await redis.expire(phoneRlKey, RATE_LIMIT_PHONE_WINDOW);
    if (phoneCount > RATE_LIMIT_PHONE_MAX) {
      console.warn(`[webhook][POST] Phone rate limit exceeded phone=${message.from}`);
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    // Publish WorkerJob to QStash
    const job = buildWorkerJob(MessageAdapter.normalize(message, value, tenantId));
    try {
      await publishMessage(job);
    } catch (err) {
      console.error('[webhook][POST] QStash publish failed:', err);
      return NextResponse.json({ error: 'Queue unavailable' }, { status: 500 }); // 500 so Meta retries
    }

    console.info(`[webhook][POST] Enqueued msgId=${message.id} tenant=${tenantId} phone=${message.from}`);
  }

  return null;
}

// ─── GET — Meta Webhook Verify Handshake ──────────────────────────────────────

/**
 * GET /api/webhook
 * Meta calls this to verify ownership. Responds with hub.challenge (200) or 403.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = WebhookVerifySchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 });
  }
  const { 'hub.verify_token': verifyToken, 'hub.challenge': challenge } = parsed.data;
  const expectedToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (!expectedToken) {
    console.error('[webhook][GET] META_WEBHOOK_VERIFY_TOKEN not configured');
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }
  if (verifyToken !== expectedToken) {
    console.warn('[webhook][GET] Token mismatch — unauthorized verification attempt');
    return new NextResponse(null, { status: 403 });
  }
  // Return challenge as plain text — Meta expects this exact format
  return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
}

// ─── POST — Meta Webhook Events ───────────────────────────────────────────────

/**
 * POST /api/webhook
 *
 * Receives WhatsApp Business API events from Meta.
 * Must return 200 in < 500ms. Pipeline: HMAC validate → parse → tenant resolve
 * → circuit breaker → escalation check → rate limit → QStash publish → 200.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const signature = req.headers.get('x-hub-signature-256');
  if (!signature) {
    console.warn('[webhook][POST] Missing X-Hub-Signature-256 header');
    return NextResponse.json({ error: 'Missing signature' }, { status: 401 });
  }

  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    console.error('[webhook][POST] META_APP_SECRET not configured');
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }
  if (!validateHmac(rawBody, signature, appSecret)) {
    console.warn('[webhook][POST] HMAC signature mismatch');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = WebhookPayloadSchema.safeParse(body);
  if (!parsed.success) {
    // Non-message events (status updates, etc.) — accept silently to avoid Meta retries
    console.info('[webhook][POST] Non-message payload, ignoring:', parsed.error.format());
    return NextResponse.json({ status: 'ignored' }, { status: 200 });
  }

  const redis = getRedisClient();
  const supabase = createServiceClient();

  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      if (!change.value.messages || change.value.messages.length === 0) continue;
      const tenantResult = await resolveTenantId(change.value.metadata.phone_number_id, redis, supabase);
      if (tenantResult instanceof NextResponse) return tenantResult;
      const shortCircuit = await processChange(change, tenantResult, redis, supabase);
      if (shortCircuit) return shortCircuit;
    }
  }

  return NextResponse.json({ status: 'ok' }, { status: 200 });
}
