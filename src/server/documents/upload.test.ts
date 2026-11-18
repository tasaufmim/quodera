import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAuth } from "@/server/auth";
import { withUser } from "@/server/db/rls";
import { documents } from "@/server/db/schema";
import { getStorage } from "@/server/storage";
import { POST as createDocument } from "@/app/api/documents/route";

/**
 * The upload route end-to-end against live Postgres + the dev object store
 * (no R2 credentials in tests — the storage interface makes the two
 * indistinguishable, which is the point of the driver pattern).
 */
const runtimeUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL ?? runtimeUrl;

const ORIGIN = "http://localhost:3000";
const encoder = new TextEncoder();

const d = describe.skipIf(!runtimeUrl)("document upload route", () => {
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
  });

  async function guestSession(ip: string): Promise<{ cookie: string; userId: string }> {
    const auth = createAuth();
    const response = await auth.handler(
      new Request(`${ORIGIN}/api/auth/sign-in/anonymous`, {
        method: "POST",
        headers: { origin: ORIGIN, "x-forwarded-for": ip },
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { user: { id: string } };
    const cookie = response.headers
      .getSetCookie()
      .map((entry) => entry.split(";")[0]!)
      .join("; ");
    return { cookie, userId: body.user.id };
  }

  function uploadRequest(
    cookie: string,
    file: { bytes: Uint8Array; name: string; type: string },
    options: { ip?: string } = {},
  ): Request {
    const form = new FormData();
    form.append("file", new File([file.bytes as BlobPart], file.name, { type: file.type }));
    return new Request(`${ORIGIN}/api/documents`, {
      method: "POST",
      headers: {
        origin: ORIGIN,
        cookie,
        ...(options.ip ? { "x-forwarded-for": options.ip } : {}),
      },
      body: form,
    });
  }

  it("stores a PDF for a guest: document + version rows, storage roundtrip, audit", async () => {
    const { cookie, userId } = await guestSession("10.5.0.1");
    const pdfBytes = encoder.encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF");

    const response = await createDocument(
      uploadRequest(cookie, { bytes: pdfBytes, name: "lease.pdf", type: "application/pdf" }),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      document: { id: string; kind: string; status: string };
    };
    expect(body.document.kind).toBe("digital_pdf");
    expect(body.document.status).toBe("queued");

    // rows exist, owned by the guest, RLS-scoped
    const rows = await withUser(userId, (tx) =>
      tx.select({ id: documents.id, status: documents.status }).from(documents),
    );
    expect(rows).toHaveLength(1);

    // the stored bytes roundtrip through the storage interface
    const [version] = await cleanup`
      select storage_key as "storageKey", sha256 from document_versions where user_id = ${userId}
    `;
    expect(version).toBeDefined();
    expect(String(version!.sha256)).toHaveLength(64);
    const stored = await getStorage().get(String(version!.storageKey));
    expect(stored).not.toBeNull();
    expect(stored!.bytes).toEqual(pdfBytes);

    // audit row (append-only) records the creation
    const [audit] = await cleanup`
      select action from audit_events where user_id = ${userId}
    `;
    expect(audit!.action).toBe("document.create");
  });

  it("enforces the guest document-count cap (2) with a clear 403", async () => {
    const { cookie } = await guestSession("10.5.0.2");
    const pdf = {
      bytes: encoder.encode("%PDF-1.4\n%%EOF"),
      name: "a.pdf",
      type: "application/pdf",
    };

    expect((await createDocument(uploadRequest(cookie, pdf))).status).toBe(201);
    expect((await createDocument(uploadRequest(cookie, pdf))).status).toBe(201);

    const third = await createDocument(uploadRequest(cookie, pdf));
    expect(third.status).toBe(403);
    const body = (await third.json()) as { error: string; limit: number };
    expect(body.error).toBe("guest-document-limit");
    expect(body.limit).toBe(2);
  });

  it("rate-limits uploads per user after the hourly quota (429 contract)", async () => {
    const { cookie } = await guestSession("10.5.0.3");
    const pdf = {
      bytes: encoder.encode("%PDF-1.4\n%%EOF"),
      name: "b.pdf",
      type: "application/pdf",
    };

    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      statuses.push((await createDocument(uploadRequest(cookie, pdf))).status);
    }
    // upload 1-2 succeed; upload 3 hits the count cap (403); upload 4 hits
    // the RATE cap (3/hour) — proven by the x-ratelimit contract headers
    expect(statuses).toEqual([201, 201, 403, 429]);
  });

  it("rejects oversized files for guests at the tier cap (413)", async () => {
    const { cookie } = await guestSession("10.5.0.4");
    const sixMb = new Uint8Array(6 * 1024 * 1024);
    sixMb.set(encoder.encode("%PDF-1.4"), 0);

    const response = await createDocument(
      uploadRequest(cookie, { bytes: sixMb, name: "big.pdf", type: "application/pdf" }),
    );
    expect(response.status).toBe(413);
  });

  it("rejects a binary blob regardless of its declared MIME type (415)", async () => {
    const { cookie } = await guestSession("10.5.0.5");
    // honest signature absent, binary — declared as text/plain
    const elfLike = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00, 0, 0, 0, 0, 0]);

    const response = await createDocument(
      uploadRequest(cookie, { bytes: elfLike, name: "notes.txt", type: "text/plain" }),
    );
    expect(response.status).toBe(415);
  });

  it("refuses anonymous callers (401) — no session, no uploads", async () => {
    const response = await createDocument(
      uploadRequest("no-session", {
        bytes: encoder.encode("%PDF-1.4\n%%EOF"),
        name: "x.pdf",
        type: "application/pdf",
      }),
    );
    expect(response.status).toBe(401);
  });
});

export { d as uploadRouteSuite };
