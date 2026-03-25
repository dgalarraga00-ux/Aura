import { z } from 'zod';

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'text/csv',
  'text/plain',
] as const;

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

// Validation schema for upload request body (URL uploads)
export const UploadUrlSchema = z.object({
  url: z.string().url('Must be a valid URL'),
  name: z.string().min(1).max(255),
});

export type UploadUrlPayload = z.infer<typeof UploadUrlSchema>;

// Bot config update schema
export const BotConfigSchema = z.object({
  system_prompt: z.string().max(4000),
  handoff_keywords: z.array(z.string().min(1)).max(50),
  rag_score_threshold: z.number().min(0).max(1),
  language: z.string().length(2), // ISO 639-1
  max_tokens: z.number().int().min(100).max(4000),
});

export type BotConfig = z.infer<typeof BotConfigSchema>;
