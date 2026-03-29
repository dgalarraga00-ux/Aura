import { createServiceClient } from '@/lib/supabase/service';
import { embedText } from '@/lib/llm/client';
import { parseSource, type KnowledgeSource } from '@/lib/rag/parsers/index';
import { chunkTextSemantic } from '@/lib/rag/chunker';

/** Fetch job + source from DB. Throws on not found or tenant mismatch. */
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

  if (jobError || !job) throw new Error(`Ingestion job not found: ${jobId}`);

  const { data: source, error: sourceError } = await supabase
    .from('knowledge_sources')
    .select('id, source_type, storage_path, source_url, raw_text')
    .eq('id', job.source_id)
    .eq('tenant_id', tenantId)
    .single();

  if (sourceError || !source) throw new Error(`Knowledge source not found for job ${jobId}`);

  return {
    id: source.id,
    source_type: source.source_type,
    storage_path: source.storage_path ?? null,
    source_url: source.source_url ?? null,
    raw_text: source.raw_text ?? null,
    sourceId: source.id,
  };
}

/** Mark a job as failed with an error message. */
async function markJobFailed(
  jobId: string,
  tenantId: string,
  message: string,
  supabase: ReturnType<typeof createServiceClient>
): Promise<void> {
  await supabase
    .from('ingestion_jobs')
    .update({ status: 'failed', error: message, completed_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('tenant_id', tenantId);
}

/** Insert a parent chunk (no embedding) and return its DB id. */
async function insertParentChunk(
  content: string,
  chunkIndex: number,
  sourceId: string,
  tenantId: string,
  supabase: ReturnType<typeof createServiceClient>
): Promise<string> {
  const { data, error } = await supabase
    .from('knowledge_chunks')
    .upsert(
      { tenant_id: tenantId, source_id: sourceId, chunk_index: chunkIndex, content, chunk_type: 'parent' },
      { onConflict: 'tenant_id,source_id,chunk_index', ignoreDuplicates: false }
    )
    .select('id')
    .single();
  if (error || !data) throw new Error(`Failed to insert parent chunk ${chunkIndex}: ${error?.message}`);
  return data.id;
}

/** Embed and upsert child chunks linked to their parent. */
async function insertChildChunks(
  children: string[],
  parentId: string,
  parentIndex: number,
  sourceId: string,
  tenantId: string,
  supabase: ReturnType<typeof createServiceClient>
): Promise<void> {
  for (let i = 0; i < children.length; i++) {
    const content = children[i];
    const embedding = await embedText(content);
    const chunkIndex = parentIndex * 1000 + i + 1;
    const { error } = await supabase
      .from('knowledge_chunks')
      .upsert(
        {
          tenant_id: tenantId, source_id: sourceId, chunk_index: chunkIndex,
          content, embedding: embedding as unknown as number[],
          chunk_type: 'child', parent_chunk_id: parentId,
        },
        { onConflict: 'tenant_id,source_id,chunk_index', ignoreDuplicates: false }
      );
    if (error) throw new Error(`Failed to upsert child chunk ${chunkIndex}: ${error.message}`);
  }
}

/**
 * Process a pending ingestion job: parse the source, split into semantic
 * parent-child chunks, embed children, and upsert into knowledge_chunks.
 *
 * Two-pass ingestion:
 *  1. Insert parent chunk (no embedding, chunk_type='parent')
 *  2. Insert child chunks (with embeddings, chunk_type='child', parent_chunk_id set)
 *
 * On success: updates ingestion_jobs.status to 'completed'.
 * On failure: updates ingestion_jobs.status to 'failed' with error message.
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

    const pairs = chunkTextSemantic(rawText);
    if (pairs.length === 0) throw new Error('Chunking produced zero chunks');

    let childCount = 0;
    for (let i = 0; i < pairs.length; i++) {
      const { parent, children } = pairs[i];
      const parentId = await insertParentChunk(parent, i * 1000, source.id, tenantId, supabase);
      await insertChildChunks(children, parentId, i, source.id, tenantId, supabase);
      childCount += children.length;
    }

    await supabase.from('knowledge_sources').update({ chunk_count: childCount })
      .eq('id', source.id).eq('tenant_id', tenantId);

    await supabase.from('ingestion_jobs')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', jobId).eq('tenant_id', tenantId);

    console.info(`[ingest] Completed jobId=${jobId} sourceId=${source.id} parents=${pairs.length} children=${childCount}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ingest] Failed jobId=${jobId}: ${message}`);
    await markJobFailed(jobId, tenantId, message, supabase);
    throw err;
  }
}
