import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createServiceClient } from '@/lib/supabase/service';
import {
  getRedisClient,
  tenantActiveKey,
  rateLimitTenantKey,
  rateLimitPhoneKey,
} from '@/lib/redis/client';
import { publishMessage } from '@/lib/qstash/client';
import { MessageAdapter } from '@/lib/adapters/MessageAdapter';
import { WebhookVerifySchema, WebhookPayloadSchema } from '@/lib/validators/webhook';
import type { WorkerJob } from '@/types/messages';

// ─── Rate Limiting Constants ───────────────────────────────────────────────────
// Token bucket implemented as Redis INCR + EXPIRE per window.
const RATE_LIMIT_TENANT_MAX = 20;    // max requests per 1-second window per tenant
const RATE_LIMIT_TENANT_WINDOW = 1;  // window in seconds
const RATE_LIMIT_PHONE_MAX = 10;     // max requests per 60-second window per phone
const RATE_LIMIT_PHONE_WINDOW = 60;  // window in seconds

// ─── GET — Meta Webhook Verify Handshake ──────────────────────────────────────

/**
 * GET /api/webhook
 *
 * Meta calls this endpoint to verify ownership of the webhook URL.
 * Responds with hub.challenge (plain text, 200) if hub.verify_token matches.
 * Responds 403 on mismatch.
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
  return new NextResponse(challenge, {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  });
}

// ─── POST — Meta Webhook Events ───────────────────────────────────────────────

/**
 * POST /api/webhook
 *
 * Receives WhatsApp Business API events from Meta.
 * Must return 200 in < 500ms. Full pipeline:
 * 1. Validate SHA-256 HMAC signature (timing-safe)
 * 2. Parse and validate payload structure
 * 3. Resolve tenant from phone_number_id (Redis cache → DB fallback)
 * 4. Circuit breaker: check is_active (Redis cache)
 * 5. Check if conversation is escalated (Redis) → drop if so
 * 6. Rate limiting per tenant + per phone (token bucket via Redis INCR)
 * 7. Publish WorkerJob to QStash
 * 8. Return 200
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 1. Validate SHA-256 HMAC Signature ──────────────────────────────────────
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

  const expectedSig =
    'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');

  // Pad to equal length before timing-safe comparison to avoid length oracle
  const sigBuffer = Buffer.from(signature.padEnd(expectedSig.length));
  const expectedBuffer = Buffer.from(expectedSig.padEnd(signature.length));

  // Use longer of the two for final comparison
  const a = signature.length >= expectedSig.length ? sigBuffer : Buffer.from(signature);
  const b = signature.length >= expectedSig.length ? expectedBuffer : Buffer.from(expectedSig);

  const signaturesMatch =
    signature.length === expectedSig.length && crypto.timingSafeEqual(a, b);

  if (!signaturesMatch) {
    console.warn('[webhook][POST] HMAC signature mismatch');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  // ── 2. Parse Payload ─────────────────────────────────────────────────────────
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

  const payload = parsed.data;
  const redis = getRedisClient();
  const supabase = createServiceClient();

  // Process each entry/change (Meta can batch multiple events per request)
  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      const { value } = change;
      const { phone_number_id } = value.metadata;

      // Skip status-update-only changes (no messages array)
      if (!value.messages || value.messages.length === 0) {
        continue;
      }

      // ── 3. Resolve Tenant ──────────────────────────────────────────────────
      const tenantCacheKey = `tenant:phone:${phone_number_id}`;
      const cachedTenantId = await redis.get<string>(tenantCacheKey);
      let tenantId: string;

      if (cachedTenantId) {
        tenantId = cachedTenantId;
        console.info(`[webhook][DEBUG] step3 cache HIT tenantId=${tenantId}`);
      } else {
        // Cache miss — query DB
        const { data: tenant, error } = await supabase
          .from('tenants')
          .select('id, is_active')
          .eq('phone_number_id', phone_number_id)
          .single();

        console.info(`[webhook][DEBUG] step3 DB: id=${tenant?.id} is_active=${tenant?.is_active} err=${error?.message}`);

        if (error || !tenant) {
          console.warn(`[webhook][POST] No tenant for phone_number_id=${phone_number_id}`);
          return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
        }

        tenantId = tenant.id;

        // Cache phone → tenant mapping (5 min TTL)
        await redis.set(tenantCacheKey, tenantId, { ex: 300 });

        // Prime the is_active circuit breaker cache (60s TTL)
        await redis.set(tenantActiveKey(tenantId), tenant.is_active ? '1' : '0', { ex: 60 });
      }

      // ── 4. Circuit Breaker: is_active ──────────────────────────────────────
      let isActiveRaw = await redis.get<string>(tenantActiveKey(tenantId));
      console.info(`[webhook][DEBUG] step4 isActiveRaw=${JSON.stringify(isActiveRaw)} type=${typeof isActiveRaw}`);

      if (isActiveRaw === null) {
        // Cache miss — query DB
        const { data: tenant } = await supabase
          .from('tenants')
          .select('is_active')
          .eq('id', tenantId)
          .single();

        console.info(`[webhook][DEBUG] step4 DB: is_active=${tenant?.is_active}`);
        const active = tenant?.is_active ?? false;
        isActiveRaw = active ? '1' : '0';
        await redis.set(tenantActiveKey(tenantId), isActiveRaw, { ex: 60 });
      }

      if (isActiveRaw !== '1') {
        // Return 200 so Meta does NOT retry for inactive tenants
        console.info(`[webhook][POST] Tenant ${tenantId} inactive — dropping silently`);
        return NextResponse.json({ status: 'ok' }, { status: 200 });
      }

      // Process each message in this change
      for (const message of value.messages) {
        // ── 5. Escalation Check ────────────────────────────────────────────
        // Phone-level escalation key allows the webhook to skip enqueue
        // without needing to know the conversation ID (resolved by worker).
        const phoneEscalatedKey = `conv:escalated:phone:${tenantId}:${message.from}`;
        const isEscalated = await redis.get<string>(phoneEscalatedKey);

        if (isEscalated === '1') {
          console.info(`[webhook][POST] Phone ${message.from} escalated — bot silent`);
          continue;
        }

        // ── 6. Rate Limiting ───────────────────────────────────────────────
        // Per-tenant token bucket (20 req / 1s)
        const tenantRlKey = rateLimitTenantKey(tenantId);
        const tenantCount = await redis.incr(tenantRlKey);
        if (tenantCount === 1) {
          await redis.expire(tenantRlKey, RATE_LIMIT_TENANT_WINDOW);
        }
        if (tenantCount > RATE_LIMIT_TENANT_MAX) {
          console.warn(`[webhook][POST] Tenant rate limit exceeded tenant=${tenantId}`);
          return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
        }

        // Per-phone token bucket (10 req / 60s)
        const phoneRlKey = rateLimitPhoneKey(tenantId, message.from);
        const phoneCount = await redis.incr(phoneRlKey);
        if (phoneCount === 1) {
          await redis.expire(phoneRlKey, RATE_LIMIT_PHONE_WINDOW);
        }
        if (phoneCount > RATE_LIMIT_PHONE_MAX) {
          console.warn(`[webhook][POST] Phone rate limit exceeded phone=${message.from}`);
          return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
        }

        // ── 7. Build WorkerJob and Publish to QStash ───────────────────────
        const standardMsg = MessageAdapter.normalize(message, value, tenantId);

        const job: WorkerJob = {
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

        try {
          await publishMessage(job);
        } catch (err) {
          console.error('[webhook][POST] QStash publish failed:', err);
          // Return 500 so Meta retries the webhook delivery
          return NextResponse.json({ error: 'Queue unavailable' }, { status: 500 });
        }

        console.info(
          `[webhook][POST] Enqueued msgId=${message.id} tenant=${tenantId} phone=${message.from}`
        );
      }
    }
  }

  return NextResponse.json({ status: 'ok' }, { status: 200 });
}
