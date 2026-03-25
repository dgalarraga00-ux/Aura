import { createSupabaseServerClient } from '@/lib/supabase/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import ResolveHandoffButton from './ResolveHandoffButton';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ConversationDetailPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Fetch user role
  const { data: userDataRaw } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single();
  const userData = userDataRaw as { role: 'saas_admin' | 'tenant_admin' | 'tenant_operator' } | null;
  const role = userData?.role ?? 'tenant_operator';
  void role; // RBAC info available for future use
  // All roles except unauthenticated can resolve handoffs per spec
  const canResolveHandoff = true;

  type ConvWithContact = {
    id: string;
    tenant_id: string;
    is_escalated: boolean;
    escalated_at: string | null;
    escalation_trigger: string | null;
    resolved_at: string | null;
    resolved_by: string | null;
    created_at: string;
    contacts: { phone: string; name: string | null } | { phone: string; name: string | null }[] | null;
  };

  type MessageRow = {
    id: string;
    direction: 'inbound' | 'outbound';
    message_type: string;
    content: string | null;
    llm_response: string | null;
    rag_score: number | null;
    status: string;
    created_at: string;
  };

  // Fetch conversation with contact
  const { data: rawConversation, error: convError } = await supabase
    .from('conversations')
    .select(
      `
      id,
      tenant_id,
      is_escalated,
      escalated_at,
      escalation_trigger,
      resolved_at,
      resolved_by,
      created_at,
      contacts ( phone, name )
    `
    )
    .eq('id', id)
    .single();

  const conversation = rawConversation as ConvWithContact | null;

  if (convError || !conversation) {
    notFound();
  }

  // Fetch messages ordered chronologically
  const { data: rawMessages } = await supabase
    .from('messages')
    .select('id, direction, message_type, content, llm_response, rag_score, status, created_at')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true })
    .limit(200);

  const messages = rawMessages as MessageRow[] | null;

  const contact = Array.isArray(conversation.contacts)
    ? conversation.contacts[0]
    : conversation.contacts;

  const isEscalated = conversation.is_escalated && !conversation.resolved_at;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/conversations"
            className="text-sm text-gray-500 hover:text-gray-900"
          >
            &larr; Back
          </Link>
          <h1 className="text-xl font-semibold text-gray-900">
            {contact?.name ?? contact?.phone ?? 'Conversation'}
          </h1>
          {isEscalated && (
            <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
              Escalated
            </span>
          )}
          {conversation.resolved_at && (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
              Resolved
            </span>
          )}
        </div>

        {isEscalated && canResolveHandoff && (
          <ResolveHandoffButton
            conversationId={conversation.id}
            tenantId={conversation.tenant_id}
          />
        )}
      </div>

      {/* Conversation metadata */}
      <div className="text-xs text-gray-400 mb-4 space-x-4">
        <span>Phone: {contact?.phone}</span>
        {conversation.escalation_trigger && (
          <span>Trigger: {conversation.escalation_trigger}</span>
        )}
        <span>Started: {new Date(conversation.created_at).toLocaleString()}</span>
      </div>

      {/* Message thread */}
      <div className="space-y-3 max-w-2xl">
        {!messages || messages.length === 0 ? (
          <p className="text-sm text-gray-500">No messages yet.</p>
        ) : (
          messages.map((msg) => {
            const isInbound = msg.direction === 'inbound';
            return (
              <div
                key={msg.id}
                className={`flex ${isInbound ? 'justify-start' : 'justify-end'}`}
              >
                <div
                  className={`max-w-xs lg:max-w-md px-4 py-2 rounded-2xl text-sm ${
                    isInbound
                      ? 'bg-white border border-gray-200 text-gray-900'
                      : 'bg-blue-600 text-white'
                  }`}
                >
                  <p>{msg.content ?? msg.llm_response ?? `[${msg.message_type}]`}</p>
                  <p
                    className={`text-xs mt-1 ${isInbound ? 'text-gray-400' : 'text-blue-200'}`}
                  >
                    {new Date(msg.created_at).toLocaleTimeString()}
                    {msg.rag_score != null && (
                      <span className="ml-2">RAG: {msg.rag_score.toFixed(2)}</span>
                    )}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
