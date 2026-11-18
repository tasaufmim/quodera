import { describe, expect, it } from "vitest";
import { ZIP_MAX_UNCOMPRESSED_BYTES } from "./guards";
import { UPLOAD_LIMITS, refineTextKind, validateUpload } from "./validate";

/**
 * Upload validation against CRAFTED hostile bytes (SECURITY.md §5) — pure
 * unit tests, no HTTP, no DB. Every guard here exists because someone has
 * abused exactly this shape in the wild.
 */

const encoder = new TextEncoder();

function minimalPdf(): Uint8Array {
  return encoder.encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF");
}

/** A valid-enough ZIP: local header + central directory + EOCD, with a DECLARED uncompressed size we control. */
function craftZip(declaredUncompressed: number, entries = 1): Uint8Array {
  const localHeader = [0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const name = encoder.encode("a.txt");
  const fileData = encoder.encode("hi");

  const central: number[] = [
    0x50,
    0x4b,
    0x01,
    0x02,
    20,
    0,
    20,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    // compressed size (LE) — small
    fileData.length,
    0,
    0,
    0,
    // declared UNCOMPRESSED size (LE) — the lie
    declaredUncompressed & 0xff,
    (declaredUncompressed >> 8) & 0xff,
    (declaredUncompressed >> 16) & 0xff,
    (declaredUncompressed >> 24) & 0xff,
    // name len, extra len, comment len
    name.length,
    0,
    0,
    0,
    0,
    0,
    // local header offset
    0,
    0,
    0,
    0,
  ];
  const eocd: number[] = [
    0x50,
    0x4b,
    0x05,
    0x06,
    0,
    0,
    0,
    0,
    // entries on this disk, total entries (LE)
    entries & 0xff,
    (entries >> 8) & 0xff,
    entries & 0xff,
    (entries >> 8) & 0xff,
    // central directory size (LE)
    central.length + name.length,
    0,
    0,
    0,
    // central directory offset (LE)
    localHeader.length + name.length + fileData.length,
    0,
    0,
    0,
    0,
    0,
  ];

  return new Uint8Array([...localHeader, ...name, ...fileData, ...central, ...name, ...eocd]);
}

/** PNG with a controlled IHDR canvas (big-endian width/height at offsets 16/20). */
function craftPng(width: number, height: number): Uint8Array {
  const header = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]; // PNG signature
  const ihdrLength = [0, 0, 0, 13];
  const ihdrType = encoder.encode("IHDR");
  const be = (value: number) => [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
  return new Uint8Array([
    ...header,
    ...ihdrLength,
    ...ihdrType,
    ...be(width),
    ...be(height),
    8,
    0,
    0,
    0, // bit depth, color type, compression, filter
    0,
    0,
    0,
    0, // CRC (unvalidated at this stage)
  ]);
}

/** JPEG with a controlled SOF0 frame (big-endian height/width after the marker). Segment lengths are kept self-consistent — the guard's segment walk depends on them. */
function craftJpeg(width: number, height: number): Uint8Array {
  const be = (value: number) => [(value >>> 8) & 0xff, value & 0xff];
  return new Uint8Array([
    0xff,
    0xd8, // SOI
    0xff,
    0xe0,
    0x00,
    0x04,
    0x4a,
    0x46, // APP0, length 4 (self-consistent)
    0xff,
    0xc0,
    0x00,
    0x0b,
    8, // SOF0: length 11, precision 8
    ...be(height),
    ...be(width),
    1,
    0x01,
    0x11,
    0, // components
    0xff,
    0xd9, // EOI
  ]);
}

describe("validateUpload", () => {
  it("accepts a PDF and reports kind, sha256, and a generated storage key", () => {
    const result = validateUpload(minimalPdf(), "registered");
    expect(result).toMatchObject({ kind: "digital_pdf", contentType: "application/pdf" });
    if ("sha256" in result) {
      expect(result.sha256).toHaveLength(64);
      expect(result.storageKey).toMatch(/^docs\/[0-9a-f-]{36}$/);
    }
  });

  it("accepts honest text (no signature, decodable, printable)", () => {
    const result = validateUpload(encoder.encode("# Chapter one\n\nHello world."), "registered");
    expect(result).toMatchObject({ kind: "txt", contentType: "text/plain" });
  });

  it("rejects a binary blob pretending to be text (declared type is ignored anyway)", () => {
    const elfLike = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00, 0, 0, 0]);
    const result = validateUpload(elfLike, "registered");
    expect(result).toEqual({ error: "unsupported-type" });
  });

  it("rejects files over the tier limit — guest cap is tighter than registered", () => {
    const big = new Uint8Array(UPLOAD_LIMITS.guest.maxBytes + 1);
    expect(validateUpload(big, "guest")).toEqual({
      error: "file-too-large",
      maxBytes: UPLOAD_LIMITS.guest.maxBytes,
    });
    const bigish = new Uint8Array(UPLOAD_LIMITS.guest.maxBytes + 1);
    expect(validateUpload(bigish, "guest")).toMatchObject({ error: "file-too-large" });
  });

  it("rejects a zip bomb by DECLARED size without ever decompressing it", () => {
    const bomb = craftZip(ZIP_MAX_UNCOMPRESSED_BYTES + 1);
    expect(bomb.length).toBeLessThan(200); // the whole point: tiny file, huge claim
    const result = validateUpload(bomb, "registered");
    expect(result).toEqual({ error: "zip-bomb" });
  });

  it("accepts a well-behaved OOXML container", () => {
    const result = validateUpload(craftZip(1024), "registered");
    expect(result).toMatchObject({ kind: "docx" });
  });

  it("rejects a PNG declaring a 40MP+ canvas (decompression bomb)", () => {
    const bomb = craftPng(20_000, 20_000); // 400 MP
    expect(validateUpload(bomb, "registered")).toEqual({ error: "image-bomb" });
  });

  it("rejects a JPEG with an SOF0 frame declaring absurd dimensions", () => {
    const bomb = craftJpeg(10_000, 10_000); // 100 MP
    expect(validateUpload(bomb, "registered")).toEqual({ error: "image-bomb" });
  });

  it("accepts sane images", () => {
    expect(validateUpload(craftPng(1920, 1080), "registered")).toMatchObject({ kind: "image" });
    expect(validateUpload(craftJpeg(1920, 1080), "registered")).toMatchObject({ kind: "image" });
  });

  it("refines txt to md by original filename extension", () => {
    expect(refineTextKind("txt", "notes.MD")).toBe("md");
    expect(refineTextKind("txt", "notes.txt")).toBe("txt");
    expect(refineTextKind("txt", "noext")).toBe("txt");
  });
});
