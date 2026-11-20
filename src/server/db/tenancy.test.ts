import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { carryOverTenantData, TENANT_TABLES } from "@/server/auth/carry-over";
import { getDb } from "./index";
import { withUser, type Tx } from "./rls";
import {
  apiUsage,
  auditEvents,
  chunks,
  citations,
  documentVersions,
  documents,
  messages,
  threads,
} from "./schema";

/**
 * The canary pattern as a REUSABLE suite (ADR 0008): every tenant table
 * registers five adversarial cases. New tables must be added to `TABLES`
 * below — one registration, thirty assertions' worth of guarantees.
 *
 * audit_events is special-cased (append-only by GRANT — UPDATE/DELETE are
 * revoked from the runtime role, SECURITY.md repudiation).
 */
const runtimeUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL ?? runtimeUrl;
const systemUrl = process.env.DATABASE_SYSTEM_URL;

const UUID_A = "11111111-1111-1111-1111-111111111111";
const UUID_B = "22222222-2222-2222-2222-222222222222";

interface TenancyOps<TSeed> {
  /** Insert the table's own row (plus any parents) for `userId`; returns context for the forged case. */
  seed: (tx: Tx, userId: string) => Promise<TSeed>;
  selectAll: (tx: Tx) => Promise<Array<{ userId: string }>>;
  /** Insert a row attributed to A while acting as B — must be FK-valid so ONLY the policy can reject it. */
  forged: (tx: Tx, seedContext: TSeed) => Promise<unknown>;
  crossUpdate: (tx: Tx, owner: string) => Promise<Array<{ id: unknown }>>;
  crossDelete: (tx: Tx, owner: string) => Promise<Array<{ id: unknown }>>;
}

