import { sql } from "drizzle-orm";
import { getDb, type Db } from "./index";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Run `fn` inside a transaction scoped to `userId` (ADR 0008).
 *
 * `set_config('app.user_id', …, true)` is the function-call equivalent of
 * `SET LOCAL` — the setting dies with the transaction, so tenant context can
 * never leak across requests. RLS policies compare every row's `user_id`
 * against this setting.
 *
 * ALL tenant data access goes through this wrapper (GUARDRAILS #2). Raw
 * `getDb()` queries are default-deny: with no context set, RLS filters every
 * row — rls.test.ts proves both directions.
 */
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}
