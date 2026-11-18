/**
 * Decompression/pixel guards (SECURITY.md §5, step 4): reject files that are
 * small on disk but huge when interpreted. Crucially these never decompress
 * or decode anything hostile — the zip walker reads only the central
 * directory's DECLARED sizes, and the image guards read only dimension
 * headers. Reading is safe; inflating is not.
 */

/** OOXML (docx/pptx/xlsx) limits: entry count and declared uncompressed total. */
export const ZIP_MAX_ENTRIES = 2000;
export const ZIP_MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;

/** Image pixel caps (decompression-bomb guard). WebP rides the file-size cap (documented). */
export const IMAGE_MAX_PIXELS = 40_000_000; // 40 MP

export type ZipGuardResult =
  | { ok: true; entries: number; declaredUncompressedBytes: number }
  | { ok: false; reason: "zip-structure" | "zip-bomb" };

/**
 * Walk the ZIP central directory WITHOUT decompressing anything and sum the
 * declared uncompressed sizes. A "small" file claiming gigabytes is either
 * corrupt or a bomb — both rejected.
 */
export function zipGuard(bytes: Uint8Array): ZipGuardResult {
  const eocd = findEocd(bytes);
  if (!eocd) return { ok: false, reason: "zip-structure" };

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entryCount = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);

  let offset = cdOffset;
  let totalUncompressed = 0;
  for (let i = 0; i < entryCount; i++) {
    // central directory file header: PK\x01\x02 + 42 more fixed bytes
    if (offset + 46 > bytes.length || !hasSignature(bytes, offset, "PK\x01\x02")) {
      return { ok: false, reason: "zip-structure" };
    }
    totalUncompressed += view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    offset += 46 + nameLength + extraLength + commentLength;
  }

  if (entryCount > ZIP_MAX_ENTRIES || totalUncompressed > ZIP_MAX_UNCOMPRESSED_BYTES) {
    return { ok: false, reason: "zip-bomb" };
  }
  return { ok: true, entries: entryCount, declaredUncompressedBytes: totalUncompressed };
}

/** End of central directory: scan backwards (it can carry a ≤64KB comment). */
function findEocd(bytes: Uint8Array): number | null {
  const minOffset = Math.max(0, bytes.length - 66_000);
  for (let i = bytes.length - 22; i >= minOffset; i--) {
    if (hasSignature(bytes, i, "PK\x05\x06")) return i;
  }
  return null;
}

export type ImageGuardResult = { ok: true } | { ok: false; reason: "image-bomb" };

/** PNG: IHDR carries width/height at fixed offsets. JPEG: scan SOFn markers. WebP: covered by the file-size cap. */
export function imageGuard(bytes: Uint8Array, sniffedKind: "image"): ImageGuardResult {
  if (sniffedKind !== "image") return { ok: true };

  // PNG
  if (bytes[0] === 0x89 && asciiAt(bytes, 1, "PNG")) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // IHDR chunk data starts at offset 16: 4-byte width, 4-byte height (big-endian)
    if (bytes.length >= 24) {
      const width = view.getUint32(16, false);
      const height = view.getUint32(20, false);
      if (width * height > IMAGE_MAX_PIXELS) return { ok: false, reason: "image-bomb" };
    }
    return { ok: true };
  }

  // JPEG — walk segments to the first SOFn (dimensions live there)
  let offset = 2; // after FF D8
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) return { ok: true }; // not a clean segment walk — size cap still applies
    const marker = bytes[offset + 1]!;
    const length = view.getUint16(offset + 2, false);

    // SOF0..SOF15 except DHT(0xc4), DAC(0xcc), RSTn, TEM
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (offset + 9 <= bytes.length) {
        const height = view.getUint16(offset + 5, false);
        const width = view.getUint16(offset + 7, false);
        if (width * height > IMAGE_MAX_PIXELS) return { ok: false, reason: "image-bomb" };
      }
      return { ok: true };
    }

    offset += 2 + length; // segment length includes its own 2 bytes
  }
  return { ok: true };
}

function hasSignature(bytes: Uint8Array, offset: number, expected: string): boolean {
  if (bytes.length < offset + expected.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if (bytes[offset + i] !== expected.charCodeAt(i)) return false;
  }
  return true;
}

function asciiAt(bytes: Uint8Array, offset: number, expected: string): boolean {
  return hasSignature(bytes, offset, expected);
}
