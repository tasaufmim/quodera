/**
 * Rate-limiter contract (ADR 0007 groundwork).
 *
 * Two implementations are planned:
 *  - MemoryRateLimiter (rate-limit/memory.ts) — Phase 1: per-instance,
 *    used only to prove the HTTP 429 contract. On serverless, every instance
 *    has its own memory, so counts are NOT global. Fine for a demo route;
 *    wrong for real quotas.
 *  - Upstash Redis driver — Phase 2: global, per-user quotas once auth exists.
 *
 * Both must produce identical RateLimitResult values, so the HTTP contract
 * (rate-limit/headers.ts) and its tests never change when the driver swaps.
 */
export interface RateLimitOptions {
  /** Max requests allowed inside the window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  /** Epoch seconds at which the window resets. */
  reset: number;
  /** Seconds the client must wait before retrying (0 when allowed). */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  limit(key: string, options: RateLimitOptions): Promise<RateLimitResult>;
}
