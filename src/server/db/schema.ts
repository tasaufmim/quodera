import { pgTable, text, timestamp, uuid, vector } from "drizzle-orm/pg-core";

/**
 * tenancy_canary — Phase 1's canary table (ADR 0008).
 *
 * It exists to prove the row-level tenancy pattern BEFORE real domain tables
 * are built on it: RLS + FORCE + transactions scoped via
 * `set_config('app.user_id', …)` (see db/rls.ts and migrations/hardening/).
 *
 * Every real Phase 2 table (documents, chunks, threads, messages, …) must
 * copy this shape: a non-null `user_id`, RLS policies keyed on
 * `current_setting('app.user_id')`, and tenancy tests (rls.test.ts).
 *
 * The embedding dimension is deliberately tiny (8) — it only exercises the
 * pgvector column type. Real tables use the Gemini embedding model's output
 * dimension, and the dimension MUST match the model exactly (ADR 0004).
 */
export const tenancyCanary = pgTable("tenancy_canary", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 8 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type TenancyCanary = typeof tenancyCanary.$inferSelect;
export type NewTenancyCanary = typeof tenancyCanary.$inferInsert;
