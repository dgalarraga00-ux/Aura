'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface BotConfig {
  system_prompt: string;
  handoff_keywords: string[];
  rag_score_threshold: number;
  language: string;
  max_tokens: number;
}

interface Props {
  tenantId: string;
  tenantName: string;
  initialConfig: BotConfig | null;
}

const DEFAULT_SYSTEM_PROMPT =
  'Sos un asistente de atención al cliente de [nombre del negocio]. Respondés preguntas sobre productos, precios, horarios y servicios usando la información de tu base de conocimiento. Sos amable, conciso y siempre en español. Si no sabés algo, lo decís claramente y ofrecés conectar con un asesor humano.';

export default function BotConfigForm({ tenantName, initialConfig }: Props) {
  const config = initialConfig ?? {
    system_prompt: '',
    handoff_keywords: [],
    rag_score_threshold: 0.75,
    language: 'es',
    max_tokens: 500,
  };

  const [systemPrompt, setSystemPrompt] = useState(config.system_prompt || DEFAULT_SYSTEM_PROMPT);
  const [keywords, setKeywords] = useState(config.handoff_keywords.join('\n'));
  const [language, setLanguage] = useState(config.language);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);

    const updatedConfig = {
      system_prompt: systemPrompt,
      handoff_keywords: keywords
        .split('\n')
        .map((k) => k.trim())
        .filter(Boolean),
      language,
    };

    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bot_config: updatedConfig }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? 'Failed to save configuration');
        return;
      }

      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <p className="text-xs text-gray-400 mb-4">Tenant: {tenantName}</p>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* System Prompt */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            System Prompt
          </label>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={6}
            placeholder="You are a helpful customer support agent for..."
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
          />
          <p className="text-xs text-gray-400 mt-1">
            Instructions that define the bot&apos;s personality and behavior.
          </p>
        </div>

        {/* Handoff Keywords */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Handoff Keywords
          </label>
          <textarea
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            rows={4}
            placeholder="asesor&#10;humano&#10;urgente&#10;ayuda&#10;persona"
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-400 mt-1">
            One keyword or phrase per line. Messages matching these are escalated immediately.
          </p>
        </div>

        {/* Language */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Language</label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="es">Spanish</option>
            <option value="en">English</option>
            <option value="pt">Portuguese</option>
          </select>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>
        )}

        {saved && (
          <p className="text-sm text-green-600 bg-green-50 px-3 py-2 rounded">
            Configuration saved successfully.
          </p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium rounded-md transition-colors"
        >
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
      </form>
    </div>
  );
}
