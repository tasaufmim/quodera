import postgres from "postgres";
import { logger } from "@/server/lib/logger";

/**
 * Guest lifecycle (ADR 0009): sessions are hard-capped at 24h; rows are purged
 * ≤48h after creation. Two mechanisms keep that promise:
 *
 *  1. the daily Vercel cron → /api/cron/purge-guests (CRON_SECRET-guarded)
 *  2. a lazy sweep below — 10% of guest creations trigger it, so the cron
 *     being missed once never breaks the ≤48h guarantee
 */

export const GUEST_SESSION_TTL_SECONDS = 24 * 60 * 60;
export const GUEST_PURGE_AFTER_HOURS = 48;

/** Placeholder email domain for ghost accounts (better-auth anonymous plugin). */
export const GUEST_EMAIL_DOMAIN = "anonymous.placeholder.invalid";

/**
 * Hard-delete guests older than the purge window. Runs on the ADMIN
 * connection (DATABASE_ADMIN_URL) — a system job, never a tenant access
 * path (SECURITY.md §8, GUARDRAILS #2 note). FK cascades take their
 * sessions and accounts; linking clears `is_anonymous`, so upgraded users
 * are never touched.
 *
 * @returns the number of guest users deleted.
 */
export async function purgeExpiredGuests(databaseUrl: string): Promise<number> {
  const sql = postgres(databaseUrl, { prepare: false, max: 1 });
  try {
    const purged = await sql`
      delete from "user"
      where is_anonymous = true
        and created_at < now() - interval '48 hours'
      returning id
    `;
    return purged.length;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Fire-and-forget lazy sweep: ~10% of guest creations trigger a purge.
 * Never throws, never blocks the request that spawned it.
 */
export function maybeSweepGuests(): void {
  if (Math.random() >= 0.1) return;
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) return;

  void purgeExpiredGuests(url)
    .then((count) => {
      if (count > 0) {
        logger.info({ purgedGuests: count }, "lazy guest sweep");
      }
    })
    .catch((error: unknown) => {
      logger.error({ err: String(error) }, "lazy guest sweep failed");
    });
}
