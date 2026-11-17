import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins/magic-link";
import { getDb } from "@/server/db";
import * as schema from "@/server/db/schema";
import { env } from "@/server/lib/env";
import { logger } from "@/server/lib/logger";

/**
 * Auth core (Phase 2.1, ARCHITECTURE.md §6; system tables documented in
 * schema.ts). Passwordless: OAuth (env-gated — activates when the provider
 * apps exist) + email magic links. The anonymous/guest plugin arrives in
 * Phase 2.3 behind an IP-capped creation route (ADR 0009) — never enabled
 * without that guard.
 */

export interface CreateAuthOverrides {
  /** Injectable for tests — the production sender logs in dev, errors in prod. */
  sendMagicLink?: (data: { email: string; url: string; token: string }) => Promise<void>;
}

export function createAuth(overrides: CreateAuthOverrides = {}) {
  if (process.env.NODE_ENV === "production" && !env.BETTER_AUTH_SECRET) {
    throw new Error(
      "BETTER_AUTH_SECRET must be set in production — see docs/ops/PROVISIONING.md §5",
    );
  }

  return betterAuth({
    database: drizzleAdapter(getDb(), { provider: "pg", schema }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL ?? "http://localhost:3000",
    advanced: { database: { generateId: "uuid" } },
    emailAndPassword: { enabled: false },
    socialProviders: {
      ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
        : {}),
      ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
        ? { github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } }
        : {}),
    },
    plugins: [magicLink({ sendMagicLink: overrides.sendMagicLink ?? defaultSendMagicLink })],
  });
}

/**
 * Dev-mode email "sender": the login link lands in server logs so local
 * flows work without Resend. The URL embeds a one-time token, so logging it
 * is strictly dev-only — production without RESEND_API_KEY fails loudly
 * instead of leaking tokens into logs. The real Resend sender lands with
 * Phase 2.0 provisioning (PROVISIONING.md §6).
 */
async function defaultSendMagicLink({ url }: { email: string; url: string }): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    logger.error(
      { route: "magic-link" },
      "email sender not configured (RESEND_API_KEY missing) — magic link NOT delivered",
    );
    return;
  }
  logger.info({ route: "magic-link" }, `dev magic link: ${url}`);
}

// Lazy singleton: importing this module must never require a database (the
// app builds hermetically; the DB is touched only when a request arrives).
let authInstance: ReturnType<typeof createAuth> | undefined;

export function getAuth(): ReturnType<typeof createAuth> {
  return (authInstance ??= createAuth());
}
