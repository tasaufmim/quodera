/**
 * Pure segmentation of cited content: raw answer text (with [n] markers) plus
 * the verified citation map → renderable segments. Kept as data so it is
 * unit-testable and both live streaming and reloaded history share it.
 */

export interface CitationRef {
  marker: number;
  documentId: string;
  documentName: string;
  page: number | null;
  section: string | null;
  paragraphNo: number;
  lineStart: number | null;
  lineEnd: number | null;
  span: string;
  quoteVerified: boolean;
}

export type CitedSegment =
  { type: "text"; text: string } | { type: "marker"; marker: number; verified: boolean };

const MARKER_SPLIT = /(\[\d{1,3}\])/g;

export function splitCitedContent(
  content: string,
  citations: Map<number, CitationRef>,
): CitedSegment[] {
  const segments: CitedSegment[] = [];
  for (const part of content.split(MARKER_SPLIT)) {
    if (part.length === 0) continue;
    const markerMatch = part.match(/^\[(\d{1,3})\]$/);
    if (markerMatch) {
      const marker = Number(markerMatch[1]);
      segments.push({ type: "marker", marker, verified: citations.has(marker) });
    } else {
      segments.push({ type: "text", text: part });
    }
  }
  return segments;
}

/** "lease.pdf, p. 3, ¶ 2, l. 5–7" — the human-readable citation label. */
export function citationLabel(citation: CitationRef): string {
  const parts: string[] = [citation.documentName];
  if (citation.page !== null) parts.push(`p. ${citation.page}`);
  parts.push(`¶ ${citation.paragraphNo}`);
  if (citation.lineStart !== null && citation.lineEnd !== null) {
    parts.push(`l. ${citation.lineStart}–${citation.lineEnd}`);
  }
  return parts.join(", ");
}
