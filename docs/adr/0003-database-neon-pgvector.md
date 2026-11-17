# ADR 0003: Neon Postgres + pgvector; row-level tenancy, not database-per-user

- **Status:** accepted
- **Date:** 2026-11-17

## Context

The product needs relational data (users, documents, threads), vector search (embeddings), and full-text search (BM25-style exact matching for clause numbers and defined terms). The original sketch said "individual database" per user. Free-tier hosting, serverless functions, and the canary-first engineering plan (Phase 1.3) constrained the options.

## Decision

One **Neon** (Free) serverless Postgres with the **pgvector** extension. Vectors and tsvectors live in the same tables as their relational metadata. Per-user isolation is implemented as **row-level tenancy**: every tenant row carries `user_id`; Postgres RLS (with FORCE) enforces isolation at the database layer (ADR 0008). Hybrid search is one SQL engine — tsvector + pgvector in the same query, fused server-side.

## Consequences

- One database to migrate, back up, and reason about; RLS is defense-in-depth under the ORM.
- Neon's pooled connection string + `prepare:false` keeps the client compatible with transaction-mode pooling; autosuspend cold starts (~500 ms) are absorbed and surfaced by `/api/ready`.
- CI tests against the same image as production (`pgvector/pgvector:pg17`).
- HNSW indexes per table; vector dimension must match the embedding model exactly (ADR 0004) — changing models means re-embedding, a documented migration.

## Alternatives considered

| Alternative                              | Why not                                                                                                                      |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Literal database-per-user (SQLite files) | fights serverless hosting (connection pools, cold files), no shared pgvector/HNSW, operationally explosive at any user count |
| Supabase bundle                          | fast to assemble, but more platform lock-in and less of the stack is ours to learn                                           |
| Turso + sqlite-vec                       | pairs with local-first (not chosen, ADR 0002); weaker full-text/hybrid tooling                                               |
| Qdrant Cloud free                        | excellent filtering, but a second database to run, sync, and pay attention to                                                |
