/** Dashboard copy for machine-readable document states (error-codes.ts). */

export function statusCopy(status: string): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "parsing":
      return "Parsing";
    case "ready":
      return "Ready";
    case "failed":
      return "Failed";
    default:
      return status;
  }
}

export function errorCopy(error: string | null): string | null {
  switch (error) {
    case "no-text-layer":
      return "This PDF has no readable text (it's a scan) — OCR support arrives in a later phase.";
    case "ocr-not-available":
      return "Images and scanned documents need OCR — arrives in a later phase.";
    case "malformed":
      return "The file's structure is unreadable — it may be corrupt or mislabeled.";
    case "too-many-pages":
      return "Guest documents are limited to 10 pages — sign up to index longer documents.";
    case "too-many-chunks":
      return "This document is too large to index. Split it and try again.";
    case "embedding-unavailable":
      return "Embeddings are not configured on this deployment — the document parsed fine and will index once they are.";
    case "embedding-quota":
      return "Daily embedding quota reached — try again tomorrow or sign up for a higher limit.";
    case "storage-miss":
      return "The stored file could not be read back. Please re-upload.";
    case "internal":
      return "Something went wrong while indexing. Please try re-uploading.";
    default:
      return null;
  }
}
