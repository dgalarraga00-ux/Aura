# Security Checklist

This document summarizes the security controls in place for this WhatsApp SaaS platform.

---

## Secrets Management

- [ ] **WhatsApp access tokens stored in Supabase Vault**, not in plain-text columns.
  - Tokens are stored via `vault.create_secret()` and retrieved server-side only.
  - The `tenants.vault_secret_id` column stores only the reference ID, never the token itself.
- [ ] **No secrets in environment variables with `NEXT_PUBLIC_` prefix.**
  - `NEXT_PUBLIC_*` variables are bundled into the browser build. Secrets must NOT use this prefix.
  - Safe: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - Never prefix these with `NEXT_PUBLIC_`: `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `META_APP_SECRET`, `QSTASH_TOKEN`, `UPSTASH_REDIS_REST_TOKEN`
- [ ] **`SUPABASE_SERVICE_ROLE_KEY` is server-side only.** Only imported in `lib/supabase/service.ts`. Never used in client components or pages.

---

## Webhook Security

- [ ] **HMAC-SHA256 signature verification on all Meta webhook POST requests.**
  - Implemented in `app/api/webhook/route.ts`.
  - Uses `crypto.timingSafeEqual()` to prevent timing attacks.
  - Requests with missing or invalid `x-hub-signature-256` headers are rejected with `403`.
- [ ] **Idempotency guard via Redis.**
  - Each incoming `message_id` is checked and deduplicated in Redis before processing.
  - Prevents double-processing if Meta retries delivery.

---

## Row Level Security (RLS)

- [ ] **All tables have RLS enabled** (enforced in `005_rls.sql`).
  - `auth_tenant_id()` helper function filters all queries to the authenticated tenant.
  - This is a backstop — application code also filters by `tenant_id` explicitly.
- [ ] **The `tenant_id` filter is MANDATORY in all pgvector queries.**
  - `match_knowledge_chunks()` requires `match_tenant_id` as a parameter.
  - Without it, a tenant could retrieve knowledge chunks from another tenant.
- [ ] **Separate Supabase client instances for browser and server.**
  - `lib/supabase/browser.ts` — uses anon key, respects RLS.
  - `lib/supabase/server.ts` — uses anon key + session cookie, respects RLS.
  - `lib/supabase/service.ts` — uses service role key, **bypasses RLS**. Use only in trusted server contexts.

---

## Authentication

- [ ] **Supabase Auth with server-side session management via `@supabase/ssr`.**
- [ ] **`middleware.ts` refreshes expired sessions** before routing requests.
- [ ] **Role-based access control** via `users.role` column: `saas_admin`, `tenant_admin`, `tenant_operator`.

---

## Environment Variables

- [ ] **All environment variables validated at startup** via `lib/env.ts` (Zod schema).
  - App throws a descriptive error and refuses to start if any required variable is missing.
  - Prevents silent misconfigurations from reaching production.
- [ ] **`.env.local` is in `.gitignore`** — never committed to source control.
- [ ] Only `.env.local.example` (with placeholder values) is committed.

---

## Logging

- [ ] **Structured logger (`lib/logger.ts`) never logs secret values.**
  - Log context is restricted to: `tenant_id`, `message_id`, `conversation_id`, `phase`.
  - Tokens, API keys, and access credentials are never passed to log context.

---

## Queue Security

- [ ] **QStash webhook signature verified** before processing worker jobs.
  - Uses `@upstash/qstash` `Receiver` with `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY`.
  - Supports key rotation without downtime.

---

## Known Constraints and Risks

| Risk | Mitigation |
|------|-----------|
| Service role key exposed in a server component | Only imported in `lib/supabase/service.ts` — review all imports |
| Vault unavailable → fallback to env var token | Ensure Vault is configured before go-live |
| RLS misconfiguration | All policies verified in migration `005_rls.sql`; `auth_tenant_id()` is the enforcement mechanism |
| QStash replay attacks | Each job is idempotent by design — Redis deduplication at webhook ingress |
