import { describe, expect, it } from "vitest";
import { splitCitedContent, citationLabel, type CitationRef } from "./citation";

const ref = (marker: number): CitationRef => ({
  marker,
  documentId: "d",
  documentName: "lease.pdf",
  page: 3,
  section: null,
  paragraphNo: 2,
  lineStart: 5,
  lineEnd: 7,
  span: "The tenant shall pay rent.",
  quoteVerified: true,
});

describe("splitCitedContent", () => {
  it("splits text and markers, marking verified ones", () => {
    const segments = splitCitedContent("Rent is due [1] monthly [2].", new Map([[1, ref(1)]]));
    expect(segments).toEqual([
      { type: "text", text: "Rent is due " },
      { type: "marker", marker: 1, verified: true },
      { type: "text", text: " monthly " },
      { type: "marker", marker: 2, verified: false },
      { type: "text", text: "." },
    ]);
  });

  it("handles multi-digit and adjacent markers", () => {
    const segments = splitCitedContent("Both[10][11]apply.", new Map([[10, ref(10)]]));
    expect(segments).toEqual([
      { type: "text", text: "Both" },
      { type: "marker", marker: 10, verified: true },
      { type: "marker", marker: 11, verified: false },
      { type: "text", text: "apply." },
    ]);
  });

  it("returns plain text when no markers exist", () => {
    expect(splitCitedContent("No markers.", new Map())).toEqual([
      { type: "text", text: "No markers." },
    ]);
  });
});

describe("citationLabel", () => {
  it("renders full provenance", () => {
    expect(citationLabel(ref(1))).toBe("lease.pdf, p. 3, ¶ 2, l. 5–7");
  });

  it("degrades honestly when lines are absent (DOCX-like)", () => {
    expect(
      citationLabel({ ...ref(1), page: null, lineStart: null, lineEnd: null, section: "Terms" }),
    ).toBe("lease.pdf, ¶ 2");
  });
});
