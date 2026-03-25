import { createSupabaseServerClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';

type StatusFilter = 'all' | 'active' | 'escalated' | 'resolved';

interface PageProps {
  searchParams: Promise<{ status?: string }>;
}

function statusBadge(isEscalated: boolean, resolvedAt: string | null) {
  if (resolvedAt) return { label: 'Resolved', cls: 'bg-green-100 text-green-700' };
  if (isEscalated) return { label: 'Escalated', cls: 'bg-red-100 text-red-700' };
  return { label: 'Active', cls: 'bg-blue-100 text-blue-700' };
}

export default async function ConversationsPage({ searchParams }: PageProps) {
  const supabase = await createSupabaseServerClient();
  const { status = 'all' } = await searchParams;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Build query — RLS ensures tenant isolation automatically
  let query = supabase
    .from('conversations')
    .select(
      `
      id,
      is_escalated,
      escalated_at,
      escalation_trigger,
      resolved_at,
      created_at,
      updated_at,
      contacts ( phone, name )
    `
    )
    .order('updated_at', { ascending: false })
    .limit(100);

  if (status === 'active') {
    query = query.eq('is_escalated', false).is('resolved_at', null);
  } else if (status === 'escalated') {
    query = query.eq('is_escalated', true).is('resolved_at', null);
  } else if (status === 'resolved') {
    query = query.not('resolved_at', 'is', null);
  }

  const { data: rawConversations, error } = await query;

  if (error) {
    console.error('[conversations][page] query error:', error.message);
  }

  type ConvRow = {
    id: string;
    is_escalated: boolean;
    escalated_at: string | null;
    escalation_trigger: string | null;
    resolved_at: string | null;
    created_at: string;
    updated_at: string;
    contacts: { phone: string; name: string | null } | { phone: string; name: string | null }[] | null;
  };
  const conversations = rawConversations as ConvRow[] | null;

  const filters: { label: string; value: StatusFilter }[] = [
    { label: 'All', value: 'all' },
    { label: 'Active', value: 'active' },
    { label: 'Escalated', value: 'escalated' },
    { label: 'Resolved', value: 'resolved' },
  ];

  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900 mb-4">Conversations</h1>

      {/* Status filter */}
      <div className="flex gap-2 mb-6">
        {filters.map((f) => (
          <Link
            key={f.value}
            href={`/dashboard/conversations?status=${f.value}`}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              status === f.value
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {/* Conversation list */}
      {!conversations || conversations.length === 0 ? (
        <p className="text-sm text-gray-500">No conversations found.</p>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
          {conversations.map((conv) => {
            const contact = Array.isArray(conv.contacts) ? conv.contacts[0] : conv.contacts;
            const badge = statusBadge(conv.is_escalated, conv.resolved_at);
            return (
              <Link
                key={conv.id}
                href={`/dashboard/conversations/${conv.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {contact?.name ?? contact?.phone ?? 'Unknown'}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">{contact?.phone}</p>
                  {conv.escalation_trigger && (
                    <p className="text-xs text-orange-600 mt-0.5">
                      Trigger: {conv.escalation_trigger}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}
                  >
                    {badge.label}
                  </span>
                  <span className="text-xs text-gray-400">
                    {new Date(conv.updated_at).toLocaleDateString()}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
