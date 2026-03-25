'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';

type UploadMode = 'file' | 'url' | 'text';
type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

interface JobPollResult {
  status: JobStatus;
  error?: string;
}

export default function UploadForm() {
  const [mode, setMode] = useState<UploadMode>('file');
  const [url, setUrl] = useState('');
  const [textTitle, setTextTitle] = useState('Horarios de atención');
  const [textContent, setTextContent] = useState(
`Atendemos de lunes a viernes de 9 a 18hs.
Sábados de 9 a 13hs.
Domingos cerrado.
Feriados nacionales permanecemos cerrados.

---
Otros ejemplos de entradas que podés crear por separado:

Título: Planes y precios
Plan Básico: $10/mes. Incluye X, Y, Z.
Plan Pro: $25/mes. Incluye todo el básico más A, B, C.
Plan Enterprise: precio a consultar.

Título: Catálogo de productos
Producto A: descripción, precio, disponibilidad.
Producto B: descripción, precio, disponibilidad.

Tip: creá una entrada separada por cada tema para mejores resultados.`
  );
  const [uploading, setUploading] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Poll job status every 3 seconds
  function startPolling(id: string) {
    setJobId(id);
    setJobStatus('pending');

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${id}`);
        if (!res.ok) return;
        const data: JobPollResult = await res.json();
        setJobStatus(data.status);

        if (data.status === 'completed') {
          clearInterval(interval);
          setTimeout(() => router.push('/dashboard/knowledge'), 1500);
        } else if (data.status === 'failed') {
          clearInterval(interval);
          setError(data.error ?? 'Ingestion failed');
        }
      } catch {
        // Network error during polling — keep trying
      }
    }, 3000);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setUploading(true);

    try {
      const formData = new FormData();

      if (mode === 'file') {
        const file = fileRef.current?.files?.[0];
        if (!file) {
          setError('Please select a file');
          return;
        }
        formData.append('file', file);
        formData.append('sourceType', file.type.includes('csv') ? 'csv' : 'pdf');
        formData.append('name', file.name);
      } else if (mode === 'url') {
        if (!url.trim()) {
          setError('Please enter a URL');
          return;
        }
        formData.append('url', url.trim());
        formData.append('sourceType', 'url');
        formData.append('name', new URL(url.trim()).hostname);
      } else if (mode === 'text') {
        if (!textContent.trim() || !textTitle.trim()) {
          setError('Por favor completá el título y el contenido');
          return;
        }
        formData.append('text', textContent.trim());
        formData.append('sourceType', 'text');
        formData.append('name', textTitle.trim());
      }

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const body = await res.json();

      if (!res.ok) {
        setError(body?.error ?? 'Upload failed');
        return;
      }

      startPolling(body.jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  const jobStatusLabel: Record<JobStatus, string> = {
    pending: 'Queued — waiting to process...',
    processing: 'Processing document...',
    completed: 'Done! Redirecting...',
    failed: 'Failed',
  };

  const jobStatusColor: Record<JobStatus, string> = {
    pending: 'text-gray-600',
    processing: 'text-yellow-600',
    completed: 'text-green-600',
    failed: 'text-red-600',
  };

  return (
    <div className="max-w-lg">
      {/* Mode toggle */}
      <div className="flex gap-2 mb-6">
        {(['file', 'url', 'text'] as UploadMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              mode === m
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            {m === 'file' ? 'Upload File (PDF/CSV)' : m === 'url' ? 'URL' : 'Texto libre'}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {mode === 'file' ? (
          <div key="file">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              File (PDF or CSV, max 10MB)
            </label>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.csv,application/pdf,text/csv"
              required
              className="block w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-blue-50 file:text-blue-700 file:font-medium hover:file:bg-blue-100"
            />
          </div>
        ) : mode === 'url' ? (
          <div key="url">
            <label className="block text-sm font-medium text-gray-700 mb-1">URL</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/page"
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        ) : (
          <div key="text" className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Título</label>
              <input
                type="text"
                value={textTitle}
                onChange={(e) => setTextTitle(e.target.value)}
                placeholder="Ej: Horarios de atención"
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Contenido</label>
              <textarea
                value={textContent}
                onChange={(e) => setTextContent(e.target.value)}
                placeholder="Escribí aquí la información que el bot debe conocer..."
                required
                rows={8}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>
        )}

        {jobStatus && (
          <div className="px-3 py-2 bg-gray-50 rounded border border-gray-200">
            <p className={`text-sm font-medium ${jobStatusColor[jobStatus]}`}>
              {jobStatusLabel[jobStatus]}
            </p>
            {jobId && (
              <p className="text-xs text-gray-400 mt-0.5">Job ID: {jobId}</p>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={uploading || (jobStatus != null && jobStatus !== 'failed')}
          className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium rounded-md transition-colors"
        >
          {uploading ? 'Uploading...' : 'Upload'}
        </button>
      </form>
    </div>
  );
}
