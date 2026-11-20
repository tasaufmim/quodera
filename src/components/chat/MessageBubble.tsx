"use client";

import { citationLabel, splitCitedContent, type CitationRef } from "@/lib/citation";

/**
 * One chat message: text with [n] markers rendered as superscript buttons.
 * Verified markers are clickable and open the citation panel; unverified
 * ones render dimmed (the model's noise — the verifier already rejected it).
 */
export function MessageBubble({
  role,
  content,
  citations,
  streaming = false,
  uncited = false,
  onCitation,
}: {
  role: "user" | "assistant";
  content: string;
  citations: Map<number, CitationRef>;
  streaming?: boolean;
  uncited?: boolean;
  onCitation?: (citation: CitationRef) => void;
}) {
  const segments = splitCitedContent(content, citations);

  return (
    <div className={`flex ${role === "user" ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-xl border px-4 py-3 text-sm leading-relaxed ${
          role === "user" ? "border-primary/40 bg-raised" : "border-line bg-surface"
        } ${streaming ? "italic" : ""}`}
      >
        <p className="whitespace-pre-wrap">
          {segments.map((segment, index) =>
            segment.type === "text" ? (
              <span key={index}>{segment.text}</span>
            ) : (
              <button
                key={index}
                type="button"
                disabled={!segment.verified}
                onClick={() => {
                  const citation = citations.get(segment.marker);
                  if (citation) onCitation?.(citation);
                }}
                className={`mx-0.5 align-super text-xs ${
                  segment.verified ? "font-bold text-primary hover:underline" : "text-ink-muted/50"
                }`}
                title={segment.verified ? "View source" : "Unverified reference"}
              >
                [{segment.marker}]
              </button>
            ),
          )}
        </p>
        {uncited ? (
          <p className="mt-2 rounded bg-raised px-2 py-1 text-xs text-ink-muted">
            ⚠ This answer carries no verifiable references.
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function citationPanelTitle(citation: CitationRef): string {
  return citationLabel(citation);
}
