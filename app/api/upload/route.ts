import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { Client } from '@upstash/qstash';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'text/csv': 'csv',
  'application/vnd.ms-excel': 'csv', // Some clients send this for .csv
};
const STORAGE_BUCKET = 'knowledge';

function getQStashClient(): Client {
  const token = process.env.QSTASH_TOKEN;
  if (!token) throw new Error('Missing QSTASH_TOKEN environment variable');
  return new Client({ token });
}

function getIngestUrl(): string {
  const baseUrl = process.env.APP_URL ?? process.env.VERCEL_URL;
  if (!baseUrl) throw new Error('Missing NEXT_PUBLIC_APP_URL or VERCEL_URL environment variable');
  // Ensure no trailing slash and prepend https if needed (VERCEL_URL has no scheme)
  const normalized = baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`;
  return `${normalized.replace(/\/$/, '')}/api/ingest`;
}

// UUID v4 without crypto.randomUUID (works in all Next.js runtimes)
function generateUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Returns a 202 NextResponse on QStash failure, null on success.
async function publishIngestJob(
  jobId: string,
  sourceId: string,
  tenantId: string,
): Promise<NextResponse | null> {
  try {
    await getQStashClient().publishJSON({
      url: getIngestUrl(),
      body: { jobId, tenantId },
      timeout: 55,
      retries: 2,
    });
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[upload][POST] Failed to publish to QStash: ${message}`);
    return NextResponse.json(
      { jobId, sourceId, warning: 'QStash publish failed — job queued but not triggered' },
      { status: 202 },
    );
  }
}

// Validates MIME/size, uploads to Storage. Returns { storagePath, ext } or a NextResponse on error.
async function validateAndUploadFile(
  supabase: ReturnType<typeof createServiceClient>,
  tenantId: string,
  file: File,
): Promise<{ storagePath: string; ext: string } | NextResponse> {
  const mimeType = file.type;
  const ext = ALLOWED_MIME_TYPES[mimeType];
  if (!ext) {
    return NextResponse.json(
      { error: `Unsupported file type: ${mimeType}. Allowed: PDF, CSV` },
      { status: 415 },
    );
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { error: `File too large: ${file.size} bytes. Maximum is 10 MB` },
      { status: 413 },
    );
  }
  const storagePath = `${tenantId}/${generateUuid()}.${ext}`;
  const { error: storageError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, await file.arrayBuffer(), { contentType: mimeType, upsert: false });
  if (storageError) {
    console.error('[upload][POST] Storage upload failed:', storageError);
    return NextResponse.json({ error: 'Failed to upload file to storage' }, { status: 500 });
  }
  return { storagePath, ext };
}

async function handleTextUpload(
  supabase: ReturnType<typeof createServiceClient>,
  tenantId: string,
  name: FormDataEntryValue | null,
  rawText: string,
): Promise<NextResponse> {
  const sourceName = typeof name === 'string' && name.trim() !== '' ? name.trim() : 'Texto libre';
  const { data: source, error: sourceError } = await supabase
    .from('knowledge_sources')
    .insert({ tenant_id: tenantId, name: sourceName, source_type: 'text' as const, raw_text: rawText.trim() })
    .select('id')
    .single();
  if (sourceError || !source) {
    console.error('[upload][POST] Failed to insert knowledge_source (text):', sourceError);
    return NextResponse.json({ error: 'Database error creating source' }, { status: 500 });
  }
  const { data: job, error: jobError } = await supabase
    .from('ingestion_jobs')
    .insert({ tenant_id: tenantId, source_id: source.id, status: 'pending' })
    .select('id')
    .single();
  if (jobError || !job) {
    console.error('[upload][POST] Failed to insert ingestion_job (text):', jobError);
    return NextResponse.json({ error: 'Database error creating ingestion job' }, { status: 500 });
  }
  const failureResponse = await publishIngestJob(job.id, source.id, tenantId);
  if (failureResponse) return failureResponse;
  console.info(`[upload][POST] Text source created for tenant=${tenantId} sourceId=${source.id} jobId=${job.id}`);
  return NextResponse.json({ jobId: job.id, sourceId: source.id }, { status: 200 });
}

async function handleFileUpload(
  supabase: ReturnType<typeof createServiceClient>,
  tenantId: string,
  name: FormDataEntryValue | null,
  file: File,
): Promise<NextResponse> {
  const uploadResult = await validateAndUploadFile(supabase, tenantId, file);
  if (uploadResult instanceof NextResponse) return uploadResult;
  const { storagePath, ext } = uploadResult;
  const sourceName = typeof name === 'string' && name.trim() !== '' ? name.trim() : file.name;
  const { data: source, error: sourceError } = await supabase
    .from('knowledge_sources')
    .insert({ tenant_id: tenantId, name: sourceName, source_type: ext as 'pdf' | 'csv', storage_path: storagePath })
    .select('id')
    .single();
  if (sourceError || !source) {
    console.error('[upload][POST] Failed to insert knowledge_source:', sourceError);
    await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]); // best-effort cleanup
    return NextResponse.json({ error: 'Database error creating source' }, { status: 500 });
  }
  const { data: job, error: jobError } = await supabase
    .from('ingestion_jobs')
    .insert({ tenant_id: tenantId, source_id: source.id, status: 'pending' })
    .select('id')
    .single();
  if (jobError || !job) {
    console.error('[upload][POST] Failed to insert ingestion_job:', jobError);
    return NextResponse.json({ error: 'Database error creating ingestion job' }, { status: 500 });
  }
  // Job is in DB as 'pending' — can be re-triggered if QStash fails.
  const failureResponse = await publishIngestJob(job.id, source.id, tenantId);
  if (failureResponse) return failureResponse;
  console.info(`[upload][POST] Uploaded file for tenant=${tenantId} sourceId=${source.id} jobId=${job.id}`);
  return NextResponse.json({ jobId: job.id, sourceId: source.id }, { status: 200 });
}

// POST /api/upload — accepts multipart/form-data with file|text, name, sourceType.
// Validates, stores, creates knowledge_source + ingestion_job, publishes to QStash.
export async function POST(req: NextRequest): Promise<NextResponse> {
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
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = createServiceClient();
  const { data: userRow } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single();
  const tenantId = userRow?.tenant_id;
  if (!tenantId) return NextResponse.json({ error: 'Tenant not found for this user' }, { status: 403 });
  if (sourceType === 'text') {
    if (!rawText || typeof rawText !== 'string' || rawText.trim() === '') {
      return NextResponse.json({ error: 'Missing text field' }, { status: 400 });
    }
    return handleTextUpload(supabase, tenantId, name, rawText);
  }
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file field' }, { status: 400 });
  }
  return handleFileUpload(supabase, tenantId, name, file);
}
