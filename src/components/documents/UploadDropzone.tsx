"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

/**
 * The upload surface: a plain accessible file input (Playwright-friendly,
 * screen-reader-friendly) posting to /api/documents. Errors arrive as the
 * route's machine-readable codes; the mapping below keeps user copy honest.
 */
const ERROR_COPY: Record<string, (detail?: unknown) => string> = {
  "file-too-large": (detail) =>
    `File exceeds the size limit (${formatBytes((detail as { maxBytes?: number })?.maxBytes)}).`,
  "guest-document-limit": (detail) =>
    `Guest workspaces hold ${(detail as { limit?: number })?.limit ?? 2} documents. Sign up to keep more.`,
  "unsupported-type": () =>
    "Unsupported file type. PDF, images, text, and Office documents are allowed.",
  "zip-bomb": () => "This archive expands beyond safety limits — rejected.",
  "zip-structure": () => "This Office file is malformed — rejected.",
  "image-bomb": () => "Image dimensions exceed the allowed maximum.",
  "empty-file": () => "That file is empty.",
  rate_limited: () => "Too many uploads — try again later.",
  unauthorized: () => "Your session expired — sign in again.",
};

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.txt,.md,.docx,.pptx,.xlsx";

export function UploadDropzone({ isGuest }: { isGuest: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setPending(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("name", file.name);

      const response = await fetch("/api/documents", { method: "POST", body: form });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          [key: string]: unknown;
        };
        const copy = ERROR_COPY[body.error ?? ""];
        setError(copy ? copy(body) : "Upload failed — please try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setPending(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-6">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Add a document</h2>
        <span className="font-mono text-xs text-ink-muted">
          {isGuest ? "guest: 5 MB per file" : "20 MB per file"}
        </span>
      </div>

      <label
        htmlFor="document-upload"
        className="mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line px-6 py-10 text-center transition hover:border-primary"
      >
        <span className="text-sm font-medium">
          {pending ? "Uploading…" : "Choose a file or drop it here"}
        </span>
        <span className="text-xs text-ink-muted">
          PDF · images (PNG/JPEG/WebP) · TXT/MD · DOCX/PPTX/XLSX
        </span>
        <input
          ref={inputRef}
          id="document-upload"
          type="file"
          accept={ACCEPT}
          disabled={pending}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      </label>

      {error ? <p className="mt-3 text-sm text-ink-muted">{error}</p> : null}
    </div>
  );
}

function formatBytes(maxBytes?: number): string {
  if (!maxBytes) return "the limit";
  const mib = maxBytes / (1024 * 1024);
  return `${mib} MB`;
}
