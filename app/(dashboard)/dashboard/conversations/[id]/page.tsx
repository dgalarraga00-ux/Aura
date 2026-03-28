import { createSupabaseServerClient } from '@/lib/supabase/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import ResolveHandoffButton from './ResolveHandoffButton';
import AgentReplyInput from './AgentReplyInput';
type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

interface PageProps {
  params: Promise<{ id: string }>;
}

interface ConvWithContact {
  id: string;
  tenant_id: string;
  is_escalated: boolean;
  escalated_at: string | null;
  escalation_trigger: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
  contacts: { phone: string; name: string | null } | { phone: string; name: string | null }[] | null;
}

interface MessageRow {
  id: string;
  direction: 'inbound' | 'outbound';
  message_type: string;
  content: string | null;
  llm_response: string | null;
  rag_score: number | null;
  status: string;
  created_at: string;
}

async function fetchConversation(
  supabase: SupabaseServerClient,
  id: string
): Promise<ConvWithContact> {
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

  if (convError || !conversation) notFound();
  return conversation;
}

function MessageBubble({ msg }: { msg: MessageRow }) {
  const isInbound = msg.direction === 'inbound';
  return (
    <div className={`flex ${isInbound ? 'justify-start' : 'justify-end'}`}>
      <div className={`max-w-xs lg:max-w-md px-4 py-2 rounded-2xl text-sm ${isInbound ? 'bg-white border border-gray-200 text-gray-900' : 'bg-blue-600 text-white'}`}>
        <p>{msg.content ?? msg.llm_response ?? `[${msg.message_type}]`}</p>
        <p className={`text-xs mt-1 ${isInbound ? 'text-gray-400' : 'text-blue-200'}`}>
          {new Date(msg.created_at).toLocaleTimeString()}
          {msg.rag_score != null && <span className="ml-2">RAG: {msg.rag_score.toFixed(2)}</span>}
        </p>
      </div>
    </div>
  );
}

async function fetchMessages(
  supabase: SupabaseServerClient,
  conversationId: string
): Promise<MessageRow[]> {
  const { data: rawMessages } = await supabase
    .from('messages')
    .select('id, direction, message_type, content, llm_response, rag_score, status, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(200);

  return (rawMessages as MessageRow[] | null) ?? [];
}

interface HeaderProps {
  conversation: ConvWithContact;
  contact: { phone: string; name: string | null } | null;
  isEscalated: boolean;
}

function ConversationHeader({ conversation, contact, isEscalated }: HeaderProps) {
  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/conversations" className="text-sm text-gray-500 hover:text-gray-900">
            &larr; Back
          </Link>
          <h1 className="text-xl font-semibold text-gray-900">
            {contact?.name ?? contact?.phone ?? 'Conversation'}
          </h1>
          {isEscalated && (
            <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">Escalated</span>
          )}
          {conversation.resolved_at && (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Resolved</span>
          )}
        </div>
        {isEscalated && (
          <ResolveHandoffButton conversationId={conversation.id} tenantId={conversation.tenant_id} />
        )}
      </div>
      <div className="text-xs text-gray-400 mb-4 space-x-4">
        <span>Phone: {contact?.phone}</span>
        {conversation.escalation_trigger && <span>Trigger: {conversation.escalation_trigger}</span>}
        <span>Started: {new Date(conversation.created_at).toLocaleString()}</span>
      </div>
    </>
  );
}

export default async function ConversationDetailPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [conversation, messages] = await Promise.all([
    fetchConversation(supabase, id),
    fetchMessages(supabase, id),
  ]);

  const contact = Array.isArray(conversation.contacts)
    ? conversation.contacts[0]
    : conversation.contacts;
  const isEscalated = conversation.is_escalated && !conversation.resolved_at;

  return (
    <div>
      <ConversationHeader conversation={conversation} contact={contact} isEscalated={isEscalated} />
      <div className="space-y-3 max-w-2xl">
        {messages.length === 0
          ? <p className="text-sm text-gray-500">No messages yet.</p>
          : messages.map((msg) => <MessageBubble key={msg.id} msg={msg} />)
        }
      </div>
      {isEscalated && (
        <AgentReplyInput
          conversationId={conversation.id}
          contactName={contact?.name ?? contact?.phone ?? ''}
        />
      )}
    </div>
  );
}
