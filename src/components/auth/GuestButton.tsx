"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

/**
 * The one-click guest entry (ADR 0009): the click IS the consent moment —
 * we store trial uploads for up to 48h, and an informed click is how we get
 * that consent. The server caps creation at 3/day per IP; this button has
 * nothing to enforce.
 */
export function GuestButton({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signInAsGuest() {
    setPending(true);
    setError(null);
    try {
      const { error } = await authClient.signIn.anonymous();
      if (error) {
        setError(
          error.code === "ANONYMOUS_USERS_CANNOT_SIGN_IN_AGAIN_ANONYMOUSLY"
            ? "You already have a session — open the app to continue."
            : "Could not start a guest session. Please try again.",
        );
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={signInAsGuest}
        disabled={pending}
        className="w-full rounded-lg border border-line px-5 py-3 font-medium transition hover:border-primary disabled:opacity-60"
      >
        {pending ? "Starting workspace…" : "Try as guest"}
      </button>
      {error ? <p className="mt-2 text-center text-sm text-ink-muted">{error}</p> : null}
    </div>
  );
}
