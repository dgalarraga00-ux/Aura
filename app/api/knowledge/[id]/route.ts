import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * DELETE /api/knowledge/[id]
 *
 * Deletes a knowledge source and cascades:
 * 1. Deletes all knowledge_chunks for this source (cascade via FK or explicit delete)
 * 2. Deletes the file from Supabase Storage (if storage_path is set)
 * 3. Deletes the knowledge_source record
 * 4. Deletes associated ingestion_jobs
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id: sourceId } = await params;

  // Authenticate
  const supabaseUser = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabaseUser.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: userDataRaw } = await supabaseUser
    .from('users')
    .select('role, tenant_id')
    .eq('id', user.id)
    .single();

  const userData = userDataRaw as { role: string; tenant_id: string | null } | null;

  if (!userData || userData.role === 'tenant_operator') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = createServiceClient();

  type SourceRow = { id: string; tenant_id: string; storage_path: string | null; name: string };

  // Fetch the source to get storage_path and tenant_id
  const { data: rawSource, error: srcError } = await supabase
    .from('knowledge_sources')
    .select('id, tenant_id, storage_path, name')
    .eq('id', sourceId)
    .single();

  const source = rawSource as SourceRow | null;

  if (srcError || !source) {
    return NextResponse.json({ error: 'Source not found' }, { status: 404 });
  }

  // Ensure caller belongs to this tenant
  if (userData.role !== 'saas_admin' && userData.tenant_id !== source.tenant_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // ── 1. Delete knowledge_chunks ────────────────────────────────────────────
  const { error: chunksError } = await supabase
    .from('knowledge_chunks')
    .delete()
    .eq('source_id', sourceId)
    .eq('tenant_id', source.tenant_id);

  if (chunksError) {
    console.error('[knowledge][delete] Failed to delete chunks:', chunksError.message);
    return NextResponse.json({ error: 'Failed to delete chunks' }, { status: 500 });
  }

  // ── 2. Delete file from Supabase Storage ─────────────────────────────────
  if (source.storage_path) {
    const { error: storageError } = await supabase.storage
      .from('knowledge')
      .remove([source.storage_path]);

    if (storageError) {
      // Log but continue — file may already be gone
      console.warn('[knowledge][delete] Storage removal failed (non-fatal):', storageError.message);
    }
  }

  // ── 3. Delete ingestion_jobs ──────────────────────────────────────────────
  await supabase.from('ingestion_jobs').delete().eq('source_id', sourceId);

  // ── 4. Delete knowledge_source ────────────────────────────────────────────
  const { error: deleteError } = await supabase
    .from('knowledge_sources')
    .delete()
    .eq('id', sourceId)
    .eq('tenant_id', source.tenant_id);

  if (deleteError) {
    console.error('[knowledge][delete] Failed to delete source:', deleteError.message);
    return NextResponse.json({ error: 'Failed to delete source' }, { status: 500 });
  }

  console.info(
    `[knowledge][delete] Deleted sourceId=${sourceId} name="${source.name}" by userId=${user.id}`
  );

  return NextResponse.json({ success: true });
}
