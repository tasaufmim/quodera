import { getAuth } from "@/server/auth";
import { withApi } from "@/server/lib/api-handler";
import { withRateLimit } from "@/server/rate-limit/guard";
import { POLICY } from "@/server/rate-limit/policy";
import type { RateLimitOptions } from "@/server/rate-limit";

/**
 * better-auth catch-all: every /api/auth/* route (OAuth callbacks, magic
 * link send/verify, session, sign-out) is served by auth.handler, wrapped
 * in withApi for request ids, structured logging, and error capture
 * (GUARDRAILS #3). getAuth() is lazy — the module stays build-safe.
 *
 * Sensitive routes carry an additional per-IP rate limit (GUARDRAILS #6,
 * ARCHITECTURE §8): ordered rules, first match wins. Guest-session creation
 * (ADR 0009) gets its own far stricter quota; the endpoint itself arrives
 * with the anonymous plugin in Phase 2.3.
 */
const AUTH_ROUTE_RULES: Array<{
  label: string;
  policy: RateLimitOptions;
  test: (path: string) => boolean;
}> = [
  {
    label: "guest-creation",
    policy: POLICY.guestCreation,
    test: (path) => path === "/sign-in/anonymous",
  },
  {
    label: "auth-sensitive",
    policy: POLICY.authSensitive,
    test: (path) =>
      path.startsWith("/sign-in/") ||
      path.startsWith("/magic-link/verify") ||
      path.startsWith("/callback/"),
  },
];

function authPath(request: Request): string {
  return new URL(request.url).pathname.replace(/^\/api\/auth/, "");
}

async function handleAuth(request: Request): Promise<Response> {
  const path = authPath(request);
  const rule = AUTH_ROUTE_RULES.find((entry) => entry.test(path));

  const serveAuth = (req: Request) => getAuth().handler(req);
  const handler = rule ? withRateLimit(`auth:${rule.label}`, rule.policy, serveAuth) : serveAuth;

  return handler(request);
}

export const GET = withApi("auth", handleAuth);
export const POST = withApi("auth", handleAuth);
