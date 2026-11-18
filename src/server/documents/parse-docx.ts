import { unzipSync } from "fflate";
import type { ParsedDocument, ParsedParagraph, ParseResult } from "./provenance";

/**
 * DOCX parser (ADR 0005 amendment): a DOCX is a zip whose
 * `word/document.xml` walks to paragraphs in ~60 lines — no Python, no
 * markitdown. Provenance matches ADR 0006's format table exactly: DOCX has
 * no pagination, so paragraphs carry section (from Heading styles) and
 * nothing positional beyond the paragraph index itself.
 */

const PARAGRAPH_BLOCK = /<w:p\b[^>]*\/>|<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
const STYLE_ATTR = /<w:pStyle w:val="([^"]+)"/;
const HEADING_STYLE = /^Heading([1-9])$/i;
const TEXT_RUN = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
const XML_ENTITY = /&#(\d+);|&(#x[0-9a-fA-F]+);|&(amp|lt|gt|quot|apos);/g;

export function parseDocx(bytes: Uint8Array): ParseResult {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    return { error: "malformed" };
  }

  const documentXml = files["word/document.xml"];
  if (!documentXml) {
    return { error: "malformed" };
  }
  const xml = new TextDecoder().decode(documentXml);

  const paragraphs: ParsedParagraph[] = [];
  let section: string | undefined;

  for (const match of xml.matchAll(PARAGRAPH_BLOCK)) {
    const block = match[1] ?? "";

    const styleMatch = block.match(STYLE_ATTR);
    const styleName = styleMatch?.[1] ?? "";
    const isHeading = HEADING_STYLE.test(styleName);

    let text = "";
    if (block.length > 0) {
      // <w:br/> is an in-paragraph line break; <w:tab/> is whitespace
      const normalized = block.replace(/<w:br\s*\/>/g, "\n").replace(/<w:tab\s*\/>/g, " ");
      for (const textMatch of normalized.matchAll(TEXT_RUN)) {
        text += decodeXmlEntities(textMatch[1] ?? "");
      }
    }
    text = text.trim();
    if (text.length === 0) continue;

    if (isHeading) {
      section = text;
      continue; // headings name sections; they are not content paragraphs
    }

    paragraphs.push({
      index: paragraphs.length + 1,
      text,
      section,
    });
  }

  return { pageCount: null, paragraphs };
}

function decodeXmlEntities(input: string): string {
  return input.replace(XML_ENTITY, (match, dec, hex, named) => {
    if (named) {
      return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[named as string] ?? match;
    }
    const code = dec ?? hex?.slice(1);
    return code ? String.fromCodePoint(Number(code)) : match;
  });
}

export type { ParsedDocument, ParsedParagraph };
