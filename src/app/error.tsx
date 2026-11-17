"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="max-w-md text-center text-sm text-ink-muted">
        An unexpected error occurred and was logged. Quote the digest below if you report this.
      </p>
      {error.digest ? (
        <code className="rounded bg-raised px-2 py-1 font-mono text-xs text-ink-muted">
          {error.digest}
        </code>
      ) : null}
      <button
        type="button"
        onClick={reset}
        className="mt-2 rounded-lg border border-line px-4 py-2 text-sm font-medium transition hover:border-primary"
      >
        Try again
      </button>
    </main>
  );
}
