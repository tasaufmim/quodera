import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { GuestButton } from "@/components/auth/GuestButton";
import { MagicLinkForm } from "@/components/auth/MagicLinkForm";
import { OAuthButtons } from "@/components/auth/OAuthButtons";
import { getSessionUserFromHeaders } from "@/server/auth/session";
import { env } from "@/server/lib/env";
import { GUEST_CAPS } from "@/lib/guest-caps";

export const metadata = { title: "Sign in" };

/**
 * One door for everyone (passwordless — SECURITY.md §3): OAuth when
 * configured, magic link for email, guests one click away. Signed-in users
 * have no business here.
 */
export default async function SignInPage() {
  const user = await getSessionUserFromHeaders(await headers());
  if (user) {
    redirect("/dashboard");
  }

  const providers = [
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? (["google"] as const) : []),
    ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET ? (["github"] as const) : []),
  ];

  return (
    <main className="mx-auto max-w-md px-6 py-20">
      <h1 className="text-2xl font-semibold tracking-tight">
        Sign in to Quodera<sup className="ml-0.5 text-xs font-bold text-primary">1</sup>
      </h1>
      <p className="mt-2 text-sm text-ink-muted">
        No passwords. A one-time link, a provider, or a guest workspace.
      </p>

      <div className="mt-8 space-y-6">
        <section className="rounded-xl border border-line bg-surface p-6">
          <h2 className="mb-4 font-medium">Registered access</h2>
          <OAuthButtons providers={[...providers]} />
          <MagicLinkForm devMode={process.env.NODE_ENV === "development"} />
        </section>

        <section className="rounded-xl border border-line bg-surface p-6">
          <h2 className="mb-1 font-medium">Just looking?</h2>
          <p className="mb-4 text-sm text-ink-muted">
            A guest workspace holds {GUEST_CAPS.documents} documents ({GUEST_CAPS.maxMb} MB each)
            and lives for 48 hours. Sign up later and your documents carry over.
          </p>
          <GuestButton />
        </section>
      </div>
    </main>
  );
}
