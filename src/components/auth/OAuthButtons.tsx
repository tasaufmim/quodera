"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

/**
 * OAuth buttons — rendered only for providers whose credentials are
 * configured (the sign-in page decides that server-side).
 */
export function OAuthButtons({ providers }: { providers: Array<"google" | "github"> }) {
  const [pending, setPending] = useState<string | null>(null);

  async function signInWith(provider: "google" | "github") {
    setPending(provider);
    try {
      await authClient.signIn.social({ provider, callbackURL: "/dashboard" });
    } finally {
      setPending(null);
    }
  }

  if (providers.length === 0) return null;

  return (
    <div className="space-y-3">
      {providers.map((provider) => (
        <button
          key={provider}
          type="button"
          onClick={() => void signInWith(provider)}
          disabled={pending !== null}
          className="w-full rounded-lg border border-line px-5 py-3 font-medium capitalize transition hover:border-primary disabled:opacity-60"
        >
          {pending === provider ? "Redirecting…" : `Continue with ${provider}`}
        </button>
      ))}
      <div className="flex items-center gap-3 py-2">
        <span className="h-px flex-1 bg-line" />
        <span className="text-xs text-ink-muted">or</span>
        <span className="h-px flex-1 bg-line" />
      </div>
    </div>
  );
}
