import { and, desc, eq } from "drizzle-orm";
import { withUser } from "@/server/db/rls";
import { apiUsage, auditEvents, chunks, documents, documentVersions } from "@/server/db/schema";
import { createGeminiEmbeddings } from "@/server/embeddings/gemini";
import { GEMINI_API_KEY_MISSING, getEmbeddings } from "@/server/embeddings/provider";
import { logger } from "@/server/lib/logger";
import { getLimiter } from "@/server/rate-limit/limiter";
import { POLICY } from "@/server/rate-limit/policy";
import { getStorage } from "@/server/storage";
import { buildChunks, CHUNK_RULES } from "./chunk";
import { DOCUMENT_ERRORS, GUEST_MAX_PAGES } from "./error-codes";
import { parseDocument } from "./parse";

/**
 * The ingest orchestrator (Phase 3.3): bytes → parse → guest page gate →
 * chunk → embed → ATOMIC index. Status is honest at every step:
 * queued → parsing → ready | failed(error), and a document is either fully
 * indexed or carries a machine-readable reason — never half-parsed
 * (all chunks + the ready flip land in ONE transaction).
 *
 * Runs via Next's after() (post-response) from the upload route.
 */

export interface IngestRequest {
  userId: string;
  documentId: string;
  /** Captured at upload — the guest tier decides the page gate + quotas. */
  tier: "guest" | "registered";
}

export async function ingestDocument(request: IngestRequest): Promise<void> {
  const { userId, documentId, tier } = request;
  try {
    await setStatus(userId, documentId, "parsing");

    const version = await latestVersion(userId, documentId);
    if (!version?.storageKey) {
      await fail(userId, documentId, DOCUMENT_ERRORS.STORAGE_MISS);
      return;
    }

    const stored = await getStorage().get(version.storageKey);
    if (!stored) {
      await fail(userId, documentId, DOCUMENT_ERRORS.STORAGE_MISS);
      return;
    }

    const documentRow = await withUser(userId, (tx) =>
      tx
        .select({ kind: documents.kind })
        .from(documents)
        .where(eq(documents.id, documentId))
        .limit(1),
    );
    const kind = documentRow[0]?.kind;
    if (!kind) return; // deleted mid-ingest — nothing to do

    const parsed = await parseDocument(stored.bytes, kind);
    if ("error" in parsed) {
      await fail(userId, documentId, parseErrorToCode(parsed.error));
      return;
    }

    // guest ≤10-page gate (ADR 0009) — rejection with a reason, not truncation
    if (tier === "guest" && parsed.pageCount !== null && parsed.pageCount > GUEST_MAX_PAGES) {
      await fail(userId, documentId, DOCUMENT_ERRORS.TOO_MANY_PAGES, parsed.pageCount);
      return;
    }

    const plan = buildChunks(parsed.paragraphs);
    if (plan.length > CHUNK_RULES.maxChunksPerDocument) {
      await fail(userId, documentId, DOCUMENT_ERRORS.TOO_MANY_CHUNKS, parsed.pageCount);
      return;
    }

    // embedding availability + quota — BEFORE spending any provider calls
    if (!getEmbeddings().available) {
      await fail(userId, documentId, GEMINI_API_KEY_MISSING, parsed.pageCount);
      return;
    }
    const batches = Math.ceil(plan.length / 100);
    const quota = await getLimiter().limit(
      `embed:${userId}`,
      tier === "guest" ? POLICY.guestEmbedBatchesDaily : POLICY.embedBatchesDaily,
    );
    if (!quota.success) {
      await fail(userId, documentId, DOCUMENT_ERRORS.EMBEDDING_QUOTA, parsed.pageCount);
      return;
    }
    if (batches > 1) {
      // one unit consumed above; consume the remainder so multi-batch docs
      // count every batch against the daily quota
      for (let i = 1; i < batches; i++) {
        await getLimiter().limit(
          `embed:${userId}`,
          tier === "guest" ? POLICY.guestEmbedBatchesDaily : POLICY.embedBatchesDaily,
        );
      }
    }

    const provider = createGeminiEmbeddings();
    const embeddings = await provider.embed(
      plan.map((chunk) => chunk.content),
      "RETRIEVAL_DOCUMENT",
    );

    // ATOMIC: every chunk + the ready flip in one transaction
    await withUser(userId, async (tx) => {
      await tx.insert(chunks).values(
        plan.map((chunk, i) => ({
          userId,
          versionId: version.id,
          page: chunk.page ?? null,
          section: chunk.section ?? null,
          paragraphNo: chunk.paragraphNo,
          lineStart: chunk.lineStart ?? null,
          lineEnd: chunk.lineEnd ?? null,
          content: chunk.content,
          embedding: embeddings[i]!,
        })),
      );
      await tx
        .update(documents)
        .set({ status: "ready", error: null, pageCount: parsed.pageCount, updatedAt: new Date() })
        .where(eq(documents.id, documentId));
      await tx.insert(auditEvents).values({
        userId,
        action: "document.ingest",
        detail: { documentId, chunks: plan.length, pages: parsed.pageCount },
      });
      await tx.insert(apiUsage).values({
        userId,
        route: "embedding",
        provider: "gemini",
        tokensIn: Math.round(plan.reduce((sum, chunk) => sum + chunk.content.length, 0) / 4),
      });
    });

    logger.info({ documentId, userId, chunks: plan.length }, "document ready");
  } catch (error) {
    logger.error({ err: String(error), documentId, userId }, "ingest failed");
    await fail(userId, documentId, DOCUMENT_ERRORS.INTERNAL).catch(() => {
      // setStatus itself failing means the DB is down; nothing more to do
    });
  }
}

async function latestVersion(userId: string, documentId: string) {
  const rows = await withUser(userId, (tx) =>
    tx
      .select({ id: documentVersions.id, storageKey: documentVersions.storageKey })
      .from(documentVersions)
      .where(and(eq(documentVersions.userId, userId), eq(documentVersions.documentId, documentId)))
      .orderBy(desc(documentVersions.versionNo))
      .limit(1),
  );
  return rows[0];
}

async function setStatus(userId: string, documentId: string, status: "parsing") {
  await withUser(userId, (tx) =>
    tx.update(documents).set({ status, updatedAt: new Date() }).where(eq(documents.id, documentId)),
  );
}

async function fail(
  userId: string,
  documentId: string,
  code: string,
  pageCount?: number | null,
): Promise<void> {
  await withUser(userId, (tx) =>
    tx
      .update(documents)
      .set({ status: "failed", error: code, pageCount: pageCount ?? null, updatedAt: new Date() })
      .where(eq(documents.id, documentId)),
  );
}

function parseErrorToCode(error: string): string {
  switch (error) {
    case "no-text-layer":
      return DOCUMENT_ERRORS.NO_TEXT_LAYER;
    case "malformed":
      return DOCUMENT_ERRORS.MALFORMED;
    case "ocr-not-available":
      return DOCUMENT_ERRORS.OCR_PENDING;
    default:
      return DOCUMENT_ERRORS.INTERNAL;
  }
}
