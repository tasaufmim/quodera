export type UploadKind = "digital_pdf" | "image" | "docx" | "txt" | "md";

/**
 * Magic-byte sniffing (SECURITY.md §5): the declared MIME type is IGNORED —
 * file signatures decide. All OOXML containers (docx/pptx/xlsx) share the
 * ZIP signature and are accepted under the `docx` kind — the parse stage
 * (Phase 3) tells them apart and refines the kind. The zip guard applies to
 * every one of them equally.
 *
 * TXT/MD have no signature; they are handled by the text guard, not here.
 */

const SIGS: Array<{ kind: UploadKind; match: (bytes: Uint8Array) => boolean }> = [
  { kind: "digital_pdf", match: (b) => ascii(b, 0, "%PDF-") },
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  { kind: "image", match: (b) => b[0] === 0x89 && ascii(b, 1, "PNG\r\n\x1a\n") },
  // JPEG: FF D8 FF
  { kind: "image", match: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  // WebP: "RIFF" .... "WEBP"
  {
    kind: "image",
    match: (b) => ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP"),
  },
  // OOXML containers (docx/pptx/xlsx): PK\x03\x04
  {
    kind: "docx",
    match: (b) => ascii(b, 0, "PK\x03\x04"),
  },
];

export interface SniffResult {
  kind: UploadKind;
}

export interface SniffRejection {
  reason: "unsupported-type";
}

export function sniff(bytes: Uint8Array): SniffResult | SniffRejection {
  if (bytes.length === 0) return { reason: "unsupported-type" };

  for (const sig of SIGS) {
    if (bytes.length >= 4 && sig.match(bytes)) {
      return { kind: sig.kind };
    }
  }

  // Not a recognized binary type. It may still be honest text (txt/md) — the
  // caller decides via the text guard; the sniff alone cannot know.
  return { reason: "unsupported-type" };
}

/**
 * A buffer is *possibly text* when it decodes as UTF-8 and is overwhelmingly
 * printable. Used only for kinds without signatures (txt/md): a file lying
 * about being text (e.g. an ELF renamed .txt) fails here.
 */
export function looksLikeText(bytes: Uint8Array): boolean {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    let suspicious = 0;
    for (const char of decoded) {
      const code = char.codePointAt(0)!;
      // allow tab/lf/cr; reject other C0/C1 controls
      if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127) {
        suspicious++;
      }
    }
    return suspicious / Math.max(1, decoded.length) < 0.01;
  } catch {
    return false;
  }
}

function ascii(bytes: Uint8Array, offset: number, expected: string): boolean {
  if (bytes.length < offset + expected.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if (bytes[offset + i] !== expected.charCodeAt(i)) return false;
  }
  return true;
}
