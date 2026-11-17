import { describe, expect, it } from "vitest";
import { memoryLimiter } from "./memory";
import { resolveLimiter } from "./limiter";
import { UpstashRateLimiter } from "./upstash";

/**
 * Driver selection is configuration, not chance — these tests pin the
 * resolution rules (GUARDRAILS #6's foundation). The Upstash driver itself
 * is exercised by upstash.test.ts when a real database is configured.
 */
describe("limiter resolution", () => {
  it("uses Upstash when both REST URL and token are configured", () => {
    const limiter = resolveLimiter({
      upstashUrl: "https://example.upstash.io",
      upstashToken: "token",
      nodeEnv: "production",
    });
    expect(limiter).toBeInstanceOf(UpstashRateLimiter);
  });

  it("falls back to the in-memory driver when Upstash is unconfigured", () => {
    const limiter = resolveLimiter({ nodeEnv: "test" });
    expect(limiter).toBe(memoryLimiter);
  });

  it("never selects Upstash with only one of the two values set", () => {
    expect(resolveLimiter({ upstashUrl: "https://example.upstash.io", nodeEnv: "test" })).toBe(
      memoryLimiter,
    );
    expect(resolveLimiter({ upstashToken: "token", nodeEnv: "test" })).toBe(memoryLimiter);
  });
});
