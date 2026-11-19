import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
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
 * ─── Tenant tables (Phase 2.4) ──────────────────────────────────────────────
 *
 * The invariant every tenant table shares (ADR 0008): a non-null `user_id`
 * — DENORMALIZED even when derivable (messages ← threads, versions ←
 * documents). This keeps every RLS policy a single direct comparison (fast,
 * auditable) and makes the upgrade carry-over (ADR 0010) a uniform
 * `update … set user_id = $to where user_id = $from` per table.
 *
 * FKs cascade to user.id: guest purge and upgrades ride the cascade graph.
 * Policies live in migrations/hardening/ — drizzle cannot express RLS.
 */

export const documentStatus = pgEnum("document_status", ["queued", "parsing", "ready", "failed"]);

export const documentKind = pgEnum("document_kind", [
  "digital_pdf",
  "scanned_pdf",
  "image",
  "docx",
  "txt",
  "md",
]);

export const messageRole = pgEnum("message_role", ["user", "assistant"]);

/**
 * Chunks (Phase 3.2): the retrieval unit AND the citation unit — one chunk is
 * one paragraph (or a merge/split per chunk.ts rules), carrying the
 * provenance minted at parse time. `paragraph_no` points at the chunk's FIRST
 * paragraph; the content itself is the citation span (ADR 0006).
 *
 * Embeddings: gemini-embedding-001 @ 768 dims (ADR 0004 postscript) — the
 * dimension is permanent; changing the model means a scripted re-embedding
 * migration. tsvector + HNSW land via migrations/hardening (drizzle cannot
 * express them).
 */
export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    versionId: uuid("version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "cascade" }),
    page: integer("page"),
    section: text("section"),
    paragraphNo: integer("paragraph_no").notNull(),
    lineStart: integer("line_start"),
    lineEnd: integer("line_end"),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 768 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("chunks_user_id_idx").on(table.userId),
    index("chunks_version_id_idx").on(table.versionId),
    index("chunks_version_paragraph_idx").on(table.versionId, table.paragraphNo),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: documentStatus("status").notNull().default("queued"),
    kind: documentKind("kind").notNull(),
    /** Machine-readable failure reason (documents/error.ts codes) — null unless failed. */
    error: text("error"),
    /** Set at parse time; null for formats without pagination. */
    pageCount: integer("page_count"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("documents_user_id_idx").on(table.userId),
    index("documents_user_status_idx").on(table.userId, table.status),
  ],
);

export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    // R2 object key — populated by the upload pipeline (Phase 2.5)
    storageKey: text("storage_key"),
    sha256: text("sha256"),
    versionNo: integer("version_no").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("document_versions_user_id_idx").on(table.userId),
    index("document_versions_document_id_idx").on(table.documentId),
  ],
);

export const threads = pgTable(
  "threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("threads_user_id_idx").on(table.userId)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // denormalized tenant owner (see the tenant-tables invariant above)
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    role: messageRole("role").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("messages_user_id_idx").on(table.userId),
    index("messages_thread_id_idx").on(table.threadId),
  ],
);

export const apiUsage = pgTable(
  "api_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // e.g. "chat", "embedding" — written by the Phase 4 proxy
    route: text("route").notNull(),
    provider: text("provider").notNull(),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("api_usage_user_id_idx").on(table.userId)],
);

/**
 * Append-only by GRANT, not convention: hardening/0004 revokes UPDATE and
 * DELETE from the runtime role. A future bug in app code cannot rewrite
 * history, because the database itself refuses (SECURITY.md, repudiation).
 * The system role (ADR 0010) retains write powers for carry-over.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // e.g. "auth.signin.magiclink", "document.create"
    action: text("action").notNull(),
    detail: jsonb("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_events_user_id_idx").on(table.userId),
    index("audit_events_action_idx").on(table.action),
  ],
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
