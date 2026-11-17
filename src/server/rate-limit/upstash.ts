import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import type { RateLimiter, RateLimitOptions, RateLimitResult } from "./index";

/**
 * Global sliding-window limiter backed by Upstash Redis (free tier).
 *
 * Implements the same RateLimiter contract as the in-memory driver — the HTTP
 * side (headers.ts) and its tests never change when this driver is active.
 * One Ratelimit instance per (limit, window) pair, cached: @upstash/ratelimit
 * binds the limiter config at construction.
 */
export class UpstashRateLimiter implements RateLimiter {
  private readonly redis: Redis;
  private readonly limiters = new Map<string, Ratelimit>();

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async limit(key: string, options: RateLimitOptions): Promise<RateLimitResult> {
    const ratelimit = this.ratelimitFor(options);
    const result = await ratelimit.limit(key);
    const resetSeconds = Math.ceil(result.reset / 1000);

    return {
      success: result.success,
      limit: options.limit,
      remaining: result.remaining,
      reset: resetSeconds,
      retryAfterSeconds: result.success
        ? 0
        : Math.max(1, resetSeconds - Math.ceil(Date.now() / 1000)),
    };
  }

  private ratelimitFor(options: RateLimitOptions): Ratelimit {
    const cacheKey = `${options.limit}:${options.windowSeconds}`;
    let ratelimit = this.limiters.get(cacheKey);
    if (!ratelimit) {
      ratelimit = new Ratelimit({
        redis: this.redis,
        limiter: Ratelimit.slidingWindow(options.limit, `${options.windowSeconds} s`),
        // Policy-qualified prefix so the same logical key under different
        // quotas keeps independent counters.
        prefix: `quodera:${cacheKey}`,
        analytics: false,
      });
      this.limiters.set(cacheKey, ratelimit);
    }
    return ratelimit;
  }
}
