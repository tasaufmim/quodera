"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

/**
 * Passwordless sign-in/up: one form for both (magic links sign up new emails
 * automatically — SECURITY.md §3). When submitted FROM a guest session, the
 * server links the account and carries trial data over (ADR 0009 postscript).
 */
export function MagicLinkForm({ devMode }: { devMode: boolean }) {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { error: sendError } = await authClient.signIn.magicLink({
        email,
        callbackURL: "/dashboard",
      });
      if (sendError) {
        setError("Could not send the link. Check the address and try again.");
        return;
      }
      setSent(true);
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-xl border border-line bg-surface p-6 text-center">
        <h2 className="font-medium">Check your email</h2>
        <p className="mt-2 text-sm text-ink-muted">
          A one-time sign-in link is on its way to <span className="text-ink">{email}</span>.
        </p>
        {devMode ? (
          <p className="mt-3 rounded-lg bg-raised p-3 font-mono text-xs text-ink-muted">
            Local dev: the link is printed in the <code>pnpm dev</code> server console.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label htmlFor="email" className="block text-sm text-ink-muted">
        Email
      </label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="you@example.com"
        className="w-full rounded-lg border border-line bg-surface px-4 py-3 text-sm outline-none focus:border-primary"
      />
      <button
        type="submit"
        disabled={pending || email.length === 0}
        className="w-full rounded-lg bg-primary px-5 py-3 font-medium text-primary-ink transition hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Sending link…" : "Send sign-in link"}
      </button>
      {error ? <p className="text-sm text-ink-muted">{error}</p> : null}
    </form>
  );
}
