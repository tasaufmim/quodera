import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type { ParsedDocument, ParsedParagraph, ParseResult } from "./provenance";
/**
 * Digital-PDF parsing (ADR 0005 amendment): pdfjs-dist extracts text items
 * WITH coordinates — `transform[4]=x`, `transform[5]=y`, `height=font size`,
 * `hasEOL` marks line ends. Lines group by baseline; paragraphs break on
 * vertical gaps; oversized lines become section headings. That layout
 * analysis is exactly where page/¶/line citations come from.
 *
 * Any page without a text layer marks the document as needing OCR — we
 * refuse to cite what we cannot see (all-or-nothing, ADR 0006 honesty).
 */

interface TextItem {
  str: string;
  transform: number[];
  height: number;
  hasEOL?: boolean;
}

interface Line {
  text: string;
  y: number;
  x: number;
  height: number;
}

export async function parsePdf(bytes: Uint8Array): Promise<ParseResult> {
  const loadingTask = pdfjs.getDocument({
    // pdfjs may detach the buffer it receives — hand it a copy
    data: bytes.slice(),
    verbosity: 0,
  });
  const doc = await loadingTask.promise;

  try {
    const paragraphs: ParsedParagraph[] = [];
    let missingTextLayer = false;

    for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
      const page = await doc.getPage(pageNo);
      const content = await page.getTextContent();
      const lines = groupIntoLines(content.items as TextItem[]);

      if (lines.length === 0) {
        missingTextLayer = true;
        continue;
      }
      paragraphs.push(...groupIntoParagraphs(lines, pageNo));
    }

    if (missingTextLayer) {
      // all-or-nothing: even one textless page makes faithful citations
      // impossible, so the whole document defers to OCR (Phase 5)
      return { error: "no-text-layer" };
    }

    return { pageCount: doc.numPages, paragraphs: numberParagraphs(paragraphs) };
  } finally {
    await loadingTask.destroy();
  }
}

function groupIntoLines(items: TextItem[]): Line[] {
  const lines: Line[] = [];
  let current: Line | null = null;

  for (const item of items) {
    const y = item.transform[5] ?? 0;
    const x = item.transform[4] ?? 0;
    const height = item.height || 1;

    // empty strings are pure line-break markers
    if (item.str.length === 0) {
      if (item.hasEOL && current) {
        lines.push(current);
        current = null;
      }
      continue;
    }

    const sameBaseline =
      current !== null && Math.abs(current.y - y) <= Math.max(current.height, height) * 0.5;

    if (!sameBaseline) {
      if (current) lines.push(current);
      current = { text: item.str, y, x, height };
    } else if (current) {
      // pdfjs items usually carry their own spacing; only heal obvious gaps
      current.text +=
        item.str.startsWith(" ") || current.text.endsWith(" ") ? item.str : ` ${item.str}`;
    }

    if (item.hasEOL && current) {
      lines.push(current);
      current = null;
    }
  }
  if (current) lines.push(current);

  // reading order: top of the page first (pdf coordinates are bottom-up)
  const nonEmpty = lines.filter((line) => line.text.trim().length > 0);
  nonEmpty.sort((a, b) => b.y - a.y);
  return nonEmpty;
}

function groupIntoParagraphs(lines: Line[], page: number): ParsedParagraph[] {
  const heights = lines.map((line) => line.height).sort((a, b) => a - b);
  const bodyHeight = heights[Math.floor(heights.length / 2)] ?? 12;

  const paragraphs: ParsedParagraph[] = [];
  let section: string | undefined;
  let current: Line[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const first = lines.indexOf(current[0]!);
    const last = lines.indexOf(current[current.length - 1]!);
    paragraphs.push({
      index: 0, // assigned document-wide once all pages are parsed
      page,
      lineStart: first + 1,
      lineEnd: last + 1,
      section,
      text: current.map((line) => line.text.trim()).join(" "),
    });
    current = [];
  };

  lines.forEach((line, i) => {
    const isHeading = line.height > bodyHeight * 1.15 && line.text.trim().length <= 80;

    if (isHeading) {
      flush();
      section = line.text.trim();
      return; // the heading line becomes the section, not a paragraph
    }

    const previous = lines[i - 1];
    if (
      current.length > 0 &&
      previous &&
      previous.y - line.y > Math.max(previous.height, line.height) * 1.8
    ) {
      flush();
    }
    current.push(line);
  });
  flush();

  return paragraphs;
}

/** Assign document-wide paragraph indices (1-based, reading order). */
export function numberParagraphs(paragraphs: ParsedParagraph[]): ParsedParagraph[] {
  return paragraphs.map((paragraph, i) => ({ ...paragraph, index: i + 1 }));
}

export type { ParsedDocument };
