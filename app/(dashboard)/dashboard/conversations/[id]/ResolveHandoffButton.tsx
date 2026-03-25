'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  conversationId: string;
  tenantId: string;
}

export default function ResolveHandoffButton({ conversationId }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleResolve() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/handoffs/${conversationId}/resolve`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? 'Failed to resolve handoff');
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        onClick={handleResolve}
        disabled={loading}
        className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white text-sm font-medium rounded-md transition-colors"
      >
        {loading ? 'Resolving...' : 'Resolve Handoff'}
      </button>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}
