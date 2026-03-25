/**
 * Environment variable validation using Zod.
 *
 * This module validates all required env vars at import time.
 * If any required variable is missing, the app will throw a descriptive error
 * before handling any requests — fail fast, fail clearly.
 *
 * Import this in lib/supabase/service.ts (server entry point) to ensure
 * validation runs on every cold start.
 *
 * SECURITY: never log the values of secret env vars (only names).
 */

import { z } from 'zod';

const envSchema = z.object({
  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: z.string().url('Must be a valid URL'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, 'Required'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'Required'),

  // Upstash Redis
  UPSTASH_REDIS_REST_URL: z.string().url('Must be a valid URL'),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1, 'Required'),

  // QStash
  QSTASH_TOKEN: z.string().min(1, 'Required'),
  QSTASH_CURRENT_SIGNING_KEY: z.string().min(1, 'Required'),
  QSTASH_NEXT_SIGNING_KEY: z.string().min(1, 'Required'),

  // OpenAI
  OPENAI_API_KEY: z.string().min(1, 'Required'),

  // Meta / WhatsApp (opcional hasta configurar Meta Business)
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),

  // App
  APP_URL: z.string().url('Must be a valid URL'),
});

type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const missing = result.error.errors
      .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
      .join('\n');

    throw new Error(
      `[env] Missing or invalid environment variables:\n${missing}\n\nCheck your .env.local file.`
    );
  }

  return result.data;
}

// Validate immediately on import — throws before the app handles any request
export const env = validateEnv();
