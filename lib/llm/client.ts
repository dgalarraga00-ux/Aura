import OpenAI from 'openai';

/**
 * OpenAI singleton client.
 * Reads OPENAI_API_KEY from environment variables.
 */
let openaiInstance: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (!openaiInstance) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('Missing OPENAI_API_KEY environment variable');
    }
    openaiInstance = new OpenAI({ apiKey });
  }
  return openaiInstance;
}

/**
 * Generate a text embedding using text-embedding-3-small.
 *
 * Returns a 1536-dimensional float array suitable for pgvector storage
 * and cosine similarity search.
 *
 * @param text - The text to embed. Will be truncated by the model if too long.
 * @returns Promise<number[]> — array of 1536 floats
 */
export async function embedText(text: string): Promise<number[]> {
  const client = getOpenAIClient();

  const response = await client.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
    encoding_format: 'float',
  });

  return response.data[0].embedding;
}
