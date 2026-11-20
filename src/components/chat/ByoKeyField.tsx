"use client";

import { useState } from "react";

/**
 * BYO OpenRouter key (ADR 0007): session-scoped by design — sessionStorage,
 * gone when the tab closes, sent ONLY as the x-openrouter-key header.
 * Never persisted server-side, never logged.
 */
const STORAGE_KEY = "quodera:openrouter-key";

export function ByoKeyField() {
  const [key, setKey] = useState<string>("");
  const [saved, setSaved] = useState(false);

  function save() {
    const trimmed = key.trim();
    if (trimmed) {
      sessionStorage.setItem(STORAGE_KEY, trimmed);
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="flex items-center gap-2 text-xs text-ink-muted">
      <span className="shrink-0">BYO key</span>
      <input
        type="password"
        placeholder="sk-or-…"
        value={key}
        onChange={(event) => setKey(event.target.value)}
        className="w-40 rounded border border-line bg-surface px-2 py-1 outline-none focus:border-primary"
      />
      <button
        type="button"
        onClick={save}
        className="shrink-0 rounded border border-line px-2 py-1 transition hover:border-primary"
      >
        {saved ? "Saved" : "Save"}
      </button>
    </div>
  );
}

export function storedByKeyKey(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(STORAGE_KEY);
}
