import { randomUUID } from "node:crypto";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { withUser } from "@/server/db/rls";
import { auditEvents, documents, documentVersions } from "@/server/db/schema";
import { withApi } from "@/server/lib/api-handler";
import { scheduleAfter } from "@/server/lib/after-scheduler";
import { ingestDocument } from "@/server/documents/ingest";
import { refineTextKind, UPLOAD_LIMITS, validateUpload } from "@/server/documents/validate";
import { tooManyRequests } from "@/server/rate-limit/headers";
import { getLimiter } from "@/server/rate-limit/limiter";
import { POLICY } from "@/server/rate-limit/policy";
import { getStorage } from "@/server/storage";

export const dynamic = "force-dynamic";

/**
 * Document upload + list (Phase 2.5). The full SECURITY.md §5 sequence runs
 * per request: session tier → per-user rate → content-length gate → multipart
 * parse → validation pipeline (signature → guards) → guest count cap →
 * storage put → tenant rows via withUser.
 *
 * User-supplied names are display-only metadata (escaped at render, never in
 * storage paths); storage keys are server-generated and user-scoped.
 */

const MAX_NAME_LENGTH = 200;

const nameSchema = z.string().trim().max(MAX_NAME_LENGTH).optional();

const REJECTION_STATUS: Record<string, number> = {
  "empty-file": 422,
  "file-too-large": 413,
  "unsupported-type": 415,
  "zip-bomb": 422,
  "zip-structure": 422,
  "image-bomb": 422,
};

export const POST = withApi("documents.create", async (request: Request) => {
  const user = await getSessionUser(request);
  if (!user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const isGuest = user.isAnonymous;
  const tier = isGuest ? "guest" : "registered";
  const limits = UPLOAD_LIMITS[tier];

  // per-user rate guard (GUARDRAILS #6) — keying by user, not IP
  const rate = await getLimiter().limit(
    `upload:${user.id}`,
    isGuest ? POLICY.guestUploadsPerHour : POLICY.uploadsPerHour,
  );
  if (!rate.success) {
    return tooManyRequests(rate);
  }

  // cheap pre-read gate: content-length can lie, but if it is honest we
  // never even parse the body (limit + 1 MiB multipart overhead)
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > limits.maxBytes + 1024 * 1024) {
    return Response.json({ error: "file-too-large", maxBytes: limits.maxBytes }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "invalid-form" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "missing-file" }, { status: 400 });
  }
  if (file.size === 0) {
    return Response.json({ error: "empty-file" }, { status: 422 });
  }
  if (file.size > limits.maxBytes) {
    return Response.json({ error: "file-too-large", maxBytes: limits.maxBytes }, { status: 413 });
  }

  const rawName = form.get("name");
  if (rawName !== null && typeof rawName !== "string") {
    return Response.json({ error: "invalid-name" }, { status: 400 });
  }
  const nameResult = nameSchema.safeParse(rawName ?? "");
  if (!nameResult.success) {
    return Response.json({ error: "invalid-name" }, { status: 400 });
  }
  const displayName = (nameResult.data || file.name || "untitled").slice(0, MAX_NAME_LENGTH);

  const bytes = new Uint8Array(await file.arrayBuffer());

  // validation pipeline: signature → guards (pure, no DB)
  const validation = validateUpload(bytes, tier);
  if ("error" in validation) {
    return Response.json(validation, { status: REJECTION_STATUS[validation.error] ?? 415 });
  }

  // guest document-count cap (ADR 0009) — before consuming storage space
  if (isGuest && limits.maxDocuments !== null) {
    const owned = await withUser(user.id, async (tx) => {
      const rows = await tx.select({ id: documents.id }).from(documents);
      return rows.length;
    });
    if (owned >= limits.maxDocuments) {
      return Response.json(
        { error: "guest-document-limit", limit: limits.maxDocuments },
        { status: 403 },
      );
    }
  }

  const kind = validation.kind === "txt" ? refineTextKind("txt", file.name) : validation.kind;
  const storageKey = `docs/${user.id}/${randomUUID()}`;

  await getStorage().put(storageKey, bytes, validation.contentType);

  const created = await withUser(user.id, async (tx) => {
    const [doc] = await tx
      .insert(documents)
      .values({ userId: user.id, name: displayName, kind, status: "queued" })
      .returning({ id: documents.id, createdAt: documents.createdAt });
    await tx.insert(documentVersions).values({
      userId: user.id,
      documentId: doc!.id,
      storageKey,
      sha256: validation.sha256,
      versionNo: 1,
    });
    await tx.insert(auditEvents).values({
      userId: user.id,
      action: "document.create",
      detail: { kind, bytes: bytes.length },
    });
    return doc!;
  });

  // Ingest runs AFTER the response is sent: the user's upload resolves
  // immediately; parsing/embedding land via the status flow. Next's after()
  // inside a real request; tests inject an eager scheduler (see
  // after-scheduler.ts — after() throws outside a request scope).
  scheduleAfter(() =>
    ingestDocument({
      userId: user.id,
      documentId: created.id,
      tier: isGuest ? "guest" : "registered",
    }),
  );

  return Response.json(
    {
      document: {
        id: created.id,
        name: displayName,
        kind,
        status: "queued",
        createdAt: created.createdAt,
      },
    },
    { status: 201 },
  );
});

export const GET = withApi("documents.list", async (request: Request) => {
  const user = await getSessionUser(request);
  if (!user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const rows = await withUser(user.id, (tx) =>
    tx
      .select({
        id: documents.id,
        name: documents.name,
        kind: documents.kind,
        status: documents.status,
        error: documents.error,
        pageCount: documents.pageCount,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .orderBy(desc(documents.createdAt))
      .limit(100),
  );

  return Response.json({ documents: rows });
});