const TABLES: Array<{ label: string; ops: TenancyOps<unknown> }> = [
  {
    label: "documents",
    ops: {
      seed: (tx, userId) =>
        tx
          .insert(documents)
          .values({ userId, name: `doc-${userId}`, kind: "digital_pdf", status: "queued" }),
      selectAll: (tx) => tx.select({ userId: documents.userId }).from(documents),
      forged: (tx) => tx.insert(documents).values({ userId: UUID_A, name: "forged", kind: "md" }),
      crossUpdate: (tx, owner) =>
        tx
          .update(documents)
          .set({ name: "pwned" })
          .where(eq(documents.userId, owner))
          .returning({ id: documents.id }),
      crossDelete: (tx, owner) =>
        tx.delete(documents).where(eq(documents.userId, owner)).returning({ id: documents.id }),
    },
  },
  {
    label: "document_versions",
    ops: {
      seed: async (tx, userId) => {
        const [doc] = await tx
          .insert(documents)
          .values({ userId, name: `v-doc-${userId}`, kind: "digital_pdf" })
          .returning({ id: documents.id });
        await tx.insert(documentVersions).values({ userId, documentId: doc!.id, versionNo: 1 });
        return doc!.id;
      },
      selectAll: (tx) => tx.select({ userId: documentVersions.userId }).from(documentVersions),
      forged: (tx, parentDocumentId) =>
        tx
          .insert(documentVersions)
          .values({ userId: UUID_A, documentId: parentDocumentId as string, versionNo: 2 }),
      crossUpdate: (tx, owner) =>
        tx
          .update(documentVersions)
          .set({ versionNo: 99 })
          .where(eq(documentVersions.userId, owner))
          .returning({ id: documentVersions.id }),
      crossDelete: (tx, owner) =>
        tx
          .delete(documentVersions)
          .where(eq(documentVersions.userId, owner))
          .returning({ id: documentVersions.id }),
    },
  },
  {
    label: "threads",
    ops: {
      seed: (tx, userId) => tx.insert(threads).values({ userId, title: `thread-${userId}` }),
      selectAll: (tx) => tx.select({ userId: threads.userId }).from(threads),
      forged: (tx) => tx.insert(threads).values({ userId: UUID_A, title: "forged" }),
      crossUpdate: (tx, owner) =>
        tx
          .update(threads)
          .set({ title: "pwned" })
          .where(eq(threads.userId, owner))
          .returning({ id: threads.id }),
      crossDelete: (tx, owner) =>
        tx.delete(threads).where(eq(threads.userId, owner)).returning({ id: threads.id }),
    },
  },
  {
    label: "messages",
    ops: {
      seed: async (tx, userId) => {
        const [thread] = await tx
          .insert(threads)
          .values({ userId, title: `m-thread-${userId}` })
          .returning({ id: threads.id });
        await tx
          .insert(messages)
          .values({ userId, threadId: thread!.id, role: "user", content: "hello" });
        return thread!.id;
      },
      selectAll: (tx) => tx.select({ userId: messages.userId }).from(messages),
      forged: (tx, parentThreadId) =>
        tx.insert(messages).values({
          userId: UUID_A,
          threadId: parentThreadId as string,
          role: "assistant",
          content: "forged",
        }),
      crossUpdate: (tx, owner) =>
        tx
          .update(messages)
          .set({ content: "pwned" })
          .where(eq(messages.userId, owner))
          .returning({ id: messages.id }),
      crossDelete: (tx, owner) =>
        tx.delete(messages).where(eq(messages.userId, owner)).returning({ id: messages.id }),
    },
  },
  {
    label: "api_usage",
    ops: {
      seed: (tx, userId) =>
        tx.insert(apiUsage).values({ userId, route: "chat", provider: "openrouter" }),
      selectAll: (tx) => tx.select({ userId: apiUsage.userId }).from(apiUsage),
      forged: (tx) =>
        tx.insert(apiUsage).values({ userId: UUID_A, route: "chat", provider: "gemini" }),
      crossUpdate: (tx, owner) =>
        tx
          .update(apiUsage)
          .set({ tokensIn: 999 })
          .where(eq(apiUsage.userId, owner))
          .returning({ id: apiUsage.id }),
      crossDelete: (tx, owner) =>
        tx.delete(apiUsage).where(eq(apiUsage.userId, owner)).returning({ id: apiUsage.id }),
    },
  },
  {
    label: "chunks",
    ops: {
      seed: async (tx, userId) => {
        const [doc] = await tx
          .insert(documents)
          .values({ userId, name: `chunk-doc-${userId}`, kind: "digital_pdf" })
          .returning({ id: documents.id });
        const [version] = await tx
          .insert(documentVersions)
          .values({ userId, documentId: doc!.id, versionNo: 1 })
          .returning({ id: documentVersions.id });
        await tx.insert(chunks).values({
          userId,
          versionId: version!.id,
          paragraphNo: 1,
          page: 1,
          content: "seed chunk content",
        });
        return version!.id;
      },
      selectAll: (tx) => tx.select({ userId: chunks.userId }).from(chunks),
      forged: (tx, parentVersionId) =>
        tx.insert(chunks).values({
          userId: UUID_A,
          versionId: parentVersionId as string,
          paragraphNo: 2,
          content: "forged chunk",
        }),
      crossUpdate: (tx, owner) =>
        tx
          .update(chunks)
          .set({ content: "pwned" })
          .where(eq(chunks.userId, owner))
          .returning({ id: chunks.id }),
      crossDelete: (tx, owner) =>
        tx.delete(chunks).where(eq(chunks.userId, owner)).returning({ id: chunks.id }),
    },
  },
  {
    label: "citations",
    ops: {
      seed: async (tx, userId) => {
        const [doc] = await tx
          .insert(documents)
          .values({ userId, name: `cite-doc-${userId}`, kind: "digital_pdf" })
          .returning({ id: documents.id });
        const [version] = await tx
          .insert(documentVersions)
          .values({ userId, documentId: doc!.id, versionNo: 1 })
          .returning({ id: documentVersions.id });
        const [chunk] = await tx
          .insert(chunks)
          .values({ userId, versionId: version!.id, paragraphNo: 1, content: "seed" })
          .returning({ id: chunks.id });
        const [thread] = await tx
          .insert(threads)
          .values({ userId, title: "t" })
          .returning({ id: threads.id });
        const [message] = await tx
          .insert(messages)
          .values({ userId, threadId: thread!.id, role: "assistant", content: "m" })
          .returning({ id: messages.id });
        await tx.insert(citations).values({
          userId,
          chunkId: chunk!.id,
          messageId: message!.id,
          marker: 1,
          span: "seed",
        });
        return { chunkId: chunk!.id, messageId: message!.id };
      },
      selectAll: (tx) => tx.select({ userId: citations.userId }).from(citations),
      forged: (tx, seedContext) =>
        tx.insert(citations).values({
          userId: UUID_A,
          chunkId: (seedContext as { chunkId: string }).chunkId,
          messageId: (seedContext as { messageId: string }).messageId,
          marker: 2,
          span: "forged",
        }),
      crossUpdate: (tx, owner) =>
        tx
          .update(citations)
          .set({ span: "pwned" })
          .where(eq(citations.userId, owner))
          .returning({ id: citations.id }),
      crossDelete: (tx, owner) =>
        tx.delete(citations).where(eq(citations.userId, owner)).returning({ id: citations.id }),
    },
  },
];

