import type { ApiHandler } from "@/server/lib/api-handler";
import type { RateLimitOptions } from "./index";
import { rateLimitHeaders, tooManyRequests } from "./headers";
import { clientIpFromRequest, getLimiter } from "./limiter";

/**
 * Wrap a handler with a per-IP rate limit (GUARDRAILS #6): denied requests
 * get the shared 429 contract; allowed responses carry x-ratelimit-* headers.
 * Composes inside withApi:
 *
 *   export const POST = withApi("route", withRateLimit("route", POLICY.x, handler))
 */
export function withRateLimit(
  route: string,
  policy: RateLimitOptions,
  handler: ApiHandler,
): ApiHandler {
  return async (request: Request) => {
    const ip = clientIpFromRequest(request);
    const result = await getLimiter().limit(`${route}:${ip}`, policy);

    if (!result.success) {
      return tooManyRequests(result);
    }

    const response = await handler(request);
    for (const [header, value] of rateLimitHeaders(result)) {
      try {
        response.headers.set(header, value);
      } catch {
        // immutable headers (e.g. redirects) — same tolerance as withApi
      }
    }
    return response;
  };
}
