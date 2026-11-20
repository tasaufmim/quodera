import Link from "next/link";
import { headers } from "next/headers";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { getSessionUserFromHeaders } from "@/server/auth/session";
import { GUEST_CAPS } from "@/lib/guest-caps";

/**
 * Authenticated app shell (three-state, ARCHITECTURE §5). The session is
 * resolved server-side and cached per request (React cache) — the layout
 * header, the guest banner, and every page share one lookup.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUserFromHeaders(await headers());

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-3">
          <Link href="/" className="font-semibold tracking-tight">
            Quodera<sup className="ml-0.5 text-xs font-bold text-primary">1</sup>
          </Link>
          <div className="flex items-center gap-4">
            <nav className="flex items-center gap-3 text-sm">
              <Link href="/dashboard" className="text-ink-muted transition hover:text-ink">
                Documents
              </Link>
              <Link href="/chat" className="text-ink-muted transition hover:text-ink">
                Chat
              </Link>
            </nav>
            <span className="font-mono text-xs text-ink-muted">
              {user ? (user.isAnonymous ? "guest" : user.email) : "signed out"}
            </span>
            {user ? <SignOutButton /> : null}
          </div>
        </div>
      </header>

      {user?.isAnonymous ? (
        <div className="border-b border-line bg-raised">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-6 py-2 text-xs">
            <span className="text-ink-muted">
              Temporary guest workspace — deleted within {GUEST_CAPS.purgeAfterHours} hours.
            </span>
            <Link href="/sign-in" className="font-medium text-primary transition hover:opacity-80">
              Sign up to keep your documents →
            </Link>
          </div>
        </div>
      ) : null}

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
