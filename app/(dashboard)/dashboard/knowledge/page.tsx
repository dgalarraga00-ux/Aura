import { createSupabaseServerClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import DeleteSourceButton from './DeleteSourceButton';

export default async function KnowledgePage() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Verify role — only admin can access
  const { data: userDataRaw } = await supabase
    .from('users')
    .select('role, tenant_id')
    .eq('id', user.id)
    .single();

  const userData = userDataRaw as { role: string; tenant_id: string | null } | null;

  const role = userData?.role;
  if (role === 'tenant_operator') {
    redirect('/dashboard/conversations');
  }

  type IngestionJobRow = {
    id: string;
    status: string;
    error: string | null;
    completed_at: string | null;
  };

  type SourceRow = {
    id: string;
    name: string;
    source_type: string;
    storage_path: string | null;
    source_url: string | null;
    chunk_count: number;
    created_at: string;
    ingestion_jobs: IngestionJobRow | IngestionJobRow[] | null;
  };

  // Fetch knowledge sources with their latest ingestion job status
  const { data: rawSources, error } = await supabase
    .from('knowledge_sources')
    .select(
      `
      id,
      name,
      source_type,
      storage_path,
      source_url,
      chunk_count,
      created_at,
      ingestion_jobs (
        id,
        status,
        error,
        completed_at
      )
    `
    )
    .order('created_at', { ascending: false });

  const sources = rawSources as SourceRow[] | null;

  if (error) {
    console.error('[knowledge][page] query error:', error.message);
  }

  const statusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-700';
      case 'processing':
        return 'bg-yellow-100 text-yellow-700';
      case 'failed':
        return 'bg-red-100 text-red-700';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-gray-900">Knowledge Base</h1>
        <Link
          href="/dashboard/knowledge/upload"
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md transition-colors"
        >
          + Upload Document
        </Link>
      </div>

      {!sources || sources.length === 0 ? (
        <p className="text-sm text-gray-500">No documents yet. Upload your first document!</p>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                  Name
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                  Type
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                  Chunks
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                  Status
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                  Date
                </th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sources.map((src) => {
                const jobs = Array.isArray(src.ingestion_jobs)
                  ? src.ingestion_jobs
                  : src.ingestion_jobs
                  ? [src.ingestion_jobs]
                  : [];
                // Get the most recent job
                const latestJob = jobs.sort(
                  (a: IngestionJobRow, b: IngestionJobRow) =>
                    new Date(b.completed_at ?? '').getTime() -
                    new Date(a.completed_at ?? '').getTime()
                )[0];

                return (
                  <tr key={src.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {src.name}
                      {src.source_url && (
                        <p className="text-xs text-gray-400 truncate max-w-xs">{src.source_url}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600 uppercase text-xs">{src.source_type}</td>
                    <td className="px-4 py-3 text-gray-600">{src.chunk_count}</td>
                    <td className="px-4 py-3">
                      {latestJob ? (
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusBadge(latestJob.status)}`}
                        >
                          {latestJob.status}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                      {latestJob?.error && (
                        <p className="text-xs text-red-500 mt-0.5 truncate max-w-xs">
                          {latestJob.error}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {new Date(src.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <DeleteSourceButton sourceId={src.id} sourceName={src.name} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
