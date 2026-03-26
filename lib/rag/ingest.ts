import { createServiceClient } from '@/lib/supabase/service';
import { embedText } from '@/lib/llm/client';
import { parseSource, type KnowledgeSource } from '@/lib/rag/parsers/index';

// ─── Chunking config ──────────────────────────────────────────────────────────
// Approximate token counts using character-based heuristic:
// 1 token ≈ 4 characters (works reasonably for Spanish and English)
const CHUNK_SIZE_TOKENS = 500;
const CHUNK_OVERLAP_TOKENS = 50;
const CHARS_PER_TOKEN = 4;
const CHUNK_SIZE_CHARS = CHUNK_SIZE_TOKENS * CHARS_PER_TOKEN;   // 2000 chars
const CHUNK_OVERLAP_CHARS = CHUNK_OVERLAP_TOKENS * CHARS_PER_TOKEN; // 200 chars

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Split a long text into overlapping chunks using a sliding window.
 * Uses character-based approximation: 1 token ≈ 4 chars.
 *
 * @param text - Full document text
 * @returns Array of chunk strings
 */
function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE_CHARS, text.length);
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    // Advance by chunk size minus overlap so chunks share context at boundaries
    start += CHUNK_SIZE_CHARS - CHUNK_OVERLAP_CHARS;
  }

  return chunks;
}

/**
 * Embed each chunk and upsert into knowledge_chunks.
 * Processes sequentially to avoid overwhelming the embeddings API.
 */
async function embedAndUpsertChunks(
  chunks: string[],
  source: KnowledgeSource,
  tenantId: string,
  supabase: ReturnType<typeof createServiceClient>
): Promise<void> {
  for (let i = 0; i < chunks.length; i++) {
    const content = chunks[i];
    const embedding = await embedText(content);

    // Upsert: ON CONFLICT (tenant_id, source_id, chunk_index) DO UPDATE
    // This allows re-ingestion of the same source without duplicates.
    const { error: upsertError } = await supabase
      .from('knowledge_chunks')
      .upsert(
        {
          tenant_id: tenantId,
          source_id: source.id,
          chunk_index: i,
          content,
          embedding: embedding as unknown as number[],
        },
        {
          onConflict: 'tenant_id,source_id,chunk_index',
          ignoreDuplicates: false, // DO UPDATE SET
        }
      );

    if (upsertError) {
      throw new Error(`Failed to upsert chunk ${i} for source ${source.id}: ${upsertError.message}`);
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Fetch job and its associated knowledge source from DB. Throws on not found. */
async function fetchJobAndSource(
  jobId: string,
  tenantId: string,
  supabase: ReturnType<typeof createServiceClient>
): Promise<KnowledgeSource & { sourceId: string }> {
  const { data: job, error: jobError } = await supabase
    .from('ingestion_jobs')
    .select('id, source_id, tenant_id')
    .eq('id', jobId)
    .eq('tenant_id', tenantId)
    .single();

  if (jobError || !job) {
    throw new Error(`Ingestion job not found: ${jobId}`);
  }

  const { data: source, error: sourceError } = await supabase
    .from('knowledge_sources')
    .select('id, source_type, storage_path, source_url, raw_text')
    .eq('id', job.source_id)
    .eq('tenant_id', tenantId)
    .single();

  if (sourceError || !source) {
    throw new Error(`Knowledge source not found for job ${jobId}`);
  }

  return { ...source, sourceId: source.id };
}

/** Mark a job as failed with an error message. */
async function markJobFailed(
  jobId: string,
  tenantId: string,
  message: string,
  supabase: ReturnType<typeof createServiceClient>
): Promise<void> {
  // Retrying a parse failure won't help — manual re-upload is required
  await supabase
    .from('ingestion_jobs')
    .update({ status: 'failed', error: message, completed_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('tenant_id', tenantId);
}

/**
 * Process a pending ingestion job: parse the source file, split into chunks,
 * generate embeddings, and upsert into `knowledge_chunks`.
 *
 * On success: updates `ingestion_jobs.status` to `completed`.
 * On failure: updates `ingestion_jobs.status` to `failed` with error message.
 *
 * Supports source_type: `pdf`, `csv`, `url`
 *
 * @param jobId    - UUID of the ingestion_jobs row
 * @param tenantId - UUID of the tenant (used for storage path + chunk tenant filter)
 */
export async function ingestSource(jobId: string, tenantId: string): Promise<void> {
  const supabase = createServiceClient();

  await supabase
    .from('ingestion_jobs')
    .update({ status: 'processing', started_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('tenant_id', tenantId);

  try {
    const source = await fetchJobAndSource(jobId, tenantId, supabase);

    const rawText = await parseSource(source);
    if (!rawText || rawText.trim().length === 0) {
      throw new Error('Parsed document produced no text content');
    }

    const chunks = chunkText(rawText);
    if (chunks.length === 0) throw new Error('Chunking produced zero chunks');

    await embedAndUpsertChunks(chunks, source, tenantId, supabase);

    await supabase
      .from('knowledge_sources')
      .update({ chunk_count: chunks.length })
      .eq('id', source.id)
      .eq('tenant_id', tenantId);

    await supabase
      .from('ingestion_jobs')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', jobId)
      .eq('tenant_id', tenantId);

    console.info(`[ingest] Completed jobId=${jobId} sourceId=${source.id} chunks=${chunks.length}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ingest] Failed jobId=${jobId}: ${message}`);
    await markJobFailed(jobId, tenantId, message, supabase);
    // Re-throw so the caller can decide whether to propagate to QStash
    throw err;
  }
}
