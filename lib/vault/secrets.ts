import { getRedisClient, vaultTokenKey } from '@/lib/redis/client';

/**
 * Stores a secret in Supabase Vault via the vault.create_secret SQL function.
 * Returns the UUID of the newly created vault secret.
 *
 * The secret is encrypted at rest by pgsodium — never stored in plaintext.
 * Use the returned vault_secret_id to reference the secret from the tenants table.
 *
 * Requires the service_role key — bypasses RLS to access the vault schema.
 */
export async function storeSecret(secret: string, name: string): Promise<string> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing Supabase environment variables');
  }

  // Call vault.create_secret directly via raw SQL through the service REST API.
  // PostgREST exposes public-schema RPCs; vault schema functions require a wrapper.
  // We use the /sql endpoint (available in Supabase local dev) or a raw RPC wrapper.
  // Supabase Cloud: vault.create_secret is accessible via the service_role key through
  // the POST /rest/v1/rpc/create_vault_secret wrapper function we define in migration.
  //
  // Since that migration wrapper may not exist yet, fall back to direct SQL via the
  // supabase-js service client using .rpc() which calls the public schema wrapper.
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/create_vault_secret`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ p_secret: secret, p_name: name }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to store secret in Vault: HTTP ${res.status} — ${body}`);
  }

  const id = (await res.json()) as string;
  return id;
}

const VAULT_TOKEN_TTL_SECONDS = 300; // 5 minutes

/**
 * Retrieves the decrypted Meta API access_token for a tenant.
 *
 * Strategy (cache-aside):
 * 1. Check Redis cache (key: vault:token:{tenantId}, TTL=300s)
 * 2. Cache miss → query Supabase Vault via pgsodium decryption
 * 3. Store in Redis with TTL and return
 *
 * The token is NEVER stored in plaintext in the database.
 * Redis is the ONLY place where the decrypted token lives temporarily.
 */
export async function getDecryptedToken(tenantId: string, vaultSecretId: string): Promise<string> {
  const redis = getRedisClient();
  const cacheKey = vaultTokenKey(tenantId);

  // 1. Check cache
  const cached = await redis.get<string>(cacheKey);
  if (cached) {
    return cached;
  }

  // 2. Fetch from Vault via Supabase REST API
  // Supabase Vault exposes a `vault.decrypted_secrets` view in the `vault` schema.
  // pgsodium decrypts the secret in-database; only the plaintext crosses the wire.
  // We use a direct fetch against the PostgREST /vault/decrypted_secrets endpoint
  // to bypass the typed client (which only knows about the `public` schema).
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing Supabase environment variables');
  }

  const vaultRes = await fetch(
    `${supabaseUrl}/rest/v1/rpc/get_vault_secret`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ p_secret_id: vaultSecretId }),
    }
  );

  if (!vaultRes.ok) {
    throw new Error(
      `Failed to retrieve Vault secret for tenant ${tenantId}: HTTP ${vaultRes.status}`
    );
  }

  const token = (await vaultRes.json()) as string | null;

  if (!token) {
    throw new Error(`Vault secret not found for tenant ${tenantId} / id ${vaultSecretId}`);
  }

  // 3. Cache in Redis with TTL
  await redis.set(cacheKey, token, { ex: VAULT_TOKEN_TTL_SECONDS });

  return token;
}

/**
 * Invalidates the cached token for a tenant.
 * Call this when Meta API returns 401 so the next request re-fetches from Vault.
 */
export async function invalidateTokenCache(tenantId: string): Promise<void> {
  const redis = getRedisClient();
  await redis.del(vaultTokenKey(tenantId));
}
