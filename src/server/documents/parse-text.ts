import type { ParsedDocument, ParsedParagraph, ParseResult } from "./provenance";

/**
 * TXT/MD parsing (ADR 0006 format table): paragraphs split on blank lines;
 * MD headings (# …) name sections and are not content; line numbers are
 * 1-based positions in the raw file. No field is invented.
 */

export function parseText(raw: string, kind: "txt" | "md"): ParseResult {
  const allLines = raw.split(/\r\n|\r|\n/);
  const paragraphs: ParsedParagraph[] = [];
  let section: string | undefined;
  let buffer: string[] = [];
  let bufferStart = 0;

  const flush = () => {
    const text = buffer.join("\n").trim();
    if (text.length > 0) {
      paragraphs.push({
        index: paragraphs.length + 1,
        text,
        lineStart: bufferStart + 1,
        lineEnd: bufferStart + buffer.length,
        section,
      });
    }
    buffer = [];
  };

  allLines.forEach((line, i) => {
    const isMdHeading = kind === "md" && /^#{1,6}\s+/.test(line);
    const isBlank = line.trim().length === 0;

    if (isMdHeading) {
      flush();
      section = line.replace(/^#{1,6}\s+/, "").trim();
      return; // headings name sections; they are not content paragraphs
    }

    if (isBlank) {
      flush();
      return;
    }

    if (buffer.length === 0) bufferStart = i;
    buffer.push(line);
  });
  flush();

  return { pageCount: null, paragraphs };
}

export type { ParsedDocument, ParsedParagraph };
