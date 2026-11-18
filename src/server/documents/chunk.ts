import type { ParsedParagraph } from "./provenance";

/**
 * Paragraph-level chunker (the Phase 3 locked design): one chunk = one
 * paragraph, because citations map 1:1 to spans. Adjustments, in priority
 * order:
 *
 *  1. OVERSIZE paragraphs split at sentence boundaries (never mid-sentence)
 *  2. TINY neighbors merge up to the target — but never across pages or
 *     section boundaries (a chunk must have one page, one section)
 *  3. Nothing is ever invented: every field comes from the provenance tree
 */

export const CHUNK_RULES = {
  /** Paragraphs below this size merge with a neighbor when possible. */
  minChars: 100,
  /** Soft target when merging. */
  targetChars: 800,
  /** Hard per-chunk ceiling — oversize paragraphs split at ~target. */
  maxChars: 1200,
  /** Document-wide ceiling; enforced by the ingest orchestrator. */
  maxChunksPerDocument: 1500,
} as const;

export interface ChunkPlan {
  content: string;
  page?: number;
  paragraphNo: number;
  lineStart?: number;
  lineEnd?: number;
  section?: string;
}

type Piece = ParsedParagraph;

export function buildChunks(paragraphs: ParsedParagraph[]): ChunkPlan[] {
  const pieces: Piece[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.text.length <= CHUNK_RULES.maxChars) {
      pieces.push(paragraph);
      continue;
    }
    pieces.push(...splitOversize(paragraph));
  }

  const chunks: ChunkPlan[] = [];
  let acc: Piece | null = null;

  for (const piece of pieces) {
    if (acc === null) {
      acc = piece;
      continue;
    }

    const samePage = acc.page === piece.page;
    const sameSection = acc.section === piece.section;
    const combined = acc.text.length + piece.text.length + 1;
    const eitherTiny =
      acc.text.length < CHUNK_RULES.minChars || piece.text.length < CHUNK_RULES.minChars;

    if (samePage && sameSection && eitherTiny && combined <= CHUNK_RULES.targetChars) {
      acc = {
        ...acc,
        text: `${acc.text} ${piece.text}`,
        lineEnd: piece.lineEnd ?? acc.lineEnd,
      };
      continue;
    }

    chunks.push(toChunk(acc));
    acc = piece;
  }
  if (acc) chunks.push(toChunk(acc));

  return chunks;
}

function splitOversize(paragraph: ParsedParagraph): Piece[] {
  const pieces: Piece[] = [];
  let start = 0;

  while (start < paragraph.text.length) {
    const hardEnd = Math.min(start + CHUNK_RULES.maxChars, paragraph.text.length);
    let end = hardEnd;

    if (end < paragraph.text.length) {
      // split at the last sentence boundary inside the target window
      const windowStart = start + CHUNK_RULES.minChars;
      const search = paragraph.text.slice(windowStart, start + CHUNK_RULES.targetChars);
      let lastBreak = -1;
      for (const match of search.matchAll(/[.!?](\s|$)/g)) {
        lastBreak = match.index + 1;
      }
      if (lastBreak >= 0) {
        end = windowStart + lastBreak;
      }
    }

    // the trimmed piece's true content offset — a split landing ON a newline
    // means the piece's content begins on the NEXT line, not the boundary's
    const raw = paragraph.text.slice(start, end);
    const trimmed = raw.trim();
    const effectiveStart = start + (raw.length - raw.trimStart().length);

    pieces.push({
      ...paragraph,
      text: trimmed,
      lineStart:
        paragraph.lineStart !== undefined
          ? paragraph.lineStart + countNewlines(paragraph.text.slice(0, effectiveStart))
          : undefined,
      // a piece containing N newlines spans N+1 lines: lineStart + N.
      // A no-newline piece is one line — lineEnd === lineStart, truthfully.
      lineEnd:
        paragraph.lineStart !== undefined
          ? paragraph.lineStart +
            countNewlines(paragraph.text.slice(0, effectiveStart)) +
            countNewlines(trimmed)
          : undefined,
    });
    start = end;
  }

  return pieces.filter((piece) => piece.text.length > 0);
}

function countNewlines(text: string): number {
  let count = 0;
  for (const char of text) {
    if (char === "\n") count++;
  }
  return count;
}

function toChunk(piece: Piece): ChunkPlan {
  return {
    content: piece.text,
    page: piece.page,
    paragraphNo: piece.index,
    lineStart: piece.lineStart,
    lineEnd: piece.lineEnd,
    section: piece.section,
  };
}
