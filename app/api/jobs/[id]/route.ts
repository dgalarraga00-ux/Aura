import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * GET /api/jobs/[id]
 * Returns the status of an ingestion job for polling from the dashboard upload form.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: rawJob, error } = await supabase
    .from('ingestion_jobs')
    .select('id, status, error, completed_at')
    .eq('id', id)
    .single();

  const job = rawJob as { id: string; status: string; error: string | null; completed_at: string | null } | null;

  if (error || !job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  return NextResponse.json({
    id: job.id,
    status: job.status,
    error: job.error,
    completedAt: job.completed_at,
  });
}
