import { eq } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { anonymous } from "better-auth/plugins/anonymous";
import { magicLink } from "better-auth/plugins/magic-link";
import { getDb } from "@/server/db";
import * as schema from "@/server/db/schema";
import { env } from "@/server/lib/env";
import { logger } from "@/server/lib/logger";
import { carryOverTenantData } from "./carry-over";
import { GUEST_SESSION_TTL_SECONDS, maybeSweepGuests } from "./purge";

/**
 * Auth core (Phase 2.1 + 2.3, ARCHITECTURE.md §5–6). Passwordless: OAuth
 * (env-gated) + email magic links + one-click guest sessions (ADR 0009).
 *
 * Guest safety order matters: the /sign-in/anonymous route was ALREADY
 * IP-capped at 3/day by the Phase 2.2 guard before this plugin ever shipped —
 * no unguarded guest endpoint existed at any point.
 */

export interface CreateAuthOverrides {
  /** Injectable for tests — the production sender logs in dev, errors in prod. */
  sendMagicLink?: (data: { email: string; url: string; token: string }) => Promise<void>;
  /**
   * Injectable for tests — fires when a guest registers a real identity.
   * Receives BOTH ids: the retiring ghost and the new registered user. This
   * is the sanctioned data-carry-over point (ADR 0009 postscript) — Phase 2.4
   * copies tenant rows from → to here, before the plugin deletes the ghost.
   */
  onLinkAccount?: (data: { anonymousUserId: string; newUserId: string }) => Promise<void>;
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
    plugins: [
      magicLink({ sendMagicLink: overrides.sendMagicLink ?? defaultSendMagicLink }),
      anonymous({
        // Upgrade semantics (ADR 0009 postscript): for email sign-ups
        // better-auth creates the registered user and DELETES the ghost —
        // onLinkAccount receives both users and is where trial data is carried
        // over (tenant rows: ghost → registered, from Phase 2.4 onward).
        onLinkAccount: async (data) => {
          const anonymousUserId = data.anonymousUser.user.id;
          const newUserId = data.newUser.user.id;

          if (overrides.onLinkAccount) {
            await overrides.onLinkAccount({ anonymousUserId, newUserId });
            return;
          }
          // production upgrade: carry trial data to the registered user
          // (ADR 0009 postscript) BEFORE the plugin deletes the ghost.
          // Signup must never fail because the copy did — log, never throw.
          logger.info(
            { upgradedFromAnonymous: true, fromUserId: anonymousUserId, toUserId: newUserId },
            "guest upgraded to registered account",
          );
          try {
            const result = await carryOverTenantData(anonymousUserId, newUserId);
            if (result.movedRows > 0) {
              logger.info(
                { movedRows: result.movedRows, toUserId: newUserId },
                "guest trial data carried over",
              );
            }
          } catch (error) {
            logger.error(
              { err: String(error), fromUserId: anonymousUserId, toUserId: newUserId },
              "guest trial data carry-over failed — signup continues, data lost",
            );
          }
        },
      }),
    ],
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            if (user.isAnonymous) {
              // lazy sweep backstop (purge.ts) — never blocks creation
              maybeSweepGuests();
            }
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const [user] = await getDb()
              .select({ isAnonymous: schema.user.isAnonymous })
              .from(schema.user)
              .where(eq(schema.user.id, session.userId))
              .limit(1);

            if (!user?.isAnonymous) return;

            // Hard 24h TTL for guest sessions (ADR 0009). The session-refresh
            // window (updateAge: 1 day) is never reached before expiry, so a
            // create-time clamp is sufficient — guest sessions cannot be
            // refreshed into longevity.
            return {
              data: {
                ...session,
                expiresAt: new Date(Date.now() + GUEST_SESSION_TTL_SECONDS * 1000),
              },
            };
          },
        },
      },
    },
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
