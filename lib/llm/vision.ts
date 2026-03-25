import { getOpenAIClient } from '@/lib/llm/client';
import { downloadMedia } from '@/lib/meta/api';
import { getDecryptedToken } from '@/lib/vault/secrets';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * Analyze an image using GPT-4o Vision.
 *
 * Pipeline:
 * 1. Retrieve the tenant's decrypted access token (with Redis cache)
 * 2. Download the image binary from Meta's temporary URL using the access token
 * 3. Convert the binary to a base64 data URL
 * 4. Call GPT-4o Vision with the image + the user's question
 * 5. Return the textual description/analysis for injection into the RAG pipeline
 *
 * GPT-4o (not gpt-4o-mini) is used here because vision capability is only
 * available on the full model. Text-only messages use gpt-4o-mini (10x cheaper).
 *
 * @param mediaId      - Meta media object ID (from the webhook payload)
 * @param userQuestion - The user's text message accompanying the image
 * @param tenantId     - UUID of the tenant (for token retrieval + logging)
 * @returns Textual description/analysis of the image
 */
export async function analyzeImage(
  mediaId: string,
  userQuestion: string,
  tenantId: string
): Promise<string> {
  // ── 1. Get tenant access token ─────────────────────────────────────────────
  const supabase = createServiceClient();

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('vault_secret_id')
    .eq('id', tenantId)
    .single();

  if (tenantError || !tenant?.vault_secret_id) {
    throw new Error(
      `[vision][analyzeImage] Could not retrieve vault_secret_id for tenant=${tenantId}`
    );
  }

  const accessToken = await getDecryptedToken(tenantId, tenant.vault_secret_id);

  // ── 2. Download image from Meta ────────────────────────────────────────────
  const { buffer, mimeType } = await downloadMedia(mediaId, accessToken);

  // ── 3. Convert to base64 data URL ─────────────────────────────────────────
  // GPT-4o Vision accepts base64-encoded images via data URLs.
  // Supported formats: image/jpeg, image/png, image/gif, image/webp
  const base64 = Buffer.from(buffer).toString('base64');
  const dataUrl = `data:${mimeType};base64,${base64}`;

  // ── 4. Call GPT-4o Vision ──────────────────────────────────────────────────
  const client = getOpenAIClient();

  const response = await client.chat.completions.create({
    model: 'gpt-4o', // Vision requires gpt-4o, NOT gpt-4o-mini
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: dataUrl,
              detail: 'auto', // 'auto' lets GPT choose low/high detail based on image size
            },
          },
          {
            type: 'text',
            text: userQuestion && userQuestion.trim().length > 0
              ? `El usuario envió esta imagen con el siguiente mensaje: "${userQuestion}". Describe detalladamente el contenido de la imagen y responde la consulta del usuario si es posible.`
              : 'Describe detalladamente el contenido de esta imagen.',
          },
        ],
      },
    ],
    max_tokens: 500,
  });

  const description = response.choices[0]?.message?.content ?? '';

  if (!description.trim()) {
    console.warn(`[vision][analyzeImage] Empty vision response for tenant=${tenantId}`);
    return userQuestion ?? '';
  }

  console.info(
    `[vision][analyzeImage] Vision analysis complete tenant=${tenantId} chars=${description.length}`
  );

  return description;
}
