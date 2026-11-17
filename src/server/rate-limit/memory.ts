import type { RateLimiter, RateLimitOptions, RateLimitResult } from "./index";

const MAX_TRACKED_KEYS = 10_000;

/**
 * Sliding-window-log limiter kept in process memory.
 *
 * Accurate per instance, but serverless platforms run many instances, so the
 * counts are per-instance, not global — see rate-limit/index.ts. Phase 2
 * swaps real quotas to Upstash Redis behind the same interface.
 */
export class MemoryRateLimiter implements RateLimiter {
  private hits = new Map<string, number[]>();

  /** now() is injectable so tests can time-travel without sleeping. */
  constructor(private readonly now: () => number = Date.now) {}

  async limit(key: string, options: RateLimitOptions): Promise<RateLimitResult> {
    const nowMs = this.now();
    const windowMs = options.windowSeconds * 1000;
    const timestamps = (this.hits.get(key) ?? []).filter((t) => t > nowMs - windowMs);

    if (timestamps.length >= options.limit) {
      // timestamps can be empty when limit is 0 (kill-switch shape): the
      // window then resets a full window from now.
      const resetAt = (timestamps[0] ?? nowMs) + windowMs;
      this.hits.set(key, timestamps);
      return {
        success: false,
        limit: options.limit,
        remaining: 0,
        reset: Math.ceil(resetAt / 1000),
        retryAfterSeconds: Math.max(1, Math.ceil((resetAt - nowMs) / 1000)),
      };
    }

    timestamps.push(nowMs);
    this.hits.set(key, timestamps);
    this.evictStaleKeys(nowMs);

    return {
      success: true,
      limit: options.limit,
      remaining: options.limit - timestamps.length,
      reset: Math.ceil(((timestamps[0] ?? nowMs) + windowMs) / 1000),
      retryAfterSeconds: 0,
    };
  }

  /**
   * Best-effort eviction so the map cannot grow without bound: drop keys whose
   * newest hit is over an hour old whenever we cross MAX_TRACKED_KEYS.
   */
  private evictStaleKeys(nowMs: number): void {
    if (this.hits.size <= MAX_TRACKED_KEYS) return;
    const staleBefore = nowMs - 60 * 60 * 1000;
    for (const [key, timestamps] of this.hits) {
      const newest = timestamps[timestamps.length - 1] ?? 0;
      if (newest < staleBefore) this.hits.delete(key);
      if (this.hits.size <= MAX_TRACKED_KEYS) break;
    }
  }
}

// Survive Next.js dev hot-reload: module reloads would otherwise reset counters.
const globalForLimiter = globalThis as typeof globalThis & {
  __quoderaMemoryLimiter?: MemoryRateLimiter;
};

export const memoryLimiter: MemoryRateLimiter = (globalForLimiter.__quoderaMemoryLimiter ??=
  new MemoryRateLimiter());
