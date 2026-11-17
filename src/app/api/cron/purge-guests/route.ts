import { timingSafeEqual } from "node:crypto";
import { purgeExpiredGuests } from "@/server/auth/purge";
import { withApi } from "@/server/lib/api-handler";
import { logger } from "@/server/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Daily Vercel cron (vercel.json → 03:00 UTC) hard-deletes expired guest
 * accounts (ADR 0009). Runs on the ADMIN connection — a system job, not a
 * tenant access path (SECURITY.md §8).
 *
 * Auth: Vercel cron sends `Authorization: Bearer <CRON_SECRET>`. Without
 * CRON_SECRET configured the route fails CLOSED (401 for everything) — a
 * missing secret must never mean an open purge endpoint.
 *
 * CRON_SECRET is read per-request (not from the import-time env snapshot) so
 * deploys pick up rotated secrets immediately; it is still declared in
 * env.ts + .env.example per GUARDRAILS #9.
 */

function secretMatches(provided: string | null, expected: string | undefined): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function extractSecret(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }
  return request.headers.get("x-cron-secret");
}

async function handlePurge(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    logger.error("CRON_SECRET is not configured — purge endpoint is closed");
    return Response.json({ error: "cron_not_configured" }, { status: 401 });
  }
  if (!secretMatches(extractSecret(request), secret)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const adminUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!adminUrl) {
    return Response.json({ error: "admin_connection_not_configured" }, { status: 500 });
  }

  const purgedGuests = await purgeExpiredGuests(adminUrl);
  return Response.json({ purgedGuests, ranAt: new Date().toISOString() });
}

export const GET = withApi("cron/purge-guests", handlePurge);
export const POST = withApi("cron/purge-guests", handlePurge);
