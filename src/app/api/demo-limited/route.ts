import { withApi } from "@/server/lib/api-handler";
import { rateLimitHeaders, tooManyRequests } from "@/server/rate-limit/headers";
import { memoryLimiter } from "@/server/rate-limit/memory";

export const dynamic = "force-dynamic";

/** Demo quota — exists to prove the limiter + 429 contract end-to-end. */
const LIMIT = 3;
const WINDOW_SECONDS = 30;

/**
 * The reference implementation of a rate-limited route: same shape every
 * future route will use (GUARDRAILS #6), so the Upstash swap (Phase 2) is a
 * driver change, not a rewrite.
 */
export const GET = withApi("demo-limited", async (request: Request) => {
  const ip = request.headers.get("x-forwarded-for")?.split(",")?.[0]?.trim() ?? "unknown";

  const result = await memoryLimiter.limit(`demo-limited:${ip}`, {
    limit: LIMIT,
    windowSeconds: WINDOW_SECONDS,
  });

  if (!result.success) {
    return tooManyRequests(result);
  }

  const response = Response.json({
    message:
      "Inside the rate limit. This route exists to prove the limiter contract — see src/server/rate-limit.",
    rateLimit: { limit: LIMIT, windowSeconds: WINDOW_SECONDS, remaining: result.remaining },
  });

  for (const [header, value] of rateLimitHeaders(result)) {
    response.headers.set(header, value);
  }
  return response;
});
