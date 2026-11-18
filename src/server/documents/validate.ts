import { createHash, randomUUID } from "node:crypto";
import { GUEST_CAPS } from "@/lib/guest-caps";
import { documentKind } from "@/server/db/schema";
import { imageGuard, zipGuard } from "./guards";
import { looksLikeText, sniff, type UploadKind } from "./sniff";

/**
 * Per-tier upload caps (ADR 0009 for guests; the one place they are defined).
 * The ≤10-page guest cap is enforced at PARSE time (Phase 3) — pages are not
 * knowable from bytes alone without parsing, and we do not parse at upload.
 */
export const UPLOAD_LIMITS = {
  guest: {
    maxBytes: GUEST_CAPS.maxMb * 1024 * 1024,
    maxDocuments: GUEST_CAPS.documents,
  },
  registered: {
    maxBytes: 20 * 1024 * 1024,
    maxDocuments: null as number | null, // fair-use only, no hard count
  },
} as const;

export interface UploadValidation {
  kind: (typeof documentKind.enumValues)[number];
  storageKey: string;
  sha256: string;
  contentType: string;
}

export type UploadRejection =
  | { error: "empty-file" }
  | { error: "file-too-large"; maxBytes: number }
  | { error: "unsupported-type" }
  | { error: "zip-bomb" }
  | { error: "zip-structure" }
  | { error: "image-bomb" };

const KIND_CONTENT_TYPES: Record<UploadKind, string> = {
  digital_pdf: "application/pdf",
  image: "image/*", // refined below from the actual signature
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
};

/**
 * The full validation pipeline (SECURITY.md §5): signature → guards → key.
 * Pure: no DB, no storage, no session — every rule testable without HTTP.
 */
export function validateUpload(
  bytes: Uint8Array,
  tier: keyof typeof UPLOAD_LIMITS,
): UploadValidation | UploadRejection {
  if (bytes.length === 0) return { error: "empty-file" };
  if (bytes.length > UPLOAD_LIMITS[tier].maxBytes) {
    return { error: "file-too-large", maxBytes: UPLOAD_LIMITS[tier].maxBytes };
  }

  const sniffed = sniff(bytes);
  if ("reason" in sniffed) {
    // no binary signature — the only remaining accept path is honest text
    if (!looksLikeText(bytes)) return { error: "unsupported-type" };
    return finalize("txt", bytes);
  }

  if (sniffed.kind === "docx") {
    const zip = zipGuard(bytes);
    if (!zip.ok) return { error: zip.reason };
  }

  if (sniffed.kind === "image") {
    const image = imageGuard(bytes, "image");
    if (!image.ok) return { error: image.reason };
  }

  return finalize(sniffed.kind, bytes);
}

function finalize(kind: UploadKind, bytes: Uint8Array): UploadValidation {
  const contentType = kind === "image" ? imageContentType(bytes) : KIND_CONTENT_TYPES[kind];
  return {
    kind,
    storageKey: `docs/${randomUUID()}`, // userId-scoped at the route layer
    sha256: createHash("sha256").update(bytes).digest("hex"),
    contentType,
  };
}

function imageContentType(bytes: Uint8Array): string {
  if (bytes[0] === 0x89) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x52 && bytes[1] === 0x49) return "image/webp";
  return "application/octet-stream";
}

/** .md vs .txt is decided by the ORIGINAL filename extension (display hint), not the content. */
export function refineTextKind(kind: "txt", originalFilename: string): "txt" | "md" {
  return originalFilename.toLowerCase().endsWith(".md") ? "md" : "txt";
}
