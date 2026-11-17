import Link from "next/link";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            Quodera<sup className="ml-0.5 text-xs font-bold text-primary">1</sup>
          </Link>
          <nav className="flex items-center gap-6 text-sm text-ink-muted">
            <Link href="/dashboard" className="transition hover:text-ink">
              App
            </Link>
            <Link href="/api/health" className="font-mono transition hover:text-ink">
              status
            </Link>
          </nav>
        </div>
      </header>

      <div className="flex-1">{children}</div>

      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4 text-xs text-ink-muted">
          <span>Quodera — every answer, demonstrated.</span>
          <span className="font-mono">MIT</span>
        </div>
      </footer>
    </div>
  );
}
