import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { Client } from '@upstash/qstash';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'text/csv': 'csv',
  'application/vnd.ms-excel': 'csv', // Some clients send this for .csv
};
const STORAGE_BUCKET = 'knowledge';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getQStashClient(): Client {
  const token = process.env.QSTASH_TOKEN;
  if (!token) {
    throw new Error('Missing QSTASH_TOKEN environment variable');
  }
  return new Client({ token });
}

function getIngestUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL;
  if (!baseUrl) {
    throw new Error('Missing NEXT_PUBLIC_APP_URL or VERCEL_URL environment variable');
  }
  // Ensure no trailing slash and prepend https if needed (VERCEL_URL has no scheme)
  const normalized = baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`;
  return `${normalized.replace(/\/$/, '')}/api/ingest`;
}

/**
 * Generate a UUID v4 without crypto.randomUUID (works in all Next.js runtimes).
 */
function generateUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ─── Route Handler ────────────────────────────────────────────────────────────

/**
 * POST /api/upload
 *
 * Accepts a multipart/form-data request with:
 * - `file`     — PDF or CSV binary file (max 10 MB)
 * - `tenantId` — UUID of the tenant uploading the file
 * - `name`     — (optional) human-readable name for the knowledge source
 *
 * Pipeline:
 * 1. Validate content type, file type, and file size
 * 2. Upload file to Supabase Storage under `{tenantId}/{uuid}.{ext}`
 * 3. INSERT into `knowledge_sources` with status info
 * 4. INSERT into `ingestion_jobs` with status `pending`
 * 5. Publish IngestJob to QStash targeting /api/ingest
 * 6. Return { jobId, sourceId }
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 1. Parse multipart form ────────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }

  const file = formData.get('file');
  const name = formData.get('name');
  const sourceType = formData.get('sourceType');
  const rawText = formData.get('text');

  // Derive tenantId from the authenticated session — never trust the client
  const authClient = await createSupabaseServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data: userRow } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single();

  const tenantId = userRow?.tenant_id;
  if (!tenantId) {
    return NextResponse.json({ error: 'Tenant not found for this user' }, { status: 403 });
  }

  // ── Text mode: no file upload, store raw content directly ─────────────────
  if (sourceType === 'text') {
    if (!rawText || typeof rawText !== 'string' || rawText.trim() === '') {
      return NextResponse.json({ error: 'Missing text field' }, { status: 400 });
    }

    const sourceName =
      typeof name === 'string' && name.trim() !== '' ? name.trim() : 'Texto libre';

    const { data: source, error: sourceError } = await supabase
      .from('knowledge_sources')
      .insert({
        tenant_id: tenantId,
        name: sourceName,
        source_type: 'text' as const,
        raw_text: rawText.trim(),
      })
      .select('id')
      .single();

    if (sourceError || !source) {
      console.error('[upload][POST] Failed to insert knowledge_source (text):', sourceError);
      return NextResponse.json({ error: 'Database error creating source' }, { status: 500 });
    }

    const { data: job, error: jobError } = await supabase
      .from('ingestion_jobs')
      .insert({
        tenant_id: tenantId,
        source_id: source.id,
        status: 'pending',
      })
      .select('id')
      .single();

    if (jobError || !job) {
      console.error('[upload][POST] Failed to insert ingestion_job (text):', jobError);
      return NextResponse.json({ error: 'Database error creating ingestion job' }, { status: 500 });
    }

    try {
      const qstash = getQStashClient();
      await qstash.publishJSON({
        url: getIngestUrl(),
        body: { jobId: job.id, tenantId },
        timeout: 55,
        retries: 2,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[upload][POST] Failed to publish to QStash (text): ${message}`);
      return NextResponse.json(
        { jobId: job.id, sourceId: source.id, warning: 'QStash publish failed — job queued but not triggered' },
        { status: 202 }
      );
    }

    console.info(
      `[upload][POST] Text source created for tenant=${tenantId} sourceId=${source.id} jobId=${job.id}`
    );

    return NextResponse.json({ jobId: job.id, sourceId: source.id }, { status: 200 });
  }

  // ── File / URL mode ────────────────────────────────────────────────────────
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file field' }, { status: 400 });
  }

  // ── 2. Validate file type ──────────────────────────────────────────────────
  const mimeType = file.type;
  const ext = ALLOWED_MIME_TYPES[mimeType];

  if (!ext) {
    return NextResponse.json(
      { error: `Unsupported file type: ${mimeType}. Allowed: PDF, CSV` },
      { status: 415 }
    );
  }

  // ── 3. Validate file size ──────────────────────────────────────────────────
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { error: `File too large: ${file.size} bytes. Maximum is 10 MB` },
      { status: 413 }
    );
  }

  // ── 4. Upload to Supabase Storage ─────────────────────────────────────────
  const fileUuid = generateUuid();
  const storagePath = `${tenantId}/${fileUuid}.${ext}`;
  const fileBuffer = await file.arrayBuffer();

  const { error: storageError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, fileBuffer, {
      contentType: mimeType,
      upsert: false,
    });

  if (storageError) {
    console.error('[upload][POST] Storage upload failed:', storageError);
    return NextResponse.json(
      { error: 'Failed to upload file to storage' },
      { status: 500 }
    );
  }

  // ── 5. INSERT knowledge_source ─────────────────────────────────────────────
  const sourceName =
    typeof name === 'string' && name.trim() !== '' ? name.trim() : file.name;

  const { data: source, error: sourceError } = await supabase
    .from('knowledge_sources')
    .insert({
      tenant_id: tenantId,
      name: sourceName,
      source_type: ext as 'pdf' | 'csv',
      storage_path: storagePath,
    })
    .select('id')
    .single();

  if (sourceError || !source) {
    console.error('[upload][POST] Failed to insert knowledge_source:', sourceError);
    // Best-effort cleanup of the uploaded file
    await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
    return NextResponse.json({ error: 'Database error creating source' }, { status: 500 });
  }

  // ── 6. INSERT ingestion_job ────────────────────────────────────────────────
  const { data: job, error: jobError } = await supabase
    .from('ingestion_jobs')
    .insert({
      tenant_id: tenantId,
      source_id: source.id,
      status: 'pending',
    })
    .select('id')
    .single();

  if (jobError || !job) {
    console.error('[upload][POST] Failed to insert ingestion_job:', jobError);
    return NextResponse.json({ error: 'Database error creating ingestion job' }, { status: 500 });
  }

  // ── 7. Publish to QStash → /api/ingest ────────────────────────────────────
  try {
    const qstash = getQStashClient();
    await qstash.publishJSON({
      url: getIngestUrl(),
      body: { jobId: job.id, tenantId },
      timeout: 55,
      retries: 2, // Lower than worker — parse failures should not spam retries
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[upload][POST] Failed to publish to QStash: ${message}`);
    // Job is already in DB as 'pending' — it can be re-triggered.
    // We still return success since the file and job were saved.
    return NextResponse.json(
      { jobId: job.id, sourceId: source.id, warning: 'QStash publish failed — job queued but not triggered' },
      { status: 202 }
    );
  }

  console.info(
    `[upload][POST] Uploaded file for tenant=${tenantId} sourceId=${source.id} jobId=${job.id}`
  );

  return NextResponse.json({ jobId: job.id, sourceId: source.id }, { status: 200 });
}
