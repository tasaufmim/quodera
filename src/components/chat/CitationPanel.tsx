"use client";

import { citationLabel, type CitationRef } from "@/lib/citation";

/** The evidence panel: what was cited, where it lives, what it says. */
export function CitationPanel({ citation }: { citation: CitationRef }) {
  return (
    <aside className="w-full shrink-0 rounded-xl border border-line bg-surface p-5 lg:w-80">
      <h2 className="font-mono text-xs uppercase tracking-widest text-ink-muted">Source</h2>
      <p className="mt-2 text-sm font-medium">{citationLabel(citation)}</p>
      <dl className="mt-4 space-y-2 text-xs text-ink-muted">
        <div className="flex justify-between gap-4">
          <dt>Document</dt>
          <dd className="truncate text-ink">{citation.documentName}</dd>
        </div>
        {citation.page !== null ? (
          <div className="flex justify-between gap-4">
            <dt>Page</dt>
            <dd className="text-ink">{citation.page}</dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-4">
          <dt>Paragraph</dt>
          <dd className="text-ink">{citation.paragraphNo}</dd>
        </div>
        {citation.lineStart !== null && citation.lineEnd !== null ? (
          <div className="flex justify-between gap-4">
            <dt>Lines</dt>
            <dd className="text-ink">
              {citation.lineStart}–{citation.lineEnd}
            </dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-4">
          <dt>Reference</dt>
          <dd className={citation.quoteVerified ? "text-ink" : "text-ink-muted"}>
            {citation.quoteVerified ? "verified — points at retrieved evidence" : "unverified"}
          </dd>
        </div>
      </dl>
      <blockquote className="mt-4 max-h-72 overflow-y-auto rounded-lg border border-line bg-raised p-3 text-xs leading-relaxed text-ink">
        {citation.span}
      </blockquote>
    </aside>
  );
}
