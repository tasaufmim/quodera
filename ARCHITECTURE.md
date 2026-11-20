# Architecture

Status: **Phase 1 complete** (foundation). Sections marked 📍 are designed and decided (see docs/adr/) but not yet built; their phase is noted.

## 1. System context

One Next.js application (App Router) deployed on Vercel, one Postgres (Neon, pgvector) for all relational + vector data, Cloudflare R2 for raw uploads 📍, a Python OCR worker on Render 📍, and external AI providers via a server-only proxy.

```mermaid
flowchart LR
  subgraph client[Browser]
    UI[App Router UI<br/>landing · dashboard · viewer]
    LS[(IndexedDB<br/>chat history, settings)]
  end

  subgraph edge[Vercel edge]
    MW[middleware<br/>security headers · CSP]
  end

  subgraph node[Vercel node runtime]
    API[route handlers<br/>withApi: request-id · logging · errors]
    RL[rate limiter<br/>memory → Upstash]
    PROXY[LLM/embedding proxy<br/>server-only keys · quotas]
    RAG[retrieval pipeline]
  end

  subgraph data[Data plane]
    PG[(Neon Postgres<br/>pgvector · tsvector · RLS)]
    R2[(Cloudflare R2<br/>raw documents)]
    WKR[Render worker<br/>docTR OCR · markitdown]
  end

  EXT[OpenRouter ·<br/>Gemini embeddings]

  UI --> MW --> API
  API --> RL
  API <--> PG
  API --> R2
  API --> WKR
  PROXY --> EXT
```

## 2. The answer pipeline (ingest shipped in Phase 3; retrieval/chat 📍 Phase 4; OCR 📍 Phase 5)

The core loop: upload → provenance-stamped chunks → hybrid retrieval → cited, verified answers.

```mermaid
sequenceDiagram
  participant U as User
  participant API as Quodera API
  participant PG as Neon Postgres
  participant E as Gemini embeddings
  participant L as LLM (OpenRouter proxy)

  U->>API: upload document
  API->>API: validate (magic bytes, size, MIME allowlist)
  API->>API: store raw bytes (R2 / dev store) + document rows
  Note over API: after() — async, post-response
  API->>API: parse (Node: pdfjs-dist coords / DOCX walker / text split)
  alt text layer present
    API->>API: provenance tree (page/¶/line spans)
    API->>API: paragraph-level chunking (spans carried)
    API->>E: embed chunks (batchEmbedContents, 100/call)
    API->>PG: atomic insert: all chunks + vectors + tsvector, else failed
  else scanned / no text layer
    API->>PG: status failed — OCR arrives with the Phase 5 worker
  end

  U->>API: ask question
  API->>API: rewrite query w/ thread context
  API->>PG: hybrid search (tsvector + pgvector) → top-k
  API->>API: rerank (cross-encoder / LLM rerank)
  API->>L: generate w/ citation contract (SSE stream)
  API->>API: verify each claim is entailed by its cited span
  API->>U: streamed answer + citation objects
```

Key decisions baked into this pipeline:

- **Parsing runs in Node, not a worker** (ADR 0005 amendment): text-layer PDF extraction via pdfjs-dist parses content streams — fast even for hundreds of pages — and DOCX is a zip with walkable XML. The Python worker's mandate narrows to layout-aware OCR for pixel formats, Phase 5. No parser ever exists twice.
- **OCR is chosen for citation quality, not just text extraction.** docTR/PaddleOCR return line and paragraph bounding boxes — those boxes are _where page/paragraph/line citations come from_ (ADR 0005).
- **Chunking happens with the provenance tree in hand.** A chunk is worthless to this product unless it carries `{page, paragraph, lineRange, span}` minted at ingest time — retrofitting citations after retrieval is how everyone else does it, and it's why their citations are vague.
- **The model never sees whole documents or images.** Retrieval selects top-k chunk texts; that is the token-saving strategy (not "OCR to shrink tokens" — OCR is what makes images searchable at all).
- **Tables** are extracted as markdown rows and cited at table+page granularity in v1; cell-level spans are a post-v1 refinement (ADR 0006).

## 3. Citation schema 📍 (ADR 0006)

Every generated sentence must reference its evidence:

