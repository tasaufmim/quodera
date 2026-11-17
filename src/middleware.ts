import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge middleware: security headers on every response.
 *
 * NOTE: middleware runs in the EDGE runtime — not Node. It cannot import
 * anything that uses Node APIs (pino, AsyncLocalStorage, postgres). That is
 * why request IDs are minted in withApi (Node) instead of here, and why the
 * future edge rate-limiter must be fetch-based (Upstash) — ARCHITECTURE.md
 * §runtimes.
 */
const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

function contentSecurityPolicy(): string {
  const isDev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    // Phase 1 keeps 'unsafe-inline' for scripts (Next.js injects inline
    // bootstrap scripts). Phase 2 hardening moves to per-request nonces —
    // tracked in SECURITY.md §content-security-policy.
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

export function middleware(request: NextRequest): NextResponse {
  const response = NextResponse.next();

  for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(header, value);
  }
  response.headers.set("content-security-policy", contentSecurityPolicy());

  // Only send HSTS over actual HTTPS (localhost dev stays untouched).
  if (request.headers.get("x-forwarded-proto") === "https") {
    response.headers.set("strict-transport-security", "max-age=63072000; includeSubDomains");
  }

  return response;
}

export const config = {
  // Everything except Next's internal asset paths.
  matcher: ["/((?!_next).*)"],
};
