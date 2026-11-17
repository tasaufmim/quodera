# ADR 0006: The citation schema — one object, per-format guarantees

- **Status:** accepted
- **Date:** 2026-11-17

## Context

The killer feature: every generated sentence must reference its evidence at document/page/paragraph/line granularity. Different source formats have fundamentally different structure (a DOCX has no pages; a scanned image has no headings), so a single rigid citation shape would either lie (fabricated page numbers) or be too vague to be impressive.

## Decision

One citation object (see ARCHITECTURE §3) with **optional** positional fields and a **mandatory span quote**: `{documentId, documentName, page?, section?, paragraph, lineStart?, lineEnd?, span, quoteVerified}`. Each parser declares which fields it guarantees; the UI degrades gracefully (`¶ 4` when there is no page); a post-generation verifier checks each cited span actually entails its sentence and flags `quoteVerified: false` rather than silently shipping a bad citation.

## Consequences

- Honesty by construction: fields exist only when the source format genuinely provides them.
- The `span` quote makes citations verifiable _without_ opening the viewer, and powers the entailment check.
- Tables are cited at table+page granularity in v1 (cell-level spans are a documented post-v1 refinement).
- Eval suites (Phase 6) score citation precision directly: does the cited span support the sentence?

## Alternatives considered

| Alternative                                             | Why not                                                                                            |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Page+paragraph only                                     | DOCX/MD would fabricate or drop citations; line-level is the differentiator on legal/academic docs |
| Footnote-style end-of-answer sources                    | exactly the vague "relevant links" pattern the product exists to kill                              |
| Sentence-level embeddings to auto-align quotes post-hoc | retrofitting provenance is fragile; minting it at ingest (ADR 0005) is deterministic               |
