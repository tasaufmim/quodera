import postgres from "postgres";
import { logger } from "@/server/lib/logger";

/**
 * Upgrade carry-over (ADR 0009 postscript + ADR 0010): when a guest registers,
 * better-auth creates the registered user and DELETES the ghost — this runs
 * inside onLinkAccount, BEFORE that deletion, and moves every tenant row to
 * the new owner so trial work survives signup.
 *
 * Runs on the SYSTEM connection (DATABASE_SYSTEM_URL, role quodera_system):
 * reassigning user_id across owners violates WITH CHECK for every other role
 * by design — that is the tenancy wall doing its job. Ids and FKs are
 * preserved (UPDATE, not copy), so chunks/citations arriving in later phases
 * stay coherent.
 */

/** Every tenant table — the one list the carry-over walks. */
export const TENANT_TABLES = [
  "documents",
  "document_versions",
  "threads",
  "messages",
  "api_usage",
  "audit_events",
] as const;

export interface CarryOverResult {
  carried: boolean;
  movedRows: number;
}

export async function carryOverTenantData(
  fromUserId: string,
  toUserId: string,
): Promise<CarryOverResult> {
  const url = process.env.DATABASE_SYSTEM_URL;
  if (!url) {
    logger.error(
      { fromUserId, toUserId },
      "DATABASE_SYSTEM_URL is not set — guest trial data NOT carried over on upgrade (ADR 0010)",
    );
    return { carried: false, movedRows: 0 };
  }

  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    let movedRows = 0;
    for (const table of TENANT_TABLES) {
      // table names come from the fixed const list above — no interpolation
      // of external input into identifiers
      const result = await sql.unsafe(`update "${table}" set user_id = $2 where user_id = $1`, [
        fromUserId,
        toUserId,
      ]);
      movedRows += result.count;
    }
    return { carried: true, movedRows };
  } finally {
    await sql.end({ timeout: 5 });
  }
}
