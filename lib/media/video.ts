/**
 * Video message handler for the WhatsApp SaaS pipeline.
 *
 * Meta's Cloud API does not allow direct video analysis via Vision (GPT-4o).
 * For v1 this is a functional pass-through: we return a standard response
 * telling the user we cannot process videos yet, which the caller sends
 * directly without going through RAG or the LLM.
 *
 * This function accepts the same signature as transcribeAudio() for symmetry,
 * even though mediaId and tenantToken are unused in v1.
 *
 * @param _mediaId      - Meta media object ID (unused in v1)
 * @param _tenantToken  - Decrypted Meta access token (unused in v1)
 * @param _userQuestion - Text accompanying the video (unused in v1)
 * @returns Standard "video not supported" message in Spanish
 */
export async function handleVideo(
  _mediaId: string,
  _tenantToken: string,
  _userQuestion: string
): Promise<string> {
  return 'El cliente envió un video. Responde que por el momento no podés analizar videos, pero podés ayudarlo con texto o imágenes.';
}
