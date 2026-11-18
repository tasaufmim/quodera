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

## Postscript (2026-11-18 — re-litigated before implementation, confirmed)

Before Phase 3 the decision was deliberately reopened. OpenRouter now serves
embeddings (~$0.01/M tokens via `bge-m3`), which would collapse chat and
embeddings into one provider. The cost math is genuinely small — roughly
$0.04 per 1,000 guest documents — but paid-per-token breaks the **$0-forever
demo guarantee**, which is the product story. Confirmed specifics:

- Model: `gemini-embedding-001` at **768 dimensions** (Matryoshka truncation
  from 3072 — negligible quality loss at our scale, 4× less storage in what
  will be the largest table we ever have).
- Batched via `batchEmbedContents` (up to 100 chunks per call); backoff on
  429s.
- **One model for everyone.** Vector columns have a fixed dimension — running
  768-dim Gemini for free users and 1024-dim bge-m3 for BYO users would mean
  dual dimension columns or truncation hacks, for a benefit that is now zero:
  embeddings are free, so there is no cost for BYO to offload. BYO keys stay
  chat-only.
- Rate caps are measured empirically with the real key (provider-probe test,
  numbers to LEARNINGS) rather than trusted from documentation.
- Free-tier data terms: chunk text transits Google under the free tier's
  data-use policy — documented transparently in SECURITY.md §10 with the
  upgrade path, not hidden as an assumption.
