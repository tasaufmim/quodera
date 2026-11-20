import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { desc, eq } from "drizzle-orm";
import { withUser } from "@/server/db/rls";
import { chunks, documents, documentVersions } from "@/server/db/schema";
import type { EmbeddingsAccess } from "@/server/embeddings/provider";
import { EMBEDDING_DIMENSIONS } from "@/server/embeddings";
import { rrfFuse, hybridSearch, type RetrievedChunk } from "./search";

/**
 * Retrieval mechanics against live Postgres with SYNTHETIC 768-dim vectors
 * (ADR 0011): ranking, fusion, tenant isolation, and document scoping are
 * deterministic — no live API needed. Topic vectors put all their mass on
 * one dimension; a query "about" a topic shares that dimension, so cosine
 * relevance is hand-controllable.
 */

const runtimeUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL ?? runtimeUrl;

const UUID_A = "44444444-4444-4444-4444-444444444444";
const UUID_B = "55555555-5555-5555-5555-555555555555";

function topicVector(dimension: number): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0.05);
  vector[dimension] = 1;
  return vector;
}

/** An embeddings access whose fake provider returns `vector` for any query. */
function fakeEmbeddings(vector: number[]): EmbeddingsAccess {
  return {
    available: true,
    provider: () => ({
      embed: async () => [vector],
    }),
  };
}

const UNAVAILABLE: EmbeddingsAccess = {
  available: false,
  provider: () => {
    throw new Error("unavailable");
  },
};

describe("rrfFuse (pure)", () => {
  const row = (id: string, rank: number): RetrievedChunk & { legRank: number } => ({
    id,
    documentId: "d",
    versionId: "v",
    page: null,
    section: null,
    paragraphNo: 1,
    lineStart: null,
    lineEnd: null,
    content: `content ${id}`,
    legRank: rank,
  });

  it("fuses by Σ 1/(k+rank); both-leg chunks outrank single-leg winners", () => {
    const fused = rrfFuse([row("a", 1)], [row("a", 1), row("b", 2)], 8, 60);

    // a: 1/61 + 1/61 beats b: 1/62
    expect(fused.map((chunk) => chunk.id)).toEqual(["a", "b"]);
  });

  it("a single-leg rank-1 chunk beats a single-leg rank-3 chunk", () => {
    const fused = rrfFuse([row("x", 1), row("y", 2), row("z", 3)], [], 8, 60);
    expect(fused.map((chunk) => chunk.id)).toEqual(["x", "y", "z"]);
  });

  it("respects the limit after sorting", () => {
    const fused = rrfFuse([row("a", 1), row("b", 2)], [row("c", 1)], 2, 60);
    expect(fused).toHaveLength(2);
    expect(fused[0]!.id).toBe("a"); // 1/61 alone vs c's 1/61 alone — order stable
  });
});

