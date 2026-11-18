import { describe, expect, it } from "vitest";
import { buildTestDocx, buildTestPdf } from "./fixtures";
import { parseDocx } from "./parse-docx";
import { parsePdf } from "./parse-pdf";
import { parseText } from "./parse-text";
import { parseDocument } from "./parse";

/**
 * Exact-provenance assertions against generated documents with KNOWN text
 * at KNOWN positions — the foundation the Phase 6 eval suite builds on.
 * If a parser regresses a single line number, this suite catches it.
 */

const encoder = new TextEncoder();

describe("parsePdf", () => {
  it("extracts paragraphs with exact page/line provenance and section tracking", async () => {
    const pdf = await buildTestPdf([
      [
        { text: "Chapter One", size: 18, bold: true, y: 700 },
        { text: "First paragraph line one.", y: 660 },
        { text: "First paragraph line two.", y: 645 },
        { text: "Second paragraph.", y: 600 },
      ],
      [{ text: "Page two paragraph.", y: 700 }],
    ]);

    const result = await parsePdf(pdf);
    if (!("paragraphs" in result)) {
      throw new Error(`expected paragraphs, got ${JSON.stringify(result)}`);
    }

    expect(result.pageCount).toBe(2);
    expect(result.paragraphs).toEqual([
      {
        index: 1,
        page: 1,
        lineStart: 2,
        lineEnd: 3,
        section: "Chapter One",
        text: "First paragraph line one. First paragraph line two.",
      },
      {
        index: 2,
        page: 1,
        lineStart: 4,
        lineEnd: 4,
        section: "Chapter One",
        text: "Second paragraph.",
      },
      {
        index: 3,
        page: 2,
        lineStart: 1,
        lineEnd: 1,
        section: undefined,
        text: "Page two paragraph.",
      },
    ]);
  });

  it("rejects a page without a text layer (OCR pending, Phase 5)", async () => {
    // page 1 has text, page 2 is empty (a scanned insert)
    const pdf = await buildTestPdf([[{ text: "Only page one." }], []]);
    const result = await parsePdf(pdf);
    expect(result).toEqual({ error: "no-text-layer" });
  });
});

describe("parseDocx", () => {
  it("walks paragraphs with heading sections and entity decoding — no pages, no lines", () => {
    const docx = buildTestDocx([
      { text: "Lease Agreement", heading: 1 },
      { text: "Tom & Jerry <Parties>", heading: 2 },
      { text: "The tenant shall pay rent." },
      { text: "The landlord shall maintain the premises." },
    ]);

    const result = parseDocx(docx);
    if (!("paragraphs" in result)) {
      throw new Error(`expected paragraphs, got ${JSON.stringify(result)}`);
    }

    expect(result.pageCount).toBeNull();
    expect(result.paragraphs).toEqual([
      {
        index: 1,
        text: "The tenant shall pay rent.",
        section: "Tom & Jerry <Parties>",
      },
      {
        index: 2,
        text: "The landlord shall maintain the premises.",
        section: "Tom & Jerry <Parties>",
      },
    ]);
  });

  it("rejects bytes that are not a zip with word/document.xml", () => {
    const result = parseDocx(encoder.encode("PK\x03\x04 not really a zip"));
    expect(result).toEqual({ error: "malformed" });
  });
});

describe("parseText", () => {
  it("splits TXT on blank lines with exact file line numbers", () => {
    const raw = "Intro line one.\nIntro line two.\n\n\nSecond paragraph line one.\nSecond line.\n";
    const result = parseText(raw, "txt");
    if (!("paragraphs" in result)) {
      throw new Error("expected paragraphs");
    }

    expect(result.paragraphs).toEqual([
      {
        index: 1,
        text: "Intro line one.\nIntro line two.",
        lineStart: 1,
        lineEnd: 2,
        section: undefined,
      },
      {
        index: 2,
        text: "Second paragraph line one.\nSecond line.",
        lineStart: 5,
        lineEnd: 6,
        section: undefined,
      },
    ]);
  });

  it("treats MD headings as sections, not content", () => {
    const raw = "# Syllabus\n\nPhysics chapter.\n\n## Labs\n\nLab one description.";
    const result = parseText(raw, "md");
    if (!("paragraphs" in result)) {
      throw new Error("expected paragraphs");
    }

    expect(result.paragraphs).toEqual([
      { index: 1, text: "Physics chapter.", lineStart: 3, lineEnd: 3, section: "Syllabus" },
      { index: 2, text: "Lab one description.", lineStart: 7, lineEnd: 7, section: "Labs" },
    ]);
  });
});

describe("parseDocument dispatcher", () => {
  it("answers image formats honestly (OCR arrives in Phase 5)", async () => {
    const result = await parseDocument(new Uint8Array([0xff, 0xd8, 0xff]), "image");
    expect(result).toEqual({ error: "ocr-not-available" });
  });

  it("routes markdown through the text parser with global indices", async () => {
    const result = await parseDocument(encoder.encode("# H\n\nPara one.\n\nPara two."), "md");
    if (!("paragraphs" in result)) {
      throw new Error("expected paragraphs");
    }
    expect(result.paragraphs.map((p) => [p.index, p.section])).toEqual([
      [1, "H"],
      [2, "H"],
    ]);
  });
});
