/**
 * The SSE wire protocol (ADR 0011 #5): named events, one JSON payload each.
 * token → streamed prose; citations → verified objects with provenance;
 * done → ids + metering; error → machine-readable code.
 */

export interface CitationEvent {
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

export function sseHeaders(): Record<string, string> {
  return {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
  };
}

export function encodeEvent(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}
