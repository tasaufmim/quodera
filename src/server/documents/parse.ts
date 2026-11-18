import type { documentKind } from "@/server/db/schema";
import { parseDocx } from "./parse-docx";
import { parsePdf } from "./parse-pdf";
import { parseText } from "./parse-text";
import type { ParseResult } from "./provenance";

type DocumentKindValue = (typeof documentKind.enumValues)[number];

/**
 * The parse dispatcher: routes raw bytes to the right parser by document
 * kind. Phase 3 owns text-layer formats; images and scanned documents
 * answer honestly with `ocr-not-available` until the Phase 5 worker ships.
 */
export async function parseDocument(
  bytes: Uint8Array,
  kind: DocumentKindValue,
): Promise<ParseResult> {
  switch (kind) {
    case "digital_pdf":
      return parsePdf(bytes);
    case "docx":
      return parseDocx(bytes);
    case "txt":
      return parseText(decodeUtf8(bytes), "txt");
    case "md":
      return parseText(decodeUtf8(bytes), "md");
    case "image":
    case "scanned_pdf":
      return { error: "ocr-not-available" };
  }
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
