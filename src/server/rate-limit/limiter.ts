import { Redis } from "@upstash/redis";
import { env } from "@/server/lib/env";
import { logger } from "@/server/lib/logger";
import type { RateLimiter } from "./index";
import { memoryLimiter } from "./memory";
import { UpstashRateLimiter } from "./upstash";

/**
 * Resolve the active limiter from configuration — pure, testable.
 *
 * Upstash when configured (global, correct across serverless instances);
 * memory otherwise — per-instance and therefore only a contract-prover.
 * A production deployment without Upstash gets ONE loud error, never silence.
 */
export function resolveLimiter(config: {
  upstashUrl?: string;
  upstashToken?: string;
  nodeEnv: string;
}): RateLimiter {
  if (config.upstashUrl && config.upstashToken) {
    return new UpstashRateLimiter(
      new Redis({ url: config.upstashUrl, token: config.upstashToken }),
    );
  }

  if (config.nodeEnv === "production") {
    logger.error(
      "UPSTASH_REDIS_REST_URL/TOKEN are not set — global quotas are NOT enforced " +
        "(per-instance memory fallback). See docs/ops/PROVISIONING.md §9.",
    );
  }
  return memoryLimiter;
}

// Survive dev hot-reload; resolved once per process.
const globalForLimiter = globalThis as typeof globalThis & {
  __quoderaLimiter?: RateLimiter;
};

export function getLimiter(): RateLimiter {
  return (globalForLimiter.__quoderaLimiter ??= resolveLimiter({
    upstashUrl: env.UPSTASH_REDIS_REST_URL,
    upstashToken: env.UPSTASH_REDIS_REST_TOKEN,
    nodeEnv: process.env.NODE_ENV,
  }));
}

/** Best-effort client IP (Vercel sets x-forwarded-for). */
export function clientIpFromRequest(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")?.[0]?.trim() ?? "unknown";
}
