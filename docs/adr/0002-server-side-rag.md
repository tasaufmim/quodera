# ADR 0002: Server-side RAG (with local-first conveniences)

- **Status:** accepted
- **Date:** 2026-11-17

## Context

The original product sketch wanted user data in browser storage (cookies/IndexedDB) with opt-in cloud sync. But retrieval has to run _somewhere_: if documents live only in IndexedDB, the server cannot chunk, embed, or search them. Three coherent architectures existed: in-browser RAG, server-side RAG, or a hybrid dual-mode.

## Decision

RAG runs **server-side**: documents are uploaded, parsed, chunked, embedded, and indexed under the uploading user's account (row-level tenancy, ADR 0003/0008). The local-first story is retained where it is honest: chat history and settings stay in IndexedDB by default with an opt-in cloud sync toggle; documents are encrypted at rest (envelope encryption, per-user keys) in Phase 2.

## Consequences

- Citations are robust and search quality is not bounded by what a browser can compute.
- Documents transit the server — mitigated by encryption at rest, TLS in transit, and RLS isolation; the privacy story is "encrypted and tenant-isolated," not "never leaves your device" (marketing must never claim the latter).
- Simpler v1: no WebAssembly OCR/embedding, no client-side vector search.
- A hybrid mode stays possible later (the interface boundaries were drawn to allow it), but it is not on the roadmap.

## Alternatives considered

| Alternative                                                         | Why not                                                                                                                                         |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| In-browser RAG (tesseract.js + transformers.js, client-side search) | genuinely private and $0 infra, but weak models, heavy pages, and the citation pipeline (line boxes, rerankers) is drastically worse in-browser |
| Hybrid dual-mode (local default, opt-in cloud index)                | best privacy story, ~2× the engineering; revisit post-portfolio if the product grows                                                            |
