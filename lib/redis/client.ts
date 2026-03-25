import { Redis } from '@upstash/redis';

/**
 * Upstash Redis singleton client.
 * Reads REST URL and token from environment variables.
 */
let redisInstance: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisInstance) {
    redisInstance = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }
  return redisInstance;
}

// ─── Redis Key Schema ──────────────────────────────────────────────────────────
// Centralized key builders to ensure consistent naming across the codebase.

/**
 * Circuit breaker: is tenant active?
 * TTL: 60 seconds
 */
export const tenantActiveKey = (tenantId: string) => `tenant:active:${tenantId}`;

/**
 * Escalation state: is this conversation currently escalated to a human?
 * TTL: 86400 seconds (24 hours)
 */
export const convEscalatedKey = (conversationId: string) => `conv:escalated:${conversationId}`;

/**
 * Vault token cache: decrypted Meta access_token for a tenant.
 * TTL: 300 seconds (5 minutes)
 */
export const vaultTokenKey = (tenantId: string) => `vault:token:${tenantId}`;

/**
 * Rate limiting: inbound messages per tenant.
 * TTL: 60 seconds — max: 60 messages/min
 */
export const rateLimitTenantKey = (tenantId: string) => `rl:tenant:${tenantId}`;

/**
 * Rate limiting: inbound messages per contact phone number within a tenant.
 * TTL: 60 seconds — max: 10 messages/min
 */
export const rateLimitPhoneKey = (tenantId: string, phone: string) =>
  `rl:phone:${tenantId}:${phone}`;

/**
 * RAG consecutive low-score counter per conversation.
 * Used to trigger human handoff after 3 consecutive queries below threshold.
 * TTL: 3600 seconds (1 hour — resets after conversation goes quiet)
 */
export const ragScoreCounterKey = (conversationId: string) => `rl:ragscore:${conversationId}`;
