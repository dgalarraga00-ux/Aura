'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  conversationId: string;
  contactName: string;
}

async function submitAgentReply(
  conversationId: string,
  text: string
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/agent/reply/${conversationId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    return { ok: false, error: body?.error ?? 'Error al enviar el mensaje' };
  }

  return { ok: true };
}

interface FormProps {
  text: string; loading: boolean; error: string | null; success: boolean;
  onTextChange: (v: string) => void; onSubmit: (e: React.FormEvent) => void;
  contactName: string;
}

function ReplyForm({ text, loading, error, success, onTextChange, onSubmit, contactName }: FormProps) {
  return (
    <div className="mt-6 max-w-2xl bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
        Responder como agente
        {contactName && <span className="ml-1 font-normal normal-case text-gray-400">— a {contactName}</span>}
      </p>
      <form onSubmit={onSubmit} className="space-y-3">
        <textarea value={text} onChange={(e) => onTextChange(e.target.value)} rows={3}
          disabled={loading} placeholder="Escribí tu mensaje..."
          className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50" />
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm">
            {error && <p className="text-red-600">{error}</p>}
            {success && !error && <p className="text-green-600 font-medium">Mensaje enviado</p>}
          </div>
          <button type="submit" disabled={loading || !text.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium rounded-md transition-colors">
            {loading ? 'Enviando...' : 'Enviar'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function AgentReplyInput({ conversationId, contactName }: Props) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    setLoading(true); setError(null);
    try {
      const result = await submitAgentReply(conversationId, trimmed);
      if (!result.ok) { setError(result.error ?? 'Error al enviar'); return; }
      setText(''); setSuccess(true); router.refresh();
      setTimeout(() => setSuccess(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally { setLoading(false); }
  }

  return <ReplyForm text={text} loading={loading} error={error} success={success}
    onTextChange={setText} onSubmit={handleSubmit} contactName={contactName} />;
}

export default AgentReplyInput;
