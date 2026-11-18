/**
 * The provenance tree every parser produces (ADR 0006 execution).
 *
 * This is the raw material of the citation feature: a paragraph is the
 * smallest unit we track, and every field here flows into chunk rows and
 * later into citation objects. Per-format guarantees match the ADR 0006
 * table exactly — PDFs carry page + line, DOCX carries section only,
 * TXT/MD carry file line numbers, and no field is ever invented.
 */

export interface ParsedParagraph {
  /** 1-based, document-wide, in reading order. */
  index: number;
  text: string;
  /** 1-based page number — PDFs only (DOCX/TXT/MD have no pagination). */
  page?: number;
  /** 1-based line number: within the page for PDFs, within the file for TXT/MD. */
  lineStart?: number;
  lineEnd?: number;
  /** Nearest preceding heading, when the format provides one. */
  section?: string;
}

export interface ParsedDocument {
  /** Page count for PDFs; null for formats without pagination. */
  pageCount: number | null;
  paragraphs: ParsedParagraph[];
}

export type ParseErrorCode =
  /** No (or partial) text layer — the document needs OCR (Phase 5). */
  | "no-text-layer"
  /** The container/structure is unreadable. */
  | "malformed"
  /** Image formats — the OCR worker arrives in Phase 5. */
  | "ocr-not-available";

export type ParseResult = ParsedDocument | { error: ParseErrorCode };
