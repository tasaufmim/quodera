import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRateLimiter } from "./memory";

const OPTS = { limit: 3, windowSeconds: 30 } as const;

/**
 * The limiter math is what the whole 429 contract rests on — fake timers let
 * us time-travel a 30-second window in microseconds instead of sleeping.
 */
describe("MemoryRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows exactly `limit` requests, then denies with retryAfter and reset", async () => {
    const limiter = new MemoryRateLimiter(() => Date.now());

    const first = await limiter.limit("key", OPTS);
    expect(first.success).toBe(true);
    expect(first.remaining).toBe(2);

    await limiter.limit("key", OPTS);

    const third = await limiter.limit("key", OPTS);
    expect(third.success).toBe(true);
    expect(third.remaining).toBe(0);

    const fourth = await limiter.limit("key", OPTS);
    expect(fourth.success).toBe(false);
    expect(fourth.remaining).toBe(0);
    expect(fourth.retryAfterSeconds).toBe(30);
    expect(fourth.reset).toBe(Math.floor(Date.now() / 1000) + 30);
  });

  it("admits again once the window slides past the oldest hit", async () => {
    const limiter = new MemoryRateLimiter(() => Date.now());

    await limiter.limit("key", OPTS);
    await limiter.limit("key", OPTS);
    await limiter.limit("key", OPTS);
    expect((await limiter.limit("key", OPTS)).success).toBe(false);

    vi.setSystemTime(new Date("2026-01-01T00:00:31Z"));
    const afterSlide = await limiter.limit("key", OPTS);

    expect(afterSlide.success).toBe(true);
    expect(afterSlide.remaining).toBe(2);
  });

  it("tracks keys independently", async () => {
    const limiter = new MemoryRateLimiter(() => Date.now());

    await limiter.limit("key-a", OPTS);
    await limiter.limit("key-a", OPTS);

    const keyB = await limiter.limit("key-b", OPTS);
    expect(keyB.success).toBe(true);
    expect(keyB.remaining).toBe(2);
  });

  it("denies immediately when limit is 0 (kill-switch shape)", async () => {
    const limiter = new MemoryRateLimiter(() => Date.now());
    const result = await limiter.limit("key", { limit: 0, windowSeconds: 30 });
    expect(result.success).toBe(false);
    expect(result.retryAfterSeconds).toBe(30);
  });
});
