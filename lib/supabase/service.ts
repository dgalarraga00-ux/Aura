import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

/**
 * Creates a Supabase client using the service_role key.
 * BYPASSES Row Level Security — use ONLY in:
 *   - app/api/webhook/route.ts
 *   - app/api/worker/route.ts
 *   - app/api/upload/route.ts (for storage operations)
 *
 * NEVER expose this client to client-side code or pass it to components.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables'
    );
  }

  return createClient<Database>(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
