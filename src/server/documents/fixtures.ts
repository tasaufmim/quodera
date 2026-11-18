import { zipSync } from "fflate";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/**
 * Test fixture builders — documents with KNOWN text at KNOWN positions, so
 * provenance assertions are exact rather than vibes. pdf-lib generates
 * real PDFs; fflate builds real DOCX zips containing only what our parser
 * reads (word/document.xml — the walker does not care about the rest).
 */

const encoder = new TextEncoder();

export interface PdfLine {
  text: string;
  /** Y position (points, from bottom). Defaults stagger each line downward. */
  y?: number;
  size?: number;
  bold?: boolean;
}

export async function buildTestPdf(pages: PdfLine[][]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);

  pages.forEach((lines) => {
    const page = pdf.addPage([612, 792]);
    let y = 700;
    for (const line of lines) {
      const size = line.size ?? 12;
      page.drawText(line.text, {
        x: 72,
        y: line.y ?? y,
        size,
        font: line.bold ? boldFont : regular,
        color: rgb(0, 0, 0),
      });
      y = (line.y ?? y) - 15 - size;
    }
  });

  return new Uint8Array(await pdf.save());
}

export interface DocxParagraph {
  text: string;
  heading?: number;
}

export function buildTestDocx(paragraphs: DocxParagraph[]): Uint8Array {
  const body = paragraphs
    .map((paragraph) => {
      const style = paragraph.heading
        ? `<w:pPr><w:pStyle w:val="Heading${paragraph.heading}"/></w:pPr>`
        : "";
      return `<w:p>${style}<w:r><w:t>${escapeXml(paragraph.text)}</w:t></w:r></w:p>`;
    })
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}</w:body>
</w:document>`;

  return zipSync({ "word/document.xml": encoder.encode(xml) });
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
