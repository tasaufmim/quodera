import Link from "next/link";

/**
 * Authenticated app shell. The better-auth session gate mounts here in
 * Phase 2 — every child route will be protected then (ARCHITECTURE.md §phases).
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-3">
          <Link href="/" className="font-semibold tracking-tight">
            Quodera<sup className="ml-0.5 text-xs font-bold text-primary">1</sup>
          </Link>
          <p className="font-mono text-xs text-ink-muted">auth gate mounts here in phase 2</p>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
