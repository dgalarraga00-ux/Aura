'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function OnboardingSetupPage() {
  const router = useRouter();

  const [companyName, setCompanyName] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [webhookVerifyToken, setWebhookVerifyToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function generateVerifyToken() {
    setWebhookVerifyToken(crypto.randomUUID());
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: companyName,
          waba_id: wabaId,
          phone_number_id: phoneNumberId,
          access_token: accessToken,
          webhook_verify_token: webhookVerifyToken,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Something went wrong. Please try again.');
        return;
      }

      router.push('/dashboard');
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Set up your WhatsApp account</h1>
          <p className="mt-2 text-gray-600">
            Connect your WhatsApp Business Account to start handling conversations. You can find
            these values in the{' '}
            <a
              href="https://developers.facebook.com/apps"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline"
            >
              Meta for Developers dashboard
            </a>
            .
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 space-y-6"
        >
          {/* Company name */}
          <div>
            <label htmlFor="company_name" className="block text-sm font-medium text-gray-700 mb-1">
              Company name
            </label>
            <input
              id="company_name"
              type="text"
              required
              autoComplete="organization"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Acme Inc."
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
            />
            <p className="mt-1 text-xs text-gray-500">
              The display name for your business in the platform.
            </p>
          </div>

          {/* WABA ID */}
          <div>
            <label htmlFor="waba_id" className="block text-sm font-medium text-gray-700 mb-1">
              WhatsApp Business Account ID
            </label>
            <input
              id="waba_id"
              type="text"
              required
              value={wabaId}
              onChange={(e) => setWabaId(e.target.value)}
              placeholder="123456789012345"
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
            />
            <p className="mt-1 text-xs text-gray-500">
              Found in Meta Business Manager under <strong>WhatsApp &gt; Accounts</strong>. It is a
              numeric ID like <code className="bg-gray-100 px-1 rounded">123456789012345</code>.
            </p>
          </div>

          {/* Phone Number ID */}
          <div>
            <label
              htmlFor="phone_number_id"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Phone Number ID
            </label>
            <input
              id="phone_number_id"
              type="text"
              required
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
              placeholder="987654321098765"
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
            />
            <p className="mt-1 text-xs text-gray-500">
              Found in your Meta App dashboard under <strong>WhatsApp &gt; API Setup</strong>, next
              to your registered phone number.
            </p>
          </div>

          {/* Access token */}
          <div>
            <label
              htmlFor="access_token"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Permanent access token
            </label>
            <input
              id="access_token"
              type="password"
              required
              autoComplete="off"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="EAAxxxxxxxxxxxxxxxx..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
            />
            <p className="mt-1 text-xs text-gray-500">
              Generate a <strong>System User access token</strong> in Meta Business Manager with{' '}
              <code className="bg-gray-100 px-1 rounded">whatsapp_business_messaging</code> and{' '}
              <code className="bg-gray-100 px-1 rounded">whatsapp_business_management</code>{' '}
              permissions. This token is stored encrypted and never visible after saving.
            </p>
          </div>

          {/* Webhook verify token */}
          <div>
            <label
              htmlFor="webhook_verify_token"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Webhook verification token
            </label>
            <div className="flex gap-2">
              <input
                id="webhook_verify_token"
                type="text"
                required
                value={webhookVerifyToken}
                onChange={(e) => setWebhookVerifyToken(e.target.value)}
                placeholder="my-secret-verify-token"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
              />
              <button
                type="button"
                onClick={generateVerifyToken}
                className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-md border border-gray-300 transition-colors whitespace-nowrap"
              >
                Generate
              </button>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              A string you invent — you will enter the same value in Meta&apos;s webhook
              configuration under <strong>Callback URL</strong> &gt;{' '}
              <strong>Verify token</strong>. Use the Generate button for a secure random value.
            </p>
          </div>

          {error && (
            <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium rounded-md transition-colors"
          >
            {loading ? 'Saving...' : 'Save and continue'}
          </button>
        </form>

        <p className="mt-4 text-xs text-center text-gray-500">
          Need help?{' '}
          <a
            href="https://developers.facebook.com/docs/whatsapp/business-management-api/get-started"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            Read the Meta setup guide
          </a>
        </p>
      </div>
    </div>
  );
}
