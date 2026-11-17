import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-8">
      <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-sm text-ink-muted">No citation exists for this page.</p>
      <Link
        href="/"
        className="mt-2 rounded-lg border border-line px-4 py-2 text-sm font-medium transition hover:border-primary"
      >
        Back home
      </Link>
    </main>
  );
}
