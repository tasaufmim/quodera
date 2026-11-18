import { createAuthClient } from "better-auth/react";
import { anonymousClient, magicLinkClient } from "better-auth/client/plugins";

/**
 * The isomorphic auth client (src/lib — the client boundary per AGENTS.md).
 * Talks to /api/auth/* only; every quota and permission decision stays
 * server-side. Guest sign-in is deliberately surfaced here because the
 * server route is already IP-capped (ADR 0009) — the button is the consent
 * moment, the cap is the guard.
 */
export const authClient = createAuthClient({
  plugins: [anonymousClient(), magicLinkClient()],
});

export type AuthClient = typeof authClient;
