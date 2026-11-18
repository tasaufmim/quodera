import { customType, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * ─── System tables (continued) ──────────────────────────────────────────────
 *
 * dev_object_store — the storage FALLBACK driver (Phase 2.5): when
 * R2 credentials are not configured, uploaded bytes land here so the whole
 * pipeline (upload → store → retrieve) is real in local dev, CI, and
 * credential-less deploys. It is a system table (no RLS — system-managed
 * data, never served cross-tenant), and it is NEVER the intended production
 * home for documents: production sets the R2_* variables (PROVISIONING §5).
 */

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const devObjectStore = pgTable("dev_object_store", {
  key: text("key").primaryKey(),
  contentType: text("content_type").notNull(),
  bytes: bytea("bytes").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