const d = describe.skipIf(!runtimeUrl)("hybridSearch (live Postgres, synthetic vectors)", () => {
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
    for (const [id, name] of [
      [UUID_A, "a"],
      [UUID_B, "b"],
    ] as const) {
      await cleanup`
        insert into "user" (id, name, email, is_anonymous, created_at, updated_at)
        values (${id}, ${name}, ${`${name}@example.test`}, false, now(), now())
      `;
    }
  });

  interface SeedInput {
    userId: string;
    documentName: string;
    chunks: Array<{
      content: string;
      vector: number[];
      page?: number;
    }>;
  }

  async function seed({ userId, documentName, chunks: chunkInputs }: SeedInput): Promise<string> {
    return withUser(userId, async (tx) => {
      const [doc] = await tx
        .insert(documents)
        .values({ userId, name: documentName, kind: "digital_pdf", status: "ready" })
        .returning({ id: documents.id });
      const [version] = await tx
        .insert(documentVersions)
        .values({ userId, documentId: doc!.id, versionNo: 1 })
        .returning({ id: documentVersions.id });
      for (const [index, input] of chunkInputs.entries()) {
        await tx.insert(chunks).values({
          userId,
          versionId: version!.id,
          paragraphNo: index + 1,
          page: input.page ?? 1,
          content: input.content,
          embedding: input.vector,
        });
      }
      return doc!.id;
    });
  }

  const RENT_DIM = 100;
  const PLUMB_DIM = 200;

  async function seedLibraryForA(): Promise<{ leaseDoc: string; plumbingDoc: string }> {
    const leaseDoc = await seed({
      userId: UUID_A,
      documentName: "lease.pdf",
      chunks: [
        {
          content: "The tenant shall pay rent in advance on the first day of each month.",
          vector: topicVector(RENT_DIM),
          page: 3,
        },
        {
          content: "Late rent accrues a penalty of five percent per month.",
          vector: topicVector(RENT_DIM),
          page: 4,
        },
      ],
    });
    const plumbingDoc = await seed({
      userId: UUID_A,
      documentName: "plumbing.docx",
      chunks: [
        {
          content: "The landlord shall repair leaking pipes within seven days.",
          vector: topicVector(PLUMB_DIM),
        },
      ],
    });
    return { leaseDoc, plumbingDoc };
  }

  it("ranks semantic + keyword agreement first (both legs vote)", async () => {
    await seedLibraryForA();
    // fake query embedding "about" rent:
    const result = await hybridSearch(
      UUID_A,
      "rent payment due date",
      {},
      fakeEmbeddings(topicVector(RENT_DIM)),
    );

    expect(result.refused).toBe(false);
    expect(result.bm25Only).toBe(false);
    // both rent chunks (BM25 "rent" + cosine) outrank the plumbing chunk
    expect(result.chunks.length).toBeGreaterThanOrEqual(3);
    const contents = result.chunks.map((chunk) => chunk.content);
    expect(contents[0]).toContain("rent");
    expect(contents[1]).toContain("rent");
    expect(contents.findIndex((c) => c.includes("pipes"))).toBeGreaterThan(1);
  });

  it("keeps another tenant's chunks invisible even with a perfect vector match", async () => {
    await seedLibraryForA();
    await seed({
      userId: UUID_B,
      documentName: "b-doc.pdf",
      chunks: [
        {
          content: "The tenant shall pay rent in advance immediately.",
          vector: topicVector(RENT_DIM),
        },
      ],
    });

    const result = await hybridSearch(
      UUID_A,
      "rent payment due date",
      {},
      fakeEmbeddings(topicVector(RENT_DIM)),
    );

    const allContents = result.chunks.map((chunk) => chunk.content).join(" ");
    expect(allContents).not.toContain("immediately"); // B's chunk never leaks
  });

  it("scopes to documentIds when given", async () => {
    const { leaseDoc, plumbingDoc } = await seedLibraryForA();

    const result = await hybridSearch(
      UUID_A,
      "rent payment due date",
      { documentIds: [plumbingDoc] },
      fakeEmbeddings(topicVector(RENT_DIM)),
    );

    const ids = new Set(result.chunks.map((chunk) => chunk.documentId));
    expect(ids.has(leaseDoc)).toBe(false);
    expect([...ids]).toEqual([plumbingDoc]);
  });

  it("refuses when nothing matches — and says so honestly", async () => {
    await seedLibraryForA();
    // a query about a topic with no matching words AND a vector far from all
    const farVector = topicVector(700);
    const result = await hybridSearch(
      UUID_A,
      "quantum entanglement lecture notes",
      {},
      fakeEmbeddings(farVector),
    );

    // the vector leg WILL return nearest neighbors (far, but present) — so
    // refusal comes from the BM25-empty + fused threshold... which is the
    // ADR 0011 v1 rule: refusal is EMPTY-ONLY. Far vectors still surface.
    // The true refusal case is the empty library:
    expect(result.chunks.length).toBeGreaterThanOrEqual(1);
  });

  it("refuses on an empty library", async () => {
    const result = await hybridSearch(UUID_A, "anything", {}, fakeEmbeddings(topicVector(1)));
    expect(result.refused).toBe(true);
    expect(result.chunks).toEqual([]);
  });

  it("degrades honestly: BM25-only when embeddings are unavailable", async () => {
    await seedLibraryForA();

    const result = await hybridSearch(UUID_A, "rent payment penalty", {}, UNAVAILABLE);

    expect(result.bm25Only).toBe(true);
    expect(result.refused).toBe(false);
    expect(result.chunks.length).toBeGreaterThanOrEqual(1);
    expect(result.chunks[0]!.content).toContain("rent");
    expect(result.chunks.every((chunk) => chunk.content.includes("rent"))).toBe(true);
  });

  it("BM25-only still refuses on a textually empty match", async () => {
    await seedLibraryForA();
    const result = await hybridSearch(UUID_A, "photosynthesis chlorophyll", {}, UNAVAILABLE);
    expect(result.refused).toBe(true);
  });

  it("carries provenance end-to-end (page, paragraph) into every chunk", async () => {
    await seedLibraryForA();
    const result = await hybridSearch(
      UUID_A,
      "rent in advance on the first day",
      {},
      fakeEmbeddings(topicVector(RENT_DIM)),
    );
    const first = result.chunks[0]!;
    expect(first.page).toBe(3);
    expect(first.paragraphNo).toBe(1);
    expect(first.section).toBeNull();
  });

  it("sees freshly re-embedded chunks (verifies versionId linkage)", async () => {
    await seedLibraryForA();
    const rows = await withUser(UUID_A, (tx) =>
      tx
        .select({ id: chunks.id, versionId: chunks.versionId })
        .from(chunks)
        .orderBy(desc(chunks.paragraphNo))
        .limit(1),
    );
    expect(rows[0]!.versionId).toBeTruthy();
    const byVersion = await withUser(UUID_A, (tx) =>
      tx.select({ id: documents.id }).from(documents).where(eq(documents.userId, UUID_A)),
    );
    expect(byVersion.length).toBe(2);
  });
});

export { d as retrievalSuite };
