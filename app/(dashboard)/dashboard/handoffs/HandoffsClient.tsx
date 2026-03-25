'use client';

import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import Link from 'next/link';
import type { Database } from '@/types/database';

type ConversationRow = {
  id: string;
  tenant_id: string;
  is_escalated: boolean;
  escalated_at: string | null;
  escalation_trigger: Database['public']['Enums']['escalation_trigger_enum'] | null;
  created_at: string;
  updated_at: string;
  contacts: { phone: string; name: string | null } | { phone: string; name: string | null }[] | null;
};

interface Props {
  initialHandoffs: ConversationRow[];
  tenantId: string;
  userId: string;
}

export default function HandoffsClient({ initialHandoffs, tenantId }: Props) {
  const [handoffs, setHandoffs] = useState<ConversationRow[]>(initialHandoffs);
  const [resolving, setResolving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // Subscribe to Realtime — new handoffs pushed from triggerHandoff()
  useEffect(() => {
    if (!tenantId) return;

    const channel = supabase
      .channel(`tenant:${tenantId}:handoffs`)
      .on('broadcast', { event: 'new_handoff' }, (payload) => {
        const data = payload.payload as {
          conversation_id: string;
          from_number: string;
          trigger_type: Database['public']['Enums']['escalation_trigger_enum'];
          escalated_at: string;
          preview?: string;
        };

        // Add the new handoff optimistically to the top of the list
        setHandoffs((prev) => {
          // Avoid duplicates
          if (prev.some((h) => h.id === data.conversation_id)) return prev;
          const newEntry: ConversationRow = {
            id: data.conversation_id,
            tenant_id: tenantId,
            is_escalated: true,
            escalated_at: data.escalated_at,
            escalation_trigger: data.trigger_type,
            created_at: data.escalated_at,
            updated_at: data.escalated_at,
            contacts: { phone: data.from_number, name: null },
          };
          return [newEntry, ...prev];
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function handleResolve(conversationId: string) {
    setResolving(conversationId);
    setError(null);
    try {
      const res = await fetch(`/api/handoffs/${conversationId}/resolve`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? 'Failed to resolve');
        return;
      }
      // Remove from local list immediately
      setHandoffs((prev) => prev.filter((h) => h.id !== conversationId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setResolving(null);
    }
  }

  if (handoffs.length === 0) {
    return (
      <p className="text-sm text-gray-500">No escalated conversations. All clear!</p>
    );
  }

  return (
    <div>
      {error && (
        <p className="mb-3 text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>
      )}
      <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
        {handoffs.map((conv) => {
          const contact = Array.isArray(conv.contacts) ? conv.contacts[0] : conv.contacts;
          return (
            <div key={conv.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {contact?.name ?? contact?.phone ?? 'Unknown'}
                </p>
                <p className="text-xs text-gray-500">{contact?.phone}</p>
                {conv.escalation_trigger && (
                  <p className="text-xs text-orange-600 mt-0.5">
                    Trigger: {conv.escalation_trigger}
                  </p>
                )}
                {conv.escalated_at && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    {new Date(conv.escalated_at).toLocaleString()}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={`/dashboard/conversations/${conv.id}`}
                  className="text-xs text-blue-600 hover:underline"
                >
                  View
                </Link>
                <button
                  onClick={() => handleResolve(conv.id)}
                  disabled={resolving === conv.id}
                  className="px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white text-xs font-medium rounded-md transition-colors"
                >
                  {resolving === conv.id ? 'Resolving...' : 'Resolve'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
