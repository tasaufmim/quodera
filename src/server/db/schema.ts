import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

/**
 * ─── System tables (better-auth) ────────────────────────────────────────────
 *
 * user / session / account / verification are IDENTITY machinery, not tenant
 * data. They deliberately carry NO user-scoped RLS: session resolution looks
 * up by token BEFORE any tenant context exists (chicken-and-egg with
 * `withUser`), so RLS keyed on `app.user_id` would default-deny login itself.
 * They are written only by better-auth's parameterized queries on the runtime
 * role; the canary pattern (GUARDRAILS #2) governs everything downstream of a
 * user_id FK. See ARCHITECTURE.md §6 and docs/LEARNINGS.md.
 *
 * Field names match better-auth's model exactly (camelCase keys, snake_case
 * columns — same shape its CLI generates). `isAnonymous` is the anonymous
 * plugin's column: added now so guest mode (ADR 0009) needs no ALTER later.
 */

export const user = pgTable(
  "user",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    isAnonymous: boolean("is_anonymous").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("user_email_unique").on(table.email)],
);

export const session = pgTable(
  "session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // FK cascade: deleting a user (guest purge) takes their sessions with it.
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("session_token_unique").on(table.token),
    index("session_user_id_idx").on(table.userId),
  ],
);

export const account = pgTable(
  "account",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("account_user_id_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

/**
 * ─── Tenant tables ─────────────────────────────────────────────────────────
 *
 * tenancy_canary — Phase 1's canary table (ADR 0008).
 *
 * It exists to prove the row-level tenancy pattern BEFORE real domain tables
 * are built on it: RLS + FORCE + transactions scoped via
 * `set_config('app.user_id', …)` (see db/rls.ts and migrations/hardening/).
 *
 * Every real Phase 2 tenant table (documents, chunks, threads, messages, …)
 * must copy this shape: a non-null `user_id`, RLS policies keyed on
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
