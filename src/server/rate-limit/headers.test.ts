import { describe, expect, it } from "vitest";
import { rateLimitHeaders, tooManyRequests } from "./headers";

const DENIED = {
  success: false,
  limit: 5,
  remaining: 0,
  reset: 1767225600,
  retryAfterSeconds: 12,
} as const;

/**
 * The HTTP contract every rate-limited route shares. When the Upstash driver
 * lands in Phase 2 these tests must keep passing unchanged — that is the point
 * of having the contract in one place.
 */
describe("rate-limit HTTP contract", () => {
  it("tooManyRequests returns 429 with the full header set", async () => {
    const response = tooManyRequests(DENIED);

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("12");
    expect(response.headers.get("x-ratelimit-limit")).toBe("5");
    expect(response.headers.get("x-ratelimit-remaining")).toBe("0");
    expect(response.headers.get("x-ratelimit-reset")).toBe("1767225600");

    const body = (await response.json()) as { error: string; retryAfterSeconds: number };
    expect(body.error).toBe("rate_limited");
    expect(body.retryAfterSeconds).toBe(12);
  });

  it("rateLimitHeaders carries limit/remaining/reset for allowed responses", () => {
    const headers = rateLimitHeaders({
      success: true,
      limit: 5,
      remaining: 4,
      reset: 1767225600,
      retryAfterSeconds: 0,
    });

    expect(headers.get("x-ratelimit-limit")).toBe("5");
    expect(headers.get("x-ratelimit-remaining")).toBe("4");
    expect(headers.get("x-ratelimit-reset")).toBe("1767225600");
  });
});
