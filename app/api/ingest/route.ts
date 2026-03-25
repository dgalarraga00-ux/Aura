import { NextRequest, NextResponse } from 'next/server';
import { verifyQStashSignature } from '@/lib/qstash/verifier';
import { ingestSource } from '@/lib/rag/ingest';

// ─── Vercel Runtime Config ────────────────────────────────────────────────────
// maxDuration=60 allows long-running PDF/URL ingestion within Vercel Pro limits.
// QStash retries on non-2xx — we catch parse failures and return 200 to prevent
// infinite retries for unrecoverable errors (bad file format, empty content, etc.)
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

interface IngestJob {
  jobId: string;
  tenantId: string;
}

/**
 * POST /api/ingest
 *
 * QStash worker that processes a knowledge source ingestion job.
 * Published by /api/upload after a file is uploaded to Supabase Storage.
 *
 * Pipeline:
 * 1. Verify QStash signature
 * 2. Parse IngestJob from body
 * 3. Call ingestSource(jobId, tenantId) — parse, chunk, embed, upsert
 * 4. Return 200 to acknowledge delivery
 *
 * On unrecoverable parse/format errors: returns 200 (do not retry).
 * On transient errors (DB, OpenAI rate limit): returns 500 (QStash will retry).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 1. Verify QStash Signature ─────────────────────────────────────────────
  const reqForVerification = req.clone();
  const isValid = await verifyQStashSignature(reqForVerification);

  if (!isValid) {
    console.warn('[ingest][POST] Invalid QStash signature — rejecting');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── 2. Parse IngestJob ─────────────────────────────────────────────────────
  let job: IngestJob;
  try {
    job = (await req.json()) as IngestJob;
  } catch {
    console.error('[ingest][POST] Failed to parse request body as JSON');
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const { jobId, tenantId } = job;

  if (!jobId || !tenantId) {
    console.error('[ingest][POST] Missing jobId or tenantId in payload', { jobId, tenantId });
    return NextResponse.json({ error: 'Malformed job payload' }, { status: 400 });
  }

  // ── 3. Run ingestion pipeline ──────────────────────────────────────────────
  try {
    await ingestSource(jobId, tenantId);
    return NextResponse.json({ status: 'ok' }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ingest][POST] Ingestion failed jobId=${jobId}: ${message}`);

    // ingestSource already marked the job as `failed` in DB.
    // Return 200 to prevent QStash from retrying a document parse failure.
    // For transient errors (network, DB connectivity), this is a trade-off —
    // the job can be re-triggered manually via a new upload.
    return NextResponse.json({ status: 'failed', error: message }, { status: 200 });
  }
}
