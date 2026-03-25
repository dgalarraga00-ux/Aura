import { getOpenAIClient } from '@/lib/llm/client';
import { downloadMedia } from '@/lib/meta/api';

// Whisper API hard limit is 25MB
const WHISPER_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Transcribe an audio message using OpenAI Whisper.
 *
 * Pipeline:
 * 1. Download the audio binary from Meta Media API via downloadMedia()
 * 2. Validate that the file is under the 25MB Whisper hard limit
 * 3. Wrap the ArrayBuffer in a File object (audio/ogg) as expected by the OpenAI SDK
 * 4. Call whisper-1 with language='es' for best LATAM Spanish accuracy
 * 5. Return the transcript text
 *
 * Error handling:
 * - Files > 25MB throw with code `audio_too_large` — callers should mark the
 *   message as errored and return 200 (do NOT let QStash retry)
 * - All other failures throw with a descriptive message
 *
 * @param mediaId     - Meta media object ID (from the webhook payload)
 * @param accessToken - Decrypted Meta access token for the tenant
 * @returns Transcribed text string
 */
export async function transcribeAudio(
  mediaId: string,
  accessToken: string
): Promise<string> {
  // ── 1. Download audio from Meta ────────────────────────────────────────────
  let buffer: ArrayBuffer;
  try {
    const result = await downloadMedia(mediaId, accessToken);
    buffer = result.buffer;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[whisper][transcribeAudio] Failed to download audio mediaId=${mediaId}: ${msg}`);
  }

  // ── 2. Validate file size (25MB hard limit for Whisper API) ────────────────
  if (buffer.byteLength > WHISPER_MAX_BYTES) {
    const sizeMb = (buffer.byteLength / 1024 / 1024).toFixed(1);
    const error = new Error(
      `[whisper][transcribeAudio] Audio file too large: ${sizeMb}MB exceeds 25MB limit — mediaId=${mediaId}`
    ) as Error & { code: string };
    error.code = 'audio_too_large';
    throw error;
  }

  // ── 3. Build File object for the OpenAI SDK ────────────────────────────────
  // The OpenAI SDK expects a File (or Blob) — not a raw Buffer or ArrayBuffer.
  // We force the filename to audio.ogg and mime type to audio/ogg since that
  // is the format Meta uses for voice messages.
  const file = new File([buffer], 'audio.ogg', { type: 'audio/ogg' });

  // ── 4. Call Whisper ────────────────────────────────────────────────────────
  const client = getOpenAIClient();

  let transcription: string;
  try {
    const response = await client.audio.transcriptions.create({
      model: 'whisper-1',
      file,
      language: 'es', // Force Spanish for best accuracy in LATAM context
    });
    transcription = response.text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[whisper][transcribeAudio] Whisper API call failed mediaId=${mediaId}: ${msg}`);
  }

  if (!transcription || !transcription.trim()) {
    console.warn(`[whisper][transcribeAudio] Empty transcription for mediaId=${mediaId}`);
    return '';
  }

  console.info(
    `[whisper][transcribeAudio] Transcription complete mediaId=${mediaId} chars=${transcription.length}`
  );

  return transcription;
}
