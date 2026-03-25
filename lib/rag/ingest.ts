import { createServiceClient } from '@/lib/supabase/service';
import { embedText } from '@/lib/llm/client';

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
 * Fetch and parse a PDF from Supabase Storage.
 * Returns raw extracted text.
 */
async function parsePdf(storagePath: string, tenantId: string): Promise<string> {
  const supabase = createServiceClient();

  const { data, error } = await supabase.storage
    .from('knowledge')
    .download(storagePath);

  if (error || !data) {
    throw new Error(`Failed to download PDF from storage: ${error?.message ?? 'no data'}`);
  }

  const buffer = Buffer.from(await data.arrayBuffer());

  // pdf-parse v2 uses a class-based API with named ESM exports
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  return result.text;
}

/**
 * Fetch and parse a CSV from Supabase Storage.
 * Converts each row to a plain-text sentence: "field1: value1, field2: value2"
 */
async function parseCsv(storagePath: string): Promise<string> {
  const supabase = createServiceClient();

  const { data, error } = await supabase.storage
    .from('knowledge')
    .download(storagePath);

  if (error || !data) {
    throw new Error(`Failed to download CSV from storage: ${error?.message ?? 'no data'}`);
  }

  const csvText = await data.text();

  const Papa = (await import('papaparse')).default;
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  // Convert each row to a sentence: "key1: val1, key2: val2"
  const lines = result.data.map((row) =>
    Object.entries(row)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ')
  );

  return lines.join('\n');
}

/**
 * Fetch a URL, download its HTML content, and strip tags to get plain text.
 */
async function parseUrl(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'IAWhatsApp-Ingestion/1.0' },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch URL ${url}: HTTP ${response.status}`);
  }

  const html = await response.text();
  const { load } = await import('cheerio');
  const $ = load(html);

  // Remove noise elements
  $('script, style, nav, footer, header, aside, noscript, iframe').remove();

  // Extract text from body, normalize whitespace
  const rawText = $('body').text();
  return rawText.replace(/\s+/g, ' ').trim();
}

// ─── Public API ───────────────────────────────────────────────────────────────

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

  // ── Mark job as processing ────────────────────────────────────────────────
  await supabase
    .from('ingestion_jobs')
    .update({ status: 'processing', started_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('tenant_id', tenantId);

  try {
    // ── Load job + source record ───────────────────────────────────────────
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
      .select('id, source_type, storage_path, source_url')
      .eq('id', job.source_id)
      .eq('tenant_id', tenantId)
      .single();

    if (sourceError || !source) {
      throw new Error(`Knowledge source not found for job ${jobId}`);
    }

    // ── Parse document → raw text ─────────────────────────────────────────
    let rawText: string;

    switch (source.source_type) {
      case 'pdf': {
        if (!source.storage_path) {
          throw new Error('PDF source is missing storage_path');
        }
        rawText = await parsePdf(source.storage_path, tenantId);
        break;
      }
      case 'csv': {
        if (!source.storage_path) {
          throw new Error('CSV source is missing storage_path');
        }
        rawText = await parseCsv(source.storage_path);
        break;
      }
      case 'url': {
        if (!source.source_url) {
          throw new Error('URL source is missing source_url');
        }
        rawText = await parseUrl(source.source_url);
        break;
      }
      default: {
        throw new Error(`Unsupported source_type: ${source.source_type}`);
      }
    }

    if (!rawText || rawText.trim().length === 0) {
      throw new Error('Parsed document produced no text content');
    }

    // ── Chunk text ────────────────────────────────────────────────────────
    const chunks = chunkText(rawText);

    if (chunks.length === 0) {
      throw new Error('Chunking produced zero chunks');
    }

    // ── Embed + upsert each chunk ─────────────────────────────────────────
    // Process sequentially to avoid overwhelming the OpenAI embeddings API
    // and to keep memory usage predictable for large documents.
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

    // ── Update knowledge_sources.chunk_count ─────────────────────────────
    await supabase
      .from('knowledge_sources')
      .update({ chunk_count: chunks.length })
      .eq('id', source.id)
      .eq('tenant_id', tenantId);

    // ── Mark job complete ─────────────────────────────────────────────────
    await supabase
      .from('ingestion_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .eq('tenant_id', tenantId);

    console.info(
      `[ingest] Completed jobId=${jobId} sourceId=${source.id} chunks=${chunks.length}`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ingest] Failed jobId=${jobId}: ${message}`);

    // Mark job as failed — do not throw so the worker returns 200 to QStash
    // (retrying a parse failure won't help; manual re-upload is required)
    await supabase
      .from('ingestion_jobs')
      .update({
        status: 'failed',
        error: message,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .eq('tenant_id', tenantId);

    // Re-throw so the caller can decide whether to propagate to QStash
    throw err;
  }
}
