import { eq } from "drizzle-orm";
import { withApi } from "@/server/lib/api-handler";
import { getSessionUser } from "@/server/auth/session";
import { withUser } from "@/server/db/rls";
import {
  citations,
  chunks,
  documentVersions,
  documents,
  messages,
  threads,
} from "@/server/db/schema";

export const dynamic = "force-dynamic";

/**
 * A thread's history WITH its citations (marker→chunk→document names) —
 * reloading a thread re-renders its evidence instead of losing it
 * (the reason the citations table exists).
 */
export const GET = withApi("threads.messages", async (request: Request, context?: unknown) => {
  const session = await getSessionUser(request);
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id: threadId } = await (context as { params: Promise<{ id: string }> }).params;

  // RLS makes an unowned thread invisible — 404, never 403 (no existence leak)
  const owned = await withUser(session.id, (tx) =>
    tx.select({ id: threads.id }).from(threads).where(eq(threads.id, threadId)).limit(1),
  );
  if (owned.length === 0) {
    return Response.json({ error: "thread-not-found" }, { status: 404 });
  }

  const rows = await withUser(session.id, (tx) =>
    tx
      .select({
        id: messages.id,
        role: messages.role,
        content: messages.content,
        createdAt: messages.createdAt,
        citationMarker: citations.marker,
        citationSpan: citations.span,
        citationVerified: citations.verified,
        documentId: documents.id,
        documentName: documents.name,
        page: chunks.page,
        section: chunks.section,
        paragraphNo: chunks.paragraphNo,
        lineStart: chunks.lineStart,
        lineEnd: chunks.lineEnd,
      })
      .from(messages)
      .leftJoin(citations, eq(citations.messageId, messages.id))
      .leftJoin(chunks, eq(citations.chunkId, chunks.id))
      .leftJoin(documentVersions, eq(chunks.versionId, documentVersions.id))
      .leftJoin(documents, eq(documentVersions.documentId, documents.id))
      .where(eq(messages.threadId, threadId))
      .orderBy(messages.createdAt),
  );

  // group rows into messages, folding citation rows into each message
  const byMessage = new Map<
    string,
    {
      id: string;
      role: "user" | "assistant";
      content: string;
      createdAt: string;
      citations: Array<Record<string, unknown>>;
    }
  >();

  for (const row of rows) {
    let message = byMessage.get(row.id);
    if (!message) {
      message = {
        id: row.id,
        role: row.role as "user" | "assistant",
        content: row.content,
        createdAt: row.createdAt.toISOString(),
        citations: [],
      };
      byMessage.set(row.id, message);
    }
    if (row.citationMarker !== null) {
      message.citations.push({
        marker: row.citationMarker,
        span: row.citationSpan,
        verified: row.citationVerified,
        documentId: row.documentId,
        documentName: row.documentName ?? "document",
        page: row.page,
        section: row.section,
        paragraphNo: row.paragraphNo,
        lineStart: row.lineStart,
        lineEnd: row.lineEnd,
      });
    }
  }

  return Response.json({ messages: [...byMessage.values()] });
});
