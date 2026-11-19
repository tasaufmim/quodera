/**
 * Machine-readable document failure reasons (dashboard copy maps these).
 * Every code is a stable contract: the UI, tests, and users all read them.
 */
export const DOCUMENT_ERRORS = {
  /** No (or partial) text layer — needs the OCR worker (Phase 5). */
  NO_TEXT_LAYER: "no-text-layer",
  OCR_PENDING: "ocr-not-available",
  /** The container was unreadable. */
  MALFORMED: "malformed",
  /** Guest workspace exceeded the ≤10-page cap (ADR 0009, enforced at parse). */
  TOO_MANY_PAGES: "too-many-pages",
  /** Chunk plan exceeded the document ceiling. */
  TOO_MANY_CHUNKS: "too-many-chunks",
  /** GEMINI_API_KEY unset or the provider rejected the batch. */
  EMBEDDING_UNAVAILABLE: "embedding-unavailable",
  /** Daily embedding batch quota exhausted for this user. */
  EMBEDDING_QUOTA: "embedding-quota",
  /** Bytes vanished from storage before ingest ran (should be impossible). */
  STORAGE_MISS: "storage-miss",
  /** Anything unexpected — the code's catch-all keeps the row honest. */
  INTERNAL: "internal",
} as const;

export type DocumentErrorCode = (typeof DOCUMENT_ERRORS)[keyof typeof DOCUMENT_ERRORS];

/** Guest workspaces are capped at 10 pages per document (ADR 0009). */
export const GUEST_MAX_PAGES = 10;
