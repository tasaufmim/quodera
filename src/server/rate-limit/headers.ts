import type { RateLimitResult } from "./index";

/**
 * The HTTP side of the limiter contract — identical no matter which driver
 * produced the result. Covered by tests (headers.test.ts) and e2e
 * (demo-limited route), so a Phase 2 Upstash swap cannot silently change it.
 */
export function rateLimitHeaders(result: RateLimitResult): Headers {
  const headers = new Headers();
  headers.set("x-ratelimit-limit", String(result.limit));
  headers.set("x-ratelimit-remaining", String(result.remaining));
  headers.set("x-ratelimit-reset", String(result.reset));
  return headers;
}

export function tooManyRequests(result: RateLimitResult): Response {
  const response = Response.json(
    { error: "rate_limited", retryAfterSeconds: result.retryAfterSeconds },
    { status: 429 },
  );
  for (const [header, value] of rateLimitHeaders(result)) {
    response.headers.set(header, value);
  }
  response.headers.set("retry-after", String(result.retryAfterSeconds));
  return response;
}
