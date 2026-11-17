import { Redis } from "@upstash/redis";
import { describe, expect, it } from "vitest";
import { UpstashRateLimiter } from "./upstash";

/**
 * Integration against a REAL Upstash database — runs only when one is
 * configured (locally via .env, or CI secrets when provided). Skipped
 * otherwise: the HTTP contract does not depend on the driver, but this
 * suite is what proves the global counters actually work across what would
 * be separate serverless instances.
 */
const d = describe.skipIf(
  !(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
)("UpstashRateLimiter (real Upstash)", () => {
  it("enforces the window across separate limiter instances (global state)", async () => {
    // Two instances model two serverless instances: shared Redis state is
    // the entire point of this driver.
    const makeInstance = () =>
      new UpstashRateLimiter(
        new Redis({
          url: process.env.UPSTASH_REDIS_REST_URL!,
          token: process.env.UPSTASH_REDIS_REST_TOKEN!,
        }),
      );

    const key = `test-${crypto.randomUUID()}`;
    const policy = { limit: 2, windowSeconds: 5 };

    const first = await makeInstance().limit(key, policy);
    const second = await makeInstance().limit(key, policy);
    const third = await makeInstance().limit(key, policy);

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(third.success).toBe(false);
    expect(third.remaining).toBe(0);
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
    expect(third.retryAfterSeconds).toBeLessThanOrEqual(5);
  });
});

export { d as upstashIntegrationSuite };
