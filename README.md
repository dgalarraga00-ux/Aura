# IAWHATSAPP — WhatsApp SaaS Multi-Tenant

A production-ready WhatsApp automation platform built with Next.js 16, Supabase, and OpenAI. Supports multiple tenants, RAG-powered AI responses, human handoff, and async job processing via Upstash QStash.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, API Routes) |
| Database | Supabase (PostgreSQL + pgvector) |
| Auth | Supabase Auth with RLS |
| Queue | Upstash QStash (async workers) |
| Cache / Rate-limit | Upstash Redis |
| AI — LLM | OpenAI GPT-4o-mini |
| AI — Embeddings | OpenAI text-embedding-3-small |
| AI — Transcription | OpenAI Whisper |
| Messaging | Meta WhatsApp Cloud API |
| Language | TypeScript (strict) |
| Deploy | Vercel |

---

## Prerequisites

- Node.js >= 20
- npm >= 10
- [Supabase CLI](https://supabase.com/docs/guides/cli) (`brew install supabase/tap/supabase`)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (for local Supabase)
- A Meta developer account with a WhatsApp Business App
- Upstash account (Redis + QStash)
- OpenAI API key

---

## Local Setup

```bash
# 1. Clone the repository
git clone <repo-url>
cd IAWHATSAPP

# 2. Install dependencies
npm install

# 3. Copy environment variables
cp .env.local.example .env.local
# Edit .env.local and fill in all required values

# 4. Start Supabase locally (requires Docker)
npx supabase start

# 5. Apply all database migrations
npx supabase db push

# 6. Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

---

## Environment Variables

All variables are validated at startup via `lib/env.ts`. The app throws a descriptive error and refuses to start if any required variable is missing or invalid.

### Supabase

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL from Supabase dashboard (Settings > API) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key (safe for browser) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key — **server-side only, never expose to client** |

### Upstash Redis

| Variable | Description |
|----------|-------------|
| `UPSTASH_REDIS_REST_URL` | REST URL from Upstash console |
| `UPSTASH_REDIS_REST_TOKEN` | REST token from Upstash console |

### Upstash QStash

| Variable | Description |
|----------|-------------|
| `QSTASH_TOKEN` | Publishing token |
| `QSTASH_CURRENT_SIGNING_KEY` | Current signing key for webhook verification |
| `QSTASH_NEXT_SIGNING_KEY` | Next signing key (used during key rotation) |
| `QSTASH_WORKER_URL` | Public URL where QStash POSTs jobs (e.g. `https://your-domain/api/worker`) |

### OpenAI

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | API key from platform.openai.com/api-keys (starts with `sk-`) |

### Meta / WhatsApp

| Variable | Description |
|----------|-------------|
| `META_APP_SECRET` | App Secret from Meta developer console (used for HMAC webhook signature verification) |
| `META_WEBHOOK_VERIFY_TOKEN` | Random secret set in Meta's webhook configuration UI |

### App

| Variable | Description |
|----------|-------------|
| `APP_URL` | Public base URL of the deployed app (e.g. `https://your-domain.vercel.app`) |

---

## Project Structure

```
IAWHATSAPP/
├── app/
│   ├── api/
│   │   ├── auth/          # Supabase auth callbacks
│   │   ├── config/        # Tenant bot config CRUD
│   │   ├── handoffs/      # Human handoff resolution
│   │   ├── health/        # Health check endpoint (GET /api/health)
│   │   ├── ingest/        # Knowledge source ingestion trigger
│   │   ├── jobs/          # Background job status
│   │   ├── knowledge/     # Knowledge source management
│   │   ├── upload/        # File upload to Supabase Storage
│   │   ├── webhook/       # Meta WhatsApp Cloud API webhook (inbound messages)
│   │   └── worker/        # QStash worker (processes async message jobs)
│   └── ...                # Next.js pages and layouts
├── lib/
│   ├── adapters/          # Webhook payload normalization (Meta format → internal)
│   ├── env.ts             # Zod-validated environment variables (fail-fast)
│   ├── handoff/           # Human escalation trigger logic
│   ├── llm/               # OpenAI LLM client (chat completions + tool calls)
│   ├── logger.ts          # Structured logger (JSON in prod, colored in dev)
│   ├── media/             # WhatsApp media download and routing
│   ├── meta/              # Meta WhatsApp API client (send messages, download media)
│   ├── qstash/            # QStash client wrapper for publishing jobs
│   ├── rag/               # RAG pipeline: ingest, chunk, embed, search
│   ├── redis/             # Redis idempotency and rate-limit helpers
│   ├── supabase/          # Supabase client factories (browser, server, service)
│   ├── validators/        # Zod request validators for API routes
│   └── vault/             # Supabase Vault integration for WhatsApp tokens
├── supabase/
│   ├── config.toml        # Local Supabase project config
│   └── migrations/        # SQL migrations (001–008)
├── types/
│   ├── database.ts        # Supabase generated types (Tables, Functions, Enums)
│   ├── jobs.ts            # QStash job payload types
│   └── messages.ts        # Normalized internal message types
└── middleware.ts           # Next.js middleware (Supabase session refresh)
```

---

## Migrations

| File | Purpose |
|------|---------|
| `001_extensions.sql` | Enable `uuid-ossp`, `pgvector`, `pg_trgm` |
| `002_enums.sql` | Define all PostgreSQL enums |
| `003_tables.sql` | All main tables |
| `004_indexes.sql` | Indexes including HNSW vector index |
| `005_rls.sql` | Row Level Security policies |
| `006_triggers.sql` | `updated_at` auto-update triggers |
| `007_rpc_match_chunks.sql` | `match_knowledge_chunks()` pgvector similarity search RPC |
| `008_handoffs.sql` | `handoffs` table for human escalation audit trail |

---

## Deploy to Vercel

```bash
# 1. Install Vercel CLI
npm i -g vercel

# 2. Link to Vercel project
vercel link

# 3. Set all environment variables in Vercel dashboard
#    Project Settings > Environment Variables
#    (All variables from .env.local.example, using production values)

# 4. Deploy
vercel --prod
```

Key notes for Vercel deployment:
- Set `APP_URL` to your Vercel deployment URL
- Set `QSTASH_WORKER_URL` to `https://<your-vercel-domain>/api/worker`
- Configure the Meta webhook URL to `https://<your-vercel-domain>/api/webhook`
- The `SUPABASE_SERVICE_ROLE_KEY` must NOT have the `NEXT_PUBLIC_` prefix

---

## Message Flow

```
Meta Cloud API
     │ POST /api/webhook
     ▼
Webhook Handler (HMAC verify → dedup → QStash enqueue)
     │ async
     ▼
QStash Worker POST /api/worker
     │
     ├── Normalize payload (lib/adapters)
     ├── Resolve tenant (by phone_number_id)
     ├── Get/create conversation + contact
     ├── RAG search (pgvector similarity)
     ├── LLM call (GPT-4o-mini + tool calls)
     ├── Check handoff triggers (keyword / rag_score / llm_tool)
     └── Send reply via Meta API
```

---

## Health Check

```
GET /api/health
```

Returns `200 { status: "ok", timestamp, version }` when healthy, or `503 { status: "degraded", error }` if Supabase is unreachable.
