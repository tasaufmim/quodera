/**
 * Server instrumentation — runs once per Node.js server process.
 * Sentry initializes ONLY when SENTRY_DSN is set, so local dev, CI, and
 * hermetic builds never depend on it. (Phase 1: error events only, no
 * performance sampling — free Sentry quota is limited.)
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.SENTRY_DSN) {
    const Sentry = await import("@sentry/nextjs");
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV,
      tracesSampleRate: 0,
    });
  }
}

/** Hook Next.js calls for uncaught errors in server components/actions. */
export async function onRequestError(
  error: unknown,
  request: { headers: Record<string, string | string[]>; method?: string; url?: string },
  routeContext: { path: string; rewrite?: string },
  _digest: string | undefined,
): Promise<void> {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  // Adapt Next's hook shape to Sentry's RequestInfo/ErrorContext (v11).
  Sentry.captureRequestError(
    error,
    {
      path: routeContext.path,
      method: request.method ?? "GET",
      headers: request.headers,
    },
    {
      routerKind: "App Router",
      routePath: routeContext.path,
      routeType: "render",
    },
  );
}