const d = describe.skipIf(!runtimeUrl)("tenant tables (canary pattern)", () => {
  let cleanup: postgres.Sql;

  beforeAll(async () => {
    const { applyMigrations } = await import("./migrate-lib");
    await applyMigrations(adminUrl!);
    cleanup = postgres(adminUrl!, { prepare: false, max: 1 });
  });

  afterAll(async () => {
    await cleanup?.end({ timeout: 5 });
  });

  beforeEach(async () => {
    // "user" CASCADE truncates every table with an FK chain to it — auth
    // tables AND all tenant tables in one statement.
    await cleanup`truncate table "user" cascade`;

    // FK-realistic fixtures: tenant rows reference real user rows (the new
    // tables enforce user_id → user.id, unlike the FK-free canary).
    // Single-row inserts — multi-row VALUES with template params cannot be
    // type-inferred (see LEARNINGS).
    await cleanup`
      insert into "user" (id, name, email, is_anonymous, created_at, updated_at)
      values (${UUID_A}, 'tenant-a', 'a@example.test', false, now(), now())
    `;
    await cleanup`
      insert into "user" (id, name, email, is_anonymous, created_at, updated_at)
      values (${UUID_B}, 'tenant-b', 'b@example.test', false, now(), now())
    `;
  });

  for (const { label, ops } of TABLES) {
    describe(label, () => {
      it("inserts and reads its own rows inside withUser", async () => {
        await withUser(UUID_A, (tx) => ops.seed(tx, UUID_A));
        const rows = await withUser(UUID_A, (tx) => ops.selectAll(tx));
        expect(rows.length).toBeGreaterThanOrEqual(1);
        expect(rows.every((row) => row.userId === UUID_A)).toBe(true);
      });

      it("cannot SELECT another tenant's rows", async () => {
        await withUser(UUID_A, (tx) => ops.seed(tx, UUID_A));
        const rowsAsB = await withUser(UUID_B, (tx) => ops.selectAll(tx));
        expect(rowsAsB).toHaveLength(0);
      });

      it("cannot INSERT rows attributed to another tenant (WITH CHECK)", async () => {
        const ctx = await withUser(UUID_A, (tx) => ops.seed(tx, UUID_A));
        await expect(withUser(UUID_B, (tx) => ops.forged(tx, ctx))).rejects.toThrow();
      });

      it("cannot UPDATE or DELETE another tenant's rows (zero affected)", async () => {
        await withUser(UUID_A, (tx) => ops.seed(tx, UUID_A));

        const updated = await withUser(UUID_B, (tx) => ops.crossUpdate(tx, UUID_A));
        expect(updated).toHaveLength(0);

        const deleted = await withUser(UUID_B, (tx) => ops.crossDelete(tx, UUID_A));
        expect(deleted).toHaveLength(0);

        const rowsAsA = await withUser(UUID_A, (tx) => ops.selectAll(tx));
        expect(rowsAsA.length).toBeGreaterThanOrEqual(1);
      });

      it("default-deny: no tenant context means zero rows, even as the table owner", async () => {
        await withUser(UUID_A, (tx) => ops.seed(tx, UUID_A));
        // a bare transaction sets no context — FORCE RLS must filter
        const rows = await getDb().transaction(async (tx) => ops.selectAll(tx));
        expect(rows).toHaveLength(0);
      });
    });
  }

  describe("audit_events — append-only by GRANT, not convention", () => {
    it("runtime role can insert and read its own audit events", async () => {
      await withUser(UUID_A, (tx) =>
        tx.insert(auditEvents).values({ userId: UUID_A, action: "test.event" }),
      );
      const rows = await withUser(UUID_A, (tx) =>
        tx.select({ userId: auditEvents.userId }).from(auditEvents),
      );
      expect(rows).toHaveLength(1);
    });

    it("cannot SELECT another tenant's audit events", async () => {
      await withUser(UUID_A, (tx) =>
        tx.insert(auditEvents).values({ userId: UUID_A, action: "test.event" }),
      );
      const rowsAsB = await withUser(UUID_B, (tx) =>
        tx.select({ userId: auditEvents.userId }).from(auditEvents),
      );
      expect(rowsAsB).toHaveLength(0);
    });

    it("runtime role cannot UPDATE its own audit events (revoked)", async () => {
      await withUser(UUID_A, (tx) =>
        tx.insert(auditEvents).values({ userId: UUID_A, action: "test.event" }),
      );
      await expectPermissionDenied(
        withUser(UUID_A, (tx) =>
          tx.update(auditEvents).set({ action: "tampered" }).where(eq(auditEvents.userId, UUID_A)),
        ),
      );
    });

    it("runtime role cannot DELETE its own audit events (revoked)", async () => {
      await withUser(UUID_A, (tx) =>
        tx.insert(auditEvents).values({ userId: UUID_A, action: "test.event" }),
      );
      await expectPermissionDenied(
        withUser(UUID_A, (tx) => tx.delete(auditEvents).where(eq(auditEvents.userId, UUID_A))),
      );
    });
  });

  describe.skipIf(!systemUrl)("system role (ADR 0010)", () => {
    it("sees and reassigns rows the runtime role cannot touch", async () => {
      await withUser(UUID_A, (tx) => ops_documents_seed(tx));
      const system = postgres(systemUrl!, { prepare: false, max: 1 });
      try {
        const visible = await system`select user_id from documents`;
        expect(visible.length).toBeGreaterThanOrEqual(1);

        const moved = await system.unsafe(
          `update "documents" set user_id = $2 where user_id = $1`,
          [UUID_A, UUID_B],
        );
        expect(moved.count).toBeGreaterThanOrEqual(1);

        const rowsAsB = await withUser(UUID_B, (tx) =>
          tx.select({ userId: documents.userId }).from(documents),
        );
        expect(rowsAsB.length).toBeGreaterThanOrEqual(1);
      } finally {
        await system.end({ timeout: 5 });
      }
    });

    it("carryOverTenantData moves exactly one row per tenant table, ids preserved", async () => {
      const ghostId = crypto.randomUUID();
      const registeredId = crypto.randomUUID();
      // single-row inserts — multi-row VALUES with template params cannot be
      // type-inferred (see LEARNINGS)
      await cleanup`
        insert into "user" (id, name, email, is_anonymous, created_at, updated_at)
        values (${ghostId}, 'ghost', ${`ghost-${crypto.randomUUID()}@anonymous.placeholder.invalid`}, true, now(), now())
      `;
      await cleanup`
        insert into "user" (id, name, email, is_anonymous, created_at, updated_at)
        values (${registeredId}, 'reg', ${`reg-${crypto.randomUUID()}@example.test`}, false, now(), now())
      `;

      const docId = await withUser(ghostId, async (tx) => {
        const [doc] = await tx
          .insert(documents)
          .values({ userId: ghostId, name: "trial-doc", kind: "digital_pdf" })
          .returning({ id: documents.id });
        await tx
          .insert(documentVersions)
          .values({ userId: ghostId, documentId: doc!.id, versionNo: 1 });
        const [thread] = await tx
          .insert(threads)
          .values({ userId: ghostId, title: "trial-thread" })
          .returning({ id: threads.id });
        await tx
          .insert(messages)
          .values({ userId: ghostId, threadId: thread!.id, role: "user", content: "hi" });
        await tx
          .insert(apiUsage)
          .values({ userId: ghostId, route: "chat", provider: "openrouter" });
        await tx.insert(auditEvents).values({ userId: ghostId, action: "trial.event" });
        return doc!.id;
      });

      const result = await carryOverTenantData(ghostId, registeredId);
      expect(result.carried).toBe(true);
      expect(result.movedRows).toBe(TENANT_TABLES.length);

      const [movedDoc] = await withUser(registeredId, (tx) =>
        tx.select({ id: documents.id, userId: documents.userId }).from(documents),
      );
      expect(movedDoc!.id).toBe(docId);
      expect(movedDoc!.userId).toBe(registeredId);
    });
  });
});

async function ops_documents_seed(tx: Tx): Promise<unknown> {
  return tx.insert(documents).values({ userId: UUID_A, name: "system-role-doc", kind: "md" });
}

/**
 * Assert a promise rejects with a Postgres PERMISSION error specifically —
 * walking the cause chain because drizzle wraps the real error
 * ("Failed query: …" with the pg error as .cause). A generic rejects.toThrow
 * could pass for the wrong reason (RLS instead of the grant).
 */
async function expectPermissionDenied(attempt: Promise<unknown>): Promise<void> {
  const error = await attempt.then(
    () => {
      throw new Error("expected the operation to be rejected, but it succeeded");
    },
    (caught: unknown) => caught,
  );

  const messages: string[] = [String(error)];
  let cause = (error as { cause?: unknown }).cause;
  while (cause) {
    messages.push(String(cause));
    cause = (cause as { cause?: unknown }).cause;
  }

  expect(messages.join(" ")).toMatch(/permission denied/i);
}

export { d as tenancySuite };
