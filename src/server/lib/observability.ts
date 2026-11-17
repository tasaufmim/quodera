import * as Sentry from "@sentry/nextjs";

/**
 * Report an unexpected error. No-op unless SENTRY_DSN is configured — the SDK
 * is only initialized (instrumentation.ts) when a DSN exists, so local dev and
 * hermetic CI builds never depend on Sentry.
 */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!process.env.SENTRY_DSN) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}
