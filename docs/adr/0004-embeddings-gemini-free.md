# ADR 0004: Gemini free tier for embeddings

- **Status:** accepted
- **Date:** 2026-11-17

## Context

Embeddings are needed at ingest (chunks) and at query time (questions). OpenRouter (our chat provider) does serve embeddings, but they are **paid per token** (~$0.004–0.02/M) — the shared free key cannot safely cover them, and "free demo + paid embeddings" would burn money on every anonymous user. The candidate free paths: Google's Gemini embedding API free tier, in-browser embeddings (transformers.js), or BYO-only embeddings.

## Decision

Embeddings run **server-side via the Gemini embedding API free tier**, behind a thin `EmbeddingProvider` interface. Dimensions are pinned to the chosen model's output (recorded in the schema where vector columns are defined — the canary documents the pattern with dimension 8 purely as a fixture).

## Consequences

- $0 embedding cost; one provider key (`GEMINI_API_KEY`, server-only); works identically for demo and BYO users.
- Free-tier rate limits apply — ingest is batched (embedding many chunks per request) and queued; limits verified empirically in Phase 3 and documented in docs/LEARNINGS.md.
- Model changes require re-embedding all chunks: a documented, scripted migration (never a silent dimension mismatch).
- The interface keeps the door open to swapping providers (e.g., bge-m3 via a BYO OpenRouter key) without touching the pipeline.

## Alternatives considered

| Alternative                        | Why not                                                                                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenRouter embeddings for everyone | paid per token; the demo pool must be free forever                                                                                            |
| Transformers.js in-browser         | pairs with in-browser RAG (ADR 0002 chose server-side); adds ~seconds of client compute per document and a second embedding stack to maintain |
| BYO-key-only embeddings            | demo reviewers without keys get no retrieval — dead demo                                                                                      |
