import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withUser } from "@/server/db/rls";
import { apiUsage, auditEvents, chunks, documents, documentVersions } from "@/server/db/schema";
import { getStorage } from "@/server/storage";
import { buildTestPdf } from "./fixtures";
import { ingestDocument } from "./ingest";
import { parseText } from "./parse-text";

/**
 * Ingest orchestration against live Postgres + the dev object store.
 *
 * Without GEMINI_API_KEY (CI default): every failure code is exercised,
 * including the honest `embedding-unavailable` terminal state. With the key
 * set (local): the same suite additionally proves the full happy path —
 * chunks rows with real 768-dim vectors, api_usage metering, ready status.
 */
const runtimeUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL ?? runtimeUrl;
const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY);

const d = describe.skipIf(!runtimeUrl)("document ingest (status flow)", () => {
  let cleanup: postgres.Sql;

  beforeAll(async () => {
    const { applyMigrations } = await import("../db/migrate-lib");
    await applyMigrations(adminUrl!);
    cleanup = postgres(adminUrl!, { prepare: false, max: 1 });
  });

  afterAll(async () => {
    await cleanup?.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await cleanup`truncate table "user" cascade`;
    // FK-realistic fixture (the tenancy suite taught this): tenant rows
    // reference a real user
    await cleanup`
      insert into "user" (id, name, email, is_anonymous, created_at, updated_at)
      values (${UUID}, 'ingester', 'ingester@example.test', false, now(), now())
    `;
  });

  async function seedDocument(userId: string, bytes: Uint8Array, kind: string): Promise<string> {
    const docId = await withUser(userId, async (tx) => {
      const [doc] = await tx
        .insert(documents)
        .values({ userId, name: `test-${kind}`, kind: kind as "digital_pdf", status: "queued" })
        .returning({ id: documents.id });
      const storageKey = `docs/${userId}/${crypto.randomUUID()}`;
      await tx.insert(documentVersions).values({
        userId,
        documentId: doc!.id,
        storageKey,
        versionNo: 1,
      });
      await getStorage().put(storageKey, bytes, "application/pdf");
      return doc!.id;
    });
    return docId;
  }

  async function readDocument(userId: string, documentId: string) {
    const rows = await withUser(userId, (tx) =>
      tx
        .select({
          status: documents.status,
          error: documents.error,
          pageCount: documents.pageCount,
        })
        .from(documents)
        .where(eq(documents.id, documentId)),
    );
    return rows[0]!;
  }

  async function countChunks(userId: string, documentId: string): Promise<number> {
    const rows = await withUser(userId, (tx) =>
      tx
        .select({ id: chunks.id })
        .from(chunks)
        .innerJoin(documentVersions, eq(chunks.versionId, documentVersions.id))
        .where(and(eq(chunks.userId, userId), eq(documentVersions.documentId, documentId))),
    );
    return rows.length;
  }

  const UUID = "33333333-3333-3333-3333-333333333333";

  it("fails a textless PDF honestly: no-text-layer, zero chunks", async () => {
    // page 1 has text, page 2 is empty — all-or-nothing (ADR 0006)
    const pdf = await buildTestPdf([[{ text: "Only page one." }], []]);
    const docId = await seedDocument(UUID, pdf, "digital_pdf");

    await ingestDocument({ userId: UUID, documentId: docId, tier: "registered" });

    const doc = await readDocument(UUID, docId);
    expect(doc.status).toBe("failed");
    expect(doc.error).toBe("no-text-layer");
    expect(doc.pageCount).toBeNull(); // set only on success
    expect(await countChunks(UUID, docId)).toBe(0);
  });

  it("enforces the guest ≤10-page gate by rejection, not truncation", async () => {
    const elevenPages = Array.from({ length: 11 }, () => [{ text: "Page content here." }]);
    const pdf = await buildTestPdf(elevenPages);
    const docId = await seedDocument(UUID, pdf, "digital_pdf");

    await ingestDocument({ userId: UUID, documentId: docId, tier: "guest" });

    const doc = await readDocument(UUID, docId);
    expect(doc.status).toBe("failed");
    expect(doc.error).toBe("too-many-pages");
    expect(doc.pageCount).toBe(11); // the gate reports what it measured
    expect(await countChunks(UUID, docId)).toBe(0);

    // and the same document as a REGISTERED user passes the gate (fails
    // later on embedding availability, never on pages)
    const docId2 = await seedDocument(UUID, pdf, "digital_pdf");
    await ingestDocument({ userId: UUID, documentId: docId2, tier: "registered" });
    const doc2 = await readDocument(UUID, docId2);
    expect(doc2.error).not.toBe("too-many-pages");
  });

  it("fails malformed bytes with a reason, not a 500-shaped mystery", async () => {
    const docx = await seedDocument(
      UUID,
      new TextEncoder().encode("PK\x03\x04 not really a zip"),
      "docx",
    );

    await ingestDocument({ userId: UUID, documentId: docx, tier: "registered" });

    const doc = await readDocument(UUID, docx);
    expect(doc.status).toBe("failed");
    expect(doc.error).toBe("malformed");
  });

  it("missing storage bytes → storage-miss (rows stay consistent)", async () => {
    const docId = await withUser(UUID, async (tx) => {
      const [doc] = await tx
        .insert(documents)
        .values({ userId: UUID, name: "ghost", kind: "md", status: "queued" })
        .returning({ id: documents.id });
      await tx.insert(documentVersions).values({
        userId: UUID,
        documentId: doc!.id,
        storageKey: `docs/${UUID}/never-written`,
        versionNo: 1,
      });
      return doc!.id;
    });

    await ingestDocument({ userId: UUID, documentId: docId, tier: "registered" });

    const doc = await readDocument(UUID, docId);
    expect(doc.status).toBe("failed");
    expect(doc.error).toBe("storage-miss");
  });

  it.skipIf(!hasGeminiKey)(
    "happy path (real Gemini): ready, chunks with 768-dim vectors, metering, audit",
    async () => {
      const pdf = await buildTestPdf([
        [
          { text: "Tenancy", size: 18, bold: true, y: 700 },
          { text: "The tenant shall pay rent monthly. ".repeat(4), y: 660 },
          { text: "The landlord shall repair the roof. ".repeat(4), y: 600 },
        ],
      ]);
      const docId = await seedDocument(UUID, pdf, "digital_pdf");

      await ingestDocument({ userId: UUID, documentId: docId, tier: "registered" });

      const doc = await readDocument(UUID, docId);
      expect(doc.status).toBe("ready");
      expect(doc.error).toBeNull();
      expect(doc.pageCount).toBe(1);

      const chunkRows = await withUser(UUID, (tx) =>
        tx
          .select({ content: chunks.content, embedding: chunks.embedding })
          .from(chunks)
          .innerJoin(documentVersions, eq(chunks.versionId, documentVersions.id))
          .where(eq(documentVersions.documentId, docId)),
      );
      expect(chunkRows.length).toBeGreaterThanOrEqual(2);
      for (const row of chunkRows) {
        expect(row.embedding).toHaveLength(768);
      }

      const usage = await withUser(UUID, (tx) =>
        tx.select({ route: apiUsage.route, provider: apiUsage.provider }).from(apiUsage),
      );
      expect(usage.some((row) => row.route === "embedding" && row.provider === "gemini")).toBe(
        true,
      );

      const audit = await withUser(UUID, (tx) =>
        tx.select({ action: auditEvents.action }).from(auditEvents),
      );
      expect(audit.some((row) => row.action === "document.ingest")).toBe(true);
    },
  );

  it("embeds txt/md without pages honestly (null pageCount on success paths only)", async () => {
    // md happy-path shape check that runs WITHOUT a key: parse + chunk +
    // quota gate reach the embedding step and fail honestly there
    const docId = await seedDocument(
      UUID,
      new TextEncoder().encode("# Head\n\nParagraph text here."),
      "md",
    );

    await ingestDocument({ userId: UUID, documentId: docId, tier: "registered" });

    const doc = await readDocument(UUID, docId);
    if (hasGeminiKey) {
      expect(doc.status).toBe("ready");
      expect(doc.pageCount).toBeNull();
    } else {
      expect(doc.status).toBe("failed");
      expect(doc.error).toBe("embedding-unavailable");
    }
  });

  it("documents the parser is reachable through parse-text for provenance parity", async () => {
    const parsed = parseText("# S\n\nOne.\n\nTwo.", "md");
    expect("paragraphs" in parsed && parsed.paragraphs).toHaveLength(2);
  });
});

export { d as ingestSuite };
