'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  sourceId: string;
  sourceName: string;
}

export default function DeleteSourceButton({ sourceId, sourceName }: Props) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleDelete() {
    if (!confirm(`Delete "${sourceName}"? This will remove all associated chunks.`)) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/knowledge/${sourceId}`, { method: 'DELETE' });
      if (res.ok) {
        router.refresh();
      } else {
        const body = await res.json().catch(() => ({}));
        alert(body?.error ?? 'Failed to delete document');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleDelete}
      disabled={loading}
      className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50 transition-colors"
    >
      {loading ? 'Deleting...' : 'Delete'}
    </button>
  );
}
