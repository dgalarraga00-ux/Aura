/**
 * Meta Graph API client.
 *
 * Provides typed wrappers for the three operations needed by this pipeline:
 * - sendTextMessage: send a plain-text WhatsApp message to a contact
 * - downloadMedia:   fetch the binary content of a media attachment
 * - markMessageRead: send a read receipt for a message
 *
 * All methods accept the tenant's decrypted access_token directly.
 * Callers are responsible for fetching/caching tokens via getDecryptedToken().
 */

const META_API_BASE = 'https://graph.facebook.com/v19.0';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SendMessageResponse {
  messaging_product: 'whatsapp';
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string }>;
}

export interface MediaUrlResponse {
  url: string;
  mime_type: string;
  sha256: string;
  file_size: number;
  id: string;
  messaging_product: 'whatsapp';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build the Authorization header for Meta Graph API calls.
 */
function authHeader(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Parse a Meta API error response and throw with a descriptive message.
 */
async function handleMetaError(res: Response, context: string): Promise<never> {
  let detail = `HTTP ${res.status}`;
  try {
    const body = await res.json();
    detail = JSON.stringify(body?.error ?? body);
  } catch {
    // ignore parse failure — use status code only
  }
  throw new Error(`Meta API error (${context}): ${detail}`);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Send a plain-text WhatsApp message to a contact.
 *
 * @param phoneNumberId - The tenant's WhatsApp phone number ID (from Meta)
 * @param to            - Recipient phone in E.164 format (e.g. "+5491112345678")
 * @param text          - Message body text
 * @param accessToken   - Decrypted Meta access token for the tenant
 */
export async function sendTextMessage(
  phoneNumberId: string,
  to: string,
  text: string,
  accessToken: string
): Promise<SendMessageResponse> {
  const url = `${META_API_BASE}/${phoneNumberId}/messages`;

  const res = await fetch(url, {
    method: 'POST',
    headers: authHeader(accessToken),
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: text },
    }),
  });

  if (!res.ok) {
    await handleMetaError(res, `sendTextMessage to=${to}`);
  }

  return res.json() as Promise<SendMessageResponse>;
}

/**
 * Retrieve the temporary download URL for a media object, then download it.
 *
 * Meta media IDs are resolved to a short-lived URL (~5min) via a separate call
 * before the binary can be fetched.
 *
 * Returns an object with the binary buffer and its MIME type.
 *
 * @param mediaId     - Meta media object ID (from the webhook message payload)
 * @param accessToken - Decrypted Meta access token for the tenant
 */
export async function downloadMedia(
  mediaId: string,
  accessToken: string
): Promise<{ buffer: ArrayBuffer; mimeType: string }> {
  // Step 1: resolve media ID → temporary URL
  const metaRes = await fetch(`${META_API_BASE}/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!metaRes.ok) {
    await handleMetaError(metaRes, `downloadMedia resolve mediaId=${mediaId}`);
  }

  const meta = (await metaRes.json()) as MediaUrlResponse;

  // Step 2: download the binary from the temporary URL
  const downloadRes = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!downloadRes.ok) {
    await handleMetaError(downloadRes, `downloadMedia fetch url mediaId=${mediaId}`);
  }

  const buffer = await downloadRes.arrayBuffer();
  return { buffer, mimeType: meta.mime_type };
}

/**
 * Mark a received message as read, sending a read receipt back to Meta.
 *
 * This causes a double-tick (✓✓) to appear in the sender's WhatsApp client.
 *
 * @param phoneNumberId     - The tenant's WhatsApp phone number ID
 * @param messageExternalId - The wa_msg_id of the message to mark as read
 * @param accessToken       - Decrypted Meta access token for the tenant
 */
export async function markMessageRead(
  phoneNumberId: string,
  messageExternalId: string,
  accessToken: string
): Promise<void> {
  const url = `${META_API_BASE}/${phoneNumberId}/messages`;

  const res = await fetch(url, {
    method: 'POST',
    headers: authHeader(accessToken),
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageExternalId,
    }),
  });

  if (!res.ok) {
    await handleMetaError(res, `markMessageRead msgId=${messageExternalId}`);
  }
}