```ts
interface Citation {
  documentId: string; // document uuid (RLS-scoped)
  documentName: string; // for display
  page?: number; // PDFs & OCR'd docs (docx/html have no pages)
  section?: string; // nearest heading, when the parser found one
  paragraph: number; // always present
  lineStart?: number; // OCR'd/positional sources
  lineEnd?: number;
  span: string; // the exact source text supporting the claim
  quoteVerified: boolean; // set by the post-generation verifier
}
```

Per-format guarantees (enforced by the parser contract, tested in evals):

| Source format             | page               | paragraph       | lines          | section                |
| ------------------------- | ------------------ | --------------- | -------------- | ---------------------- |
| Digital PDF               | ✅ pdf.js coords   | ✅              | ✅ (derived)   | ✅ (nearest heading)   |
| Scanned PDF / image (OCR) | ✅ docTR page      | ✅ box grouping | ✅ box indices | ⚠️ heuristik           |
| DOCX / PPTX / HTML        | ❌ (no pagination) | ✅              | ❌             | ✅                     |
| TXT / MD                  | ❌                 | ✅              | ✅             | ✅ (markdown headings) |

The UI degrades gracefully: a citation without page numbers renders `¶ 4` instead of `p. 3, ¶ 4, l. 5–7`. Clicking any citation opens the source viewer (pdf.js) and highlights the span.

## 4. Tenancy model (shipped in Phase 1)

One database, one schema; every tenant-owned row carries `user_id`, and **Postgres RLS is the enforcement layer** — not just the ORM (ADR 0008).

```
-- per transaction:
SELECT set_config('app.user_id', $userId, true);   -- dies with the tx
-- policy (migrations/hardening/0003 + 0004 + 0005):
USING      ((user_id = nullif(current_setting('app.user_id', true), '')::uuid)
            OR current_user = 'quodera_system')
WITH CHECK ((user_id = nullif(current_setting('app.user_id', true), '')::uuid)
            OR current_user = 'quodera_system')
```

The `OR current_user = 'quodera_system'` arm is the sanctioned cross-tenant
operator (ADR 0010) — role membership is the one credential a session cannot
fake, and the role is unprivileged in every other way.

- `ENABLE` + `FORCE ROW LEVEL SECURITY` — FORCE because the app connects as the table owner (Neon branch owner), and owners bypass RLS unless forced. `rls.test.ts` proves the owner sees zero rows without context.
- Default-deny: `current_setting(..., true)` returns NULL when unset; `user_id = NULL` filters everything. No tenant context → no rows. Ever.
- `withUser(userId, fn)` (src/server/db/rls.ts) is the only sanctioned entry point — it opens the transaction and sets the context atomically.
- Belt and braces: RLS sits _under_ the application layer. A future bug in query building still cannot cross tenants, because the database itself refuses.
- **Two roles, two powers** (learned the hard way — see ADR 0008 postscript): the app connects as the unprivileged `quodera_app` role (`DATABASE_URL`); migrations and fixtures use the admin role (`DATABASE_ADMIN_URL`). Superusers bypass RLS categorically, so the runtime role must never be one — the tenancy tests connect as the runtime role and would catch a regression to a privileged connection.
- **Three connections, three powers** (ADR 0010): runtime (`quodera_app` — tenant access only), admin (migrations/fixtures), and system (`quodera_system` — sanctioned cross-tenant reassignment: the guest→registered carry-over). Each is a distinct role with distinct grants; none can do another's job.
- Guests are ordinary tenants (ADR 0009): a guest is a `users` row flagged `isAnonymous`, nothing more. No RLS carve-out exists anywhere in the system — a deliberate selection criterion for the guest design.

## 5. Access model (shipped in Phase 2.1–2.6 — ADR 0009)

| State                                | Can do                                                                       | Cannot do                                          |
| ------------------------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------- |
| anonymous                            | marketing pages, status endpoints                                            | anything in `(app)`                                |
| guest (one click, no PII, no signup) | capped workspace: 2 docs (≤10 pages, ≤5 MB each), chat 5 msgs/day, citations | cloud sync, BYO persistence, caps above guest tier |
| registered                           | full workspace, sync toggle, BYO key                                         | —                                                  |

Transitions: **"Try as guest"** mints a ghost `users` row (`isAnonymous`) plus a standard session — creation is IP-capped (3/day per IP), and guest sessions carry a hard 24h TTL (create-time clamp; the refresh window is never reached first). Registering creates the registered user and retires the ghost — the `onLinkAccount` hook receives both and is where trial data is carried over (ADR 0009 postscript). Guest data is purged ≤48h by a daily Vercel cron (`/api/cron/purge-guests`, `CRON_SECRET`-guarded, admin connection) with a lazy sweep on guest creation as backstop.

