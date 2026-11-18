import { describe, expect, it } from "vitest";
import { buildChunks, CHUNK_RULES } from "./chunk";
import type { ParsedParagraph } from "./provenance";

/**
 * The chunker is the citation feature's assembly line — every rule here
 * exists so a citation can name exactly one page, one section, one span.
 */

function para(overrides: Partial<ParsedParagraph> & { text: string }): ParsedParagraph {
  return { index: overrides.index ?? 1, ...overrides };
}

describe("buildChunks", () => {
  it("keeps well-sized paragraphs as their own chunks, provenance intact", () => {
    const chunks = buildChunks([
      para({ index: 1, text: "A".repeat(300), page: 1, lineStart: 1, lineEnd: 4, section: "S1" }),
      para({ index: 2, text: "B".repeat(300), page: 1, lineStart: 5, lineEnd: 8, section: "S1" }),
    ]);

    expect(chunks).toEqual([
      {
        content: "A".repeat(300),
        page: 1,
        paragraphNo: 1,
        lineStart: 1,
        lineEnd: 4,
        section: "S1",
      },
      {
        content: "B".repeat(300),
        page: 1,
        paragraphNo: 2,
        lineStart: 5,
        lineEnd: 8,
        section: "S1",
      },
    ]);
  });

  it("merges tiny neighbors up to the target — span extends, paragraph points at the start", () => {
    // real parsers propagate the section to every paragraph until a new
    // heading — so these three share "S"
    const chunks = buildChunks([
      para({ index: 1, text: "Tiny one.", page: 3, lineStart: 1, lineEnd: 1, section: "S" }),
      para({ index: 2, text: "Tiny two.", page: 3, lineStart: 2, lineEnd: 2, section: "S" }),
      para({ index: 3, text: "C".repeat(500), page: 3, lineStart: 3, lineEnd: 9, section: "S" }),
    ]);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({
      content: `Tiny one. Tiny two. ${"C".repeat(500)}`,
      page: 3,
      paragraphNo: 1,
      lineStart: 1,
      lineEnd: 9,
      section: "S",
    });
  });

  it("never merges across a section boundary", () => {
    const chunks = buildChunks([
      para({ index: 1, text: "Tiny in section one.", section: "One" }),
      para({ index: 2, text: "Tiny in section two.", section: "Two" }),
    ]);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.section).toBe("One");
    expect(chunks[1]!.section).toBe("Two");
  });

  it("never merges across a page boundary (PDFs)", () => {
    const chunks = buildChunks([
      para({ index: 1, text: "Tiny on page one.", page: 1, lineStart: 1, lineEnd: 1 }),
      para({ index: 2, text: "Tiny on page two.", page: 2, lineStart: 1, lineEnd: 1 }),
    ]);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.page).toBe(1);
    expect(chunks[1]!.page).toBe(2);
  });

  it("splits an oversize paragraph at sentence boundaries with exact line ranges", () => {
    // one sentence per line, each line ENDING with its period: pieces then
    // tile whole lines, and every piece ends at a sentence boundary
    const sentences = Array.from({ length: 5 }, (_, i) => `${"x".repeat(240)} Sentence ${i}.`);
    const text = sentences.join("\n");
    expect(text.length).toBeGreaterThan(CHUNK_RULES.maxChars);

    const chunks = buildChunks([
      para({ index: 7, text, page: 2, lineStart: 10, lineEnd: 14, section: "Big" }),
    ]);

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(CHUNK_RULES.maxChars);
      expect(chunk.paragraphNo).toBe(7);
      expect(chunk.page).toBe(2);
      expect(chunk.section).toBe("Big");
      expect(chunk.content.endsWith(".")).toBe(true); // never mid-sentence
    }
    // exact line coverage: pieces tile the paragraph's lines, no gaps
    expect(chunks[0]!.lineStart).toBe(10);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.lineStart).toBe(chunks[i - 1]!.lineEnd! + 1);
    }
    expect(chunks[chunks.length - 1]!.lineEnd).toBe(14);
  });

  it("splits a single-line oversize paragraph honestly — pieces share the line", () => {
    const sentences = Array.from({ length: 6 }, (_, i) => `${"x".repeat(240)} S${i}.`);
    const text = sentences.join(" ");
    expect(text.length).toBeGreaterThan(CHUNK_RULES.maxChars);

    const chunks = buildChunks([para({ index: 3, text, page: 1, lineStart: 5, lineEnd: 5 })]);

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const chunk of chunks) {
      // a piece without newlines is one line — we never invent precision
      expect(chunk.lineStart).toBe(5);
      expect(chunk.lineEnd).toBe(5);
    }
  });
});
