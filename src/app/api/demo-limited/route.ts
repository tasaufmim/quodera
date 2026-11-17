import { withApi } from "@/server/lib/api-handler";
import { rateLimitHeaders, tooManyRequests } from "@/server/rate-limit/headers";
import { clientIpFromRequest, getLimiter } from "@/server/rate-limit/limiter";
import { POLICY } from "@/server/rate-limit/policy";

export const dynamic = "force-dynamic";

/**
 * The reference implementation of a rate-limited route: same shape every
 * route uses (GUARDRAILS #6). Since Phase 2.2 the limiter comes from
 * getLimiter() — Upstash in production (global), memory in dev — while the
 * 429 contract stays byte-identical, which is exactly what the e2e suite
 * pins: a driver swap must never change the HTTP surface.
 */
export const GET = withApi("demo-limited", async (request: Request) => {
  const ip = clientIpFromRequest(request);

  const result = await getLimiter().limit(`demo-limited:${ip}`, POLICY.demo);

  if (!result.success) {
    return tooManyRequests(result);
  }

  const response = Response.json({
    message:
      "Inside the rate limit. This route exists to prove the limiter contract — see src/server/rate-limit.",
    rateLimit: { ...POLICY.demo, remaining: result.remaining },
  });

  for (const [header, value] of rateLimitHeaders(result)) {
    response.headers.set(header, value);
  }
  return response;
});