Enforcement is server-side in every handler (a three-state session check), never UI-only. Guests get no special tenancy treatment — `withUser()` and RLS behave identically for them.

## 6. Data model (tenant tables shipped 2.4; `chunks` shipped 3.2; `citations` 📍 Phase 4)

**System tables vs tenant tables.** better-auth's identity tables (`user`, `session`, `account`, `verification` — Phase 2.1) are **system tables**: they carry no user-scoped RLS, because session resolution looks up by token _before any tenant context exists_ — chicken-and-egg with `withUser`. They are written only by better-auth's parameterized queries on the runtime role. Everything downstream of a `user_id` FK is **tenant data** and follows the canary pattern (GUARDRAILS #2) — `documents`, `document_versions`, `threads`, `messages`, `api_usage` are live, each registered in the generic tenancy suite; `audit_events` is additionally **append-only by grant** (the runtime role's UPDATE/DELETE are revoked — repudiation defense). Deletion cascades ride on FK constraints, which is what the guest purge leans on; the upgrade carry-over (ADR 0010) reassigns ownership on the system connection, preserving ids and FKs.

```mermaid
erDiagram
  user ||--o{ documents : owns
  user ||--o{ threads : owns
  documents ||--o{ document_versions : has
  document_versions ||--o{ chunks : contains
  chunks ||--o{ citations : cited-by
  threads ||--o{ messages : contains
  messages ||--o{ citations : carries
  user ||--o{ api_usage : accrues
  user ||--o{ audit_events : triggers

  documents {
    uuid id PK
    uuid user_id FK
    string name
    string status "queued|parsing|ready|failed"
    string kind "digital_pdf|scanned|image|docx|md|txt"
    timestamp created_at
  }
  document_versions {
    uuid id PK
    uuid document_id FK
    string storage_key "R2 object key"
    string sha256
    int version_no
  }
  chunks {
    uuid id PK
    uuid version_id FK
    int page
    string section
    int paragraph_no
    int line_start
    int line_end
    text content
    vector embedding "pgvector, dim = embedding model output"
    tsvector search "generated column"
  }
  citations {
    uuid id PK
    uuid chunk_id FK
    uuid message_id FK
    text span
    bool verified
  }
```

Every table above copies the canary pattern: `user_id NOT NULL` + RLS + FORCE + policies + tenancy tests (GUARDRAILS #2).

## 7. Retrieval (hybrid shipped in Phase 4.1 — ADR 0011)

- **Hybrid first, always.** Dense vectors are weak on exact identifiers (clause numbers, defined terms, names — the bread and butter of legal docs). Every query runs tsvector (OR-joined terms, `ts_rank`) and pgvector (cosine, HNSW) together inside `withUser`; legs are fused by RRF (`Σ 1/(60 + rank)`), top 8 chunks enter the prompt. No cross-leg score normalization — the honest reason RRF beats weighted sums.
- **Rerank is deferred, with justification** (ADR 0011): it doubles latency, drains the shared free-model pool, or adds a paid provider. RRF over two strong legs is the baseline; **Phase 6's evals arbitrate** — if citation-precision measurements show fusion missing spans, the rerank stage earns its place with data.
- **Refusal v1 is empty-only:** both legs return nothing → "the documents don't cover this." Score thresholds are eval-tunable numbers for Phase 6, not guesses shipped in Phase 4.
- **Honest degradation:** without `GEMINI_API_KEY` the vector leg skips (one logged warning per process) and BM25 keeps serving — `bm25Only` in every result makes the degradation visible to callers.
- **Conversational rewriting** (follow-ups like "what about page 3?") arrives with the chat orchestration (4.2/4.3), which owns the thread history the rewrite needs.
- Queries are content: retrieval logs shapes (counts, latency, refused) — never query text (SECURITY §10).

## 8. Rate limiting

Two layers, one HTTP contract (src/server/rate-limit/):

| Layer                                                             | Driver                   | Scope                                                                           | Phase |
| ----------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------- | ----- |
| Limiter interface + 429 contract (`retry-after`, `x-ratelimit-*`) | —                        | all routes                                                                      | ✅ 1  |
| Per-instance sliding window                                       | in-memory                | demo-limited (dev/test)                                                         | ✅ 1  |
| Driver resolution (`getLimiter()`)                                | Upstash ⇄ memory         | —                                                                               | ✅ 2  |
| Auth-route abuse guard                                            | Upstash (memory in dev)  | /api/auth sign-in/verify/callback — 10/h per IP                                 | ✅ 2  |
| Guest-session creation cap                                        | Upstash (memory in dev)  | 3/day per IP (ADR 0009) — rule live, endpoint arrives with the anonymous plugin | 2.3   |
| Global per-user quotas (incl. guest tiers)                        | Upstash                  | all public routes                                                               | 2     |
| LLM spend caps (demo pool 5 msgs/day, BYO unlimited)              | proxy counters + Upstash | /api/chat                                                                       | 4     |

`getLimiter()` (src/server/rate-limit/limiter.ts) resolves Upstash when `UPSTASH_REDIS_REST_URL/TOKEN` are set and falls back to per-instance memory otherwise — with ONE loud production error, never silence. Quotas live in exactly one module, `rate-limit/policy.ts`; routes compose `withRateLimit(route, POLICY.x, handler)` inside `withApi`, so a driver swap cannot change the HTTP surface (pinned by headers.test.ts and e2e). Guest quotas (ADR 0009): chat 5 msgs/day, uploads 2 documents (≤10 pages, ≤5 MB) with 3 uploads/hour.

## 9. Runtimes (a trap we've defused)

| Runtime                                  | Runs          | Can use                   | Cannot use                                     |
| ---------------------------------------- | ------------- | ------------------------- | ---------------------------------------------- |
| Edge (middleware)                        | every request | fetch, headers, WebCrypto | pino, postgres, AsyncLocalStorage, Node stdlib |
| Node (route handlers, server components) | per request   | everything                | —                                              |

Request IDs therefore originate in `withApi` (Node), not middleware. The future edge-side limiter must be Upstash's fetch-based API — the abstraction already assumes this.

## 10. Observability

- **Structured logs** (pino): `requestId`, `route`, `status`, `durationMs` on every request; secrets redacted by path (tested in logger.test.ts).
- **Error tracking** (Sentry): initialized only when `SENTRY_DSN` is set — local dev and hermetic builds never depend on it. `onRequestError` + `global-error.tsx` cover both server and client.
- **Probes:** `/api/health` (liveness — zero dependencies), `/api/ready` (readiness — pings DB, 503 when degraded). BetterStack pings health hourly; deploy-smoke.yml asserts it after deploys.
- **Guest purge cron 📍 (Phase 2):** daily Vercel cron hits `/api/cron/purge-guests` (verified by `CRON_SECRET`, runs on the admin connection, cascade-deletes expired guest data R2 → chunks → documents → threads → audit).

## 11. Failure modes we design around

| Failure                               | Behavior                                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Neon autosuspend cold start (~500 ms) | pooler URL + `connect_timeout`; ready probe reports latency                                                     |
| Free OpenRouter daily pool exhausted  | 429 with clear copy + BYO-key upsell (Phase 4)                                                                  |
| OCR worker cold start (Render free)   | job queue with status polling; document shows `queued → parsing → ready` (Phase 5)                              |
| LLM hallucinated a citation           | post-generation verifier re-checks span entailment; unverified citations are flagged in UI (Phase 4)            |
| Prompt injection inside a document    | chunks are data, never instructions: system prompt isolation + output filtering (SECURITY.md §prompt-injection) |
| Region-local limiter drift            | contract tests + Upstash migration (Phase 2)                                                                    |
| Guest farming via VPN                 | IP-capped creation + TTL purge; residual risk accepted (ADR 0009)                                               |

## 12. Phasing

1. ✅ Foundation — scaffold, CI/CD, tenancy canary, observability, limiter contract
2. Auth (better-auth: OAuth + magic links + guest ghost accounts, ADR 0009), domain schema, Upstash quotas incl. guest tiers, hardened uploads with guest caps, three-state gating
3. ✅ Ingest: parsing, chunking w/ provenance, embeddings, indexing
4. Retrieval + cited generation + SSE + LLM proxy
5. OCR worker + scanned/image pipeline + tables
6. Evals in CI, security hardening, audit log
7. Ship: demo, landing copy, CV
