# ADR 0011: Retrieval v1 — hybrid RRF, honest degradation, and the citation-marker chat protocol

- **Status:** accepted
- **Date:** 2026-11-20

## Context

Phase 4 turns indexed chunks into cited answers. Four design questions had
to be settled before code: how the two retrieval legs fuse, whether a
rerank stage ships now, when the assistant refuses, and how citations ride
an SSE stream.

## Decision

1. **Hybrid search, RRF fusion.** Both legs run per query inside `withUser`:
   tsvector (`plainto_tsquery` + `ts_rank`) for exact terms — clause numbers,
   defined terms, names, where dense vectors are weakest — and pgvector
   cosine for semantics. Each leg returns `fetchK=30` candidates; reciprocal-
   rank fusion (`Σ 1/(60 + rank)`) merges them; the top `limit=8` chunks
   enter the prompt. RRF needs no score normalization between legs — the
   honest reason to prefer it over weighted sums.

2. **Rerank is deferred, with justification.** A cross-encoder or LLM rerank
   stage is deliberately NOT in v1: it doubles per-question latency, drains
   the shared free-model pool (5 guest questions/day halves if every question
   reranks), or adds a paid provider — against the $0 guarantee. RRF over
   two strong legs is a solid baseline; **Phase 6's eval suite is the
   arbiter**: if citation-precision evals show fusion-only retrieval missing
   spans, the rerank stage is added with data, not vibes.

3. **Refusal v1: empty-result only.** If both legs return nothing, the
   assistant refuses ("the documents don't cover this"). Score thresholds
   are NOT invented now — weakly-relevant chunks reach the prompt, where the
   grounding contract makes the model say what it actually sees. Thresholds
   become eval-tunable numbers in Phase 6, not guesses in Phase 4.

4. **Honest degradation.** No `GEMINI_API_KEY` → the vector leg is skipped
   with a single logged warning per process; BM25 still serves queries.
   Retrieval degrades visibly, never silently.

5. **The chat protocol (for 4.2/4.3).** `POST /api/chat` responds with SSE:
   `token` events stream prose; the generation contract makes the model cite
   retrieved spans with `[n]` markers; a final `citations` event carries the
   verified citation objects (provenance from the chunk rows) after a
   **reference-validity verifier** — every marker must map to a chunk that
   was actually retrieved (no invented citations). Entailment grading (does
   the span support the sentence?) arrives with the Phase 6 eval suite;
   `quoteVerified` in v1 therefore means "points at a real retrieved span",
   stated plainly in the UI.

6. **Threads are server-side in v1.** The end-state remains local-first chat
   history with an opt-in sync toggle (ADR 0002, SECURITY §10), but the
   dual-store data layer is its own sub-phase; v1 threads live as tenant
   rows (they already have RLS) and the docs sequence the local-first mode
   explicitly rather than letting the promise rot silently.

## Consequences

- Queries are content: retrieval logs shapes (counts, latency, refused) —
  never query text (SECURITY §10 privacy posture).
- Search mechanics are fully testable with **synthetic 768-dim vectors** —
  ranking, fusion, tenant isolation, document scoping — no live API needed;
  the real embedding contract is covered by the provider probe.
- RRF fusion lives in application code, not SQL: simpler to test, and the
  per-leg queries stay plain, index-friendly statements.
- Deferring rerank is a visible, justified bet — revisit gate is Phase 6.

## Alternatives considered

| Alternative                       | Why not                                                                  |
| --------------------------------- | ------------------------------------------------------------------------ |
| Vector-only retrieval             | exact identifiers (clause numbers, names) are dense vectors' weak spot   |
| Weighted score fusion             | requires cross-leg score normalization — invented constants, fragile     |
| LLM rerank now                    | pool economics + latency; evals first, then optimize                     |
| Score-threshold refusal now       | thresholds without measurement are guesses; empty-only is honest v1      |
| Inline citation objects per token | the verifier needs the full answer; a final `citations` event is simpler |
