/**
 * Client instrumentation (runs in the browser). Guarded the same way as the
 * server side: no NEXT_PUBLIC_SENTRY_DSN, no client-side Sentry.
 */
export async function registerClientSide(): Promise<void> {
  if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
    const Sentry = await import("@sentry/nextjs");
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      environment: process.env.NODE_ENV,
      tracesSampleRate: 0,
    });
  }
}
