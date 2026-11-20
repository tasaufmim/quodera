# Changelog

All notable changes to Quodera are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

### Added — Phase 4.1: hybrid retrieval (ADR 0011)

- **`hybridSearch`** — tsvector (OR-joined `to_tsquery`, `ts_rank`) + pgvector cosine per query, fused by reciprocal-rank fusion (`Σ 1/(60 + rank)`, no cross-leg normalization), top 8 chunks; every query runs inside `withUser` (RLS is the belt under the braces). Optional `documentIds` scoping for per-document chat.
- **Rerank deferred with justification** (ADR 0011): latency + demo-pool economics + $0; Phase 6's evals are the arbiter.
- **Refusal v1 is empty-only** — no invented score thresholds before measurement.
- **Honest degradation**: no `GEMINI_API_KEY` → BM25-only with one logged warning per process; `bm25Only` rides every result so callers see the mode they got.
- **Queries are content**: retrieval logs shapes (counts, latency, refused), never query text (SECURITY §10).
- 12 tests with **synthetic 768-dim vectors** (topic vectors put their mass on one dimension — cosine relevance is hand-controlled): ranking, RRF fusion math (both-leg chunks beat single-leg winners), tenant isolation, document scoping, refusal, BM25-only mode, provenance end-to-end. Two product bugs caught by these tests: `plainto_tsquery` AND-semantics refused valid partial matches (now OR-joined terms), and drizzle's array param binding broke `any()` casts (now per-id params).

## [0.3.0] — 2026-11-20

### Added — Phase 3.4: verification gate + release

- **Provider probe test** — the ADR 0004 postscript promise, made executable: with `GEMINI_API_KEY` set, every gate run MEASURES the live embedding contract (768 dims, finite values, distinct vectors for distinct texts, English + Bengali — the multilingual claim tested honestly) and logs round-trip latency for LEARNINGS. Without the key it skips with a visible explanation; the honest-degradation path is already fully covered.
- `pnpm verify:phase3` — the phase's definition of done: the full Phase 2 chain PLUS the provider probe leg. AGENTS' definition of done moves to it.

### Added — Phase 3.3: ingest orchestration (embeddings + status flow)

- **`ingestDocument`** — the full pipeline behind every upload: parse → guest ≤10-page gate (rejection with a reason, not truncation) → chunk → embedding availability + quota gates → **atomic index** (every chunk + the `ready` flip in ONE `withUser()` transaction — a document is fully indexed or carries a machine-readable reason, never half-parsed). Triggered via Next's `after()` (post-response); a tiny scheduler indirection keeps it testable outside a request scope.
- **Gemini embedding driver**: `batchEmbedContents` (≤100 inputs/call), 768 dims, backoff on 429/5xx honoring `Retry-After`, fail-fast on 4xx — unit-tested against a mocked fetch. Without `GEMINI_API_KEY`, documents fail honestly with `embedding-unavailable` (parsed fine, indexed never, reason stated). With the key, the integration suite proves the happy path: real vectors, `api_usage` metering (first writers: route `embedding`, provider `gemini`), `document.ingest` audit.
- **Document error codes** as a stable contract (`no-text-layer`, `too-many-pages`, `embedding-quota`, …) with honest dashboard copy for each.
- **Dashboard status flow**: queued → parsing → ready/failed rendered from RLS-scoped queries, `pageCount` in the meta line, red-chip failures with reasons, and a poll-refresh that only runs while documents are pending.
- **Embedding batch quotas** (one unit = one batch call): 5/day guests, 50/day registered — keyed per user through the existing limiter.
- **`serverExternalPackages: ["pdfjs-dist"]`** — pdfjs's worker is resolved by runtime dynamic import; bundling it into the server broke that ("Setting up fake worker failed" → every ingest `internal` in production, green in vitest). Keeping it external restores Node resolution; found by e2e, invisible to unit tests, now a LEARNINGS entry.

### Added — Phase 3.1/3.2: parsers with exact provenance + the chunks table

- **Digital-PDF parser** (pdfjs-dist, Node — ADR 0005 amendment): text items grouped by baseline into lines, lines into paragraphs by vertical-gap analysis, oversized lines become sections. Page/line provenance is asserted **exactly** against generated fixtures — a regression of one line number fails the suite.
- **DOCX parser**: a ~60-line zip+XML walker (fflate) — heading styles become sections, entities decoded, no invented fields (DOCX has no pages, per ADR 0006). **TXT/MD**: blank-line paragraphs, MD headings as sections, exact file line numbers.
- **Honest failures**: a textless page (scanned insert) marks the whole document `no-text-layer` — all-or-nothing, because a citation we cannot see is a lie. Images answer `ocr-not-available` until Phase 5.
- **Paragraph-level chunker**: one chunk = one paragraph (the citation identity); oversize paragraphs split at sentence boundaries with **exact line tiling** (pieces tile the paragraph's lines with no gaps — tested); tiny neighbors merge up to 800 chars but never across page or section boundaries; a single-line piece truthfully shares its one line.
- **`chunks` table**: 768-dim pgvector column (ADR 0004 postscript), provenance columns (`page`, `section`, `paragraph_no`, `line_start`, `line_end`), HNSW + generated tsvector/GIN via hardening SQL, full canary pattern, registered in the reusable tenancy suite (35 new adversarial assertions incl. forged-insert cases that are FK-valid).

### Added — Phase 3.0: ingest decisions (pre-build)
- **ADR 0004 postscript** — the embedding choice was re-litigated before implementation: OpenRouter embeddings were seriously considered (one provider, ~$0.01/M tokens) and rejected because paid-per-token breaks the $0-forever demo guarantee. Confirmed: `gemini-embedding-001` @ 768 dims (Matryoshka), batched, **one model for everyone** — BYO keys stay chat-only, so there are never two vector dimensions in one table. Rate caps get measured empirically with the real key, not trusted from docs.
- **ADR 0005 amendment** — parsing runs IN NODE (`pdfjs-dist` coordinates, a DOCX zip+XML walker), not in the Python worker. The worker's mandate narrows to layout-aware OCR (Phase 5); no parser ever exists twice.
- **SECURITY §10 (Privacy notes)** — the free-tier data-terms trade-off for embeddings is stated out loud, with upgrade paths; guest ephemerality and local-first chat history documented as policy, not implication.
- **ARCHITECTURE §2** — the pipeline diagram now reflects Node parsing via `after()` and the scanned-PDF honest-failure path.

## [0.2.0] — 2026-11-18

### Added — Phase 2.7: the verification gate

- `pnpm verify:phase2` — Phase 2's definition of done as code: the full Phase 1 gate (typecheck · lint · unit · tenancy · build, optional HTTP smoke) PLUS the e2e suite, including the guest journey (one click → workspace → upload → document listed) against the production build.

### Added — Phase 2.6: three-state gating + the human surface

- **Sign-in page** (`/sign-in`): one passwordless door — OAuth buttons (rendered only for providers with configured credentials), magic-link form (with a local-dev hint about the console link), and the one-click guest entry.
- **"Try as guest"** on the landing page and sign-in page — the explicit consent click from ADR 0009, wired to the already-IP-capped `/sign-in/anonymous` route.
- **The real dashboard**: session-gated (anonymous → redirect to `/sign-in`), server-rendered from RLS-scoped `withUser()` queries — documents list + upload surface with honest error copy for every machine-readable rejection code (413/415/403/429).
- **App shell**: identity in the header (guest or email), sign-out, and the guest banner — "Temporary guest workspace, deleted within 48 hours — sign up to keep your documents →".
- **Isomorphic boundaries honored**: guest caps live once in `src/lib/guest-caps.ts` (server limits build from the same constants the UI displays); the better-auth client lives in `src/lib/auth-client.ts`; client components never import `@/server`.
- Session lookup deduped per request via React `cache()` (layout + page share one DB answer).
- **e2e: the full guest journey** — landing → one click → banner → upload a real PDF → the document appears in the list, over the production build.

### Added — Phase 2.5: hardened uploads + storage drivers

- **`POST /api/documents`** with the full SECURITY §5 sequence: session tier → per-user rate guard → content-length gate → multipart parse → validation pipeline → guest count cap → storage put → tenant rows via `withUser()`. Plus **`GET /api/documents`** (RLS-scoped list).
- **Validation pipeline** (`src/server/documents/`, pure and unit-tested against crafted hostile bytes): magic-byte sniffing (declared MIME ignored), zip-bomb rejection by DECLARED uncompressed size — the OOXML central directory is walked without ever decompressing — PNG/JPEG pixel caps (40 MP), honest-text check for txt/md, tier caps (guest 5 MB / 2 documents; registered 20 MB).
- **Storage driver pattern** (same shape as the limiter): **R2** via `aws4fetch` (10 KB SigV4 signer — no multi-megabyte AWS SDK) when `R2_*` is configured; otherwise the **dev object store** (Postgres bytea, full put/get/delete parity) with one loud production error. Upload → store → retrieve is real in every environment, credentials or not.
- Server-generated storage keys (`docs/<userId>/<uuid>`); user-supplied names are display-only metadata. `document.create` audit rows land in the append-only table.
- The ≤10-page guest cap is explicitly deferred to parse time (Phase 3) — page count needs a parser, and upload time never parses.

### Added — Phase 2.4: domain schema (tenant tables + system role)

- **Six tenant tables** with the full canary pattern (ADR 0008): `documents`, `document_versions`, `threads`, `messages`, `api_usage`, `audit_events` — RLS + FORCE + policies, FK cascades to `user` (guest purge rides them), denormalized `user_id` on every table so policies stay single-comparison and carry-over stays uniform.
- **The canary pattern became a reusable suite**: every tenant table registers five adversarial cases in one place (`tenancy.test.ts`) — 35 new tenancy assertions across six tables, including forged-insert cases that are FK-valid so ONLY the policy can reject them.
- **audit_events is append-only by grant, not convention**: the runtime role's UPDATE/DELETE are revoked at the database level; tests walk drizzle's error cause-chain to assert the actual `permission denied`.
- **ADR 0010 — the system role** (`quodera_system`, `DATABASE_SYSTEM_URL`): the sanctioned cross-tenant operator. Pre-empts a production-only bug: carry-over on the admin connection would pass locally/CI (superuser bypass) and fail on Neon (owner + FORCE RLS). Role membership is the one credential sessions cannot fake.
- **Upgrade carry-over is live**: registering a guest moves every tenant row to the registered user (ids preserved) before the ghost is deleted — proven end-to-end through the real `onLinkAccount` hook, not a stub.
- New env: `DATABASE_SYSTEM_URL` / `APP_SYSTEM_DB_PASSWORD` (documented in `.env.example`, wired in CI).

### Added — Phase 2.3: guest mode (ADR 0009)

- **One-click guest sessions** via better-auth's `anonymous` plugin — ghost `users` rows with placeholder emails (no PII), enabled only after the Phase 2.2 IP cap (3/day per IP) was already guarding `/sign-in/anonymous`; no unguarded guest endpoint ever existed.
- **Hard 24h session TTL** enforced by a create-time clamp in `databaseHooks.session.create.before` — guest expiry lands before the refresh window, so guest sessions cannot be refreshed into longevity.
- **Purge pipeline**: `purgeExpiredGuests()` on the admin connection + daily Vercel cron (`vercel.json` → `/api/cron/purge-guests`, 03:00 UTC) + a 10% lazy sweep on guest creation as backstop. The cron route fails CLOSED without `CRON_SECRET` (timing-safe compare).
- **Upgrade carry-over contract pinned**: registering a guest creates the registered user and retires the ghost; `onLinkAccount` receives both ids — the sanctioned point where Phase 2.4 will copy tenant data. (ADR 0009 postscript documents why the in-place assumption was wrong.)
- **Test discipline fix**: DB-backed suites now run with `fileParallelism: false` — parallel files were racing each other's fixture truncates on the shared Postgres (LEARNINGS).

### Added — Phase 2.2: global quotas

- **Upstash driver** behind the existing limiter contract (`@upstash/ratelimit` sliding window): a driver swap with zero HTTP change — proven by the unchanged 429 contract tests and e2e. `getLimiter()` resolves Upstash-when-configured / memory-fallback, and a production deployment without Upstash logs ONE loud error instead of silently degrading to per-instance limits.
- **Per-IP guard on sensitive auth routes** (10/h): magic-link requests, OAuth starts/returns, token verification — composed inside `withApi` via `withRateLimit`. The 11th request from one IP answers with the shared 429 contract; test-distinguishable from better-auth's internal limiter by the `x-ratelimit-*` headers.
- **Guest-creation rule staged** at 3/day per IP (ADR 0009) — the rule is live; the `/sign-in/anonymous` endpoint arrives with the anonymous plugin (Phase 2.3).
- **Quota matrix centralized** in `src/server/rate-limit/policy.ts` — the only place limits are defined (no scattered literals).

### Added — Phase 2.1: auth core

- **better-auth integration** (passwordless): email magic links + env-gated Google/GitHub OAuth, mounted at `/api/auth/[...all]` through `withApi` (request ids, structured logging, error capture). Lazy singleton keeps builds hermetic; production fails fast without `BETTER_AUTH_SECRET`.
- **Identity system tables** (`user`, `session`, `account`, `verification`) with FK cascades — deliberately _not_ user-scoped RLS (session resolution precedes tenant context; system vs tenant trust domains documented in ARCHITECTURE §6 and LEARNINGS). `isAnonymous` column ready for guest mode (ADR 0009); the plugin itself enables in Phase 2.3 behind the IP-capped creation route.
- **Auth integration tests**: full magic-link round trip through the real HTTP handler, one-time-token replay rejection, system-table row assertions. E2E asserts the auth route is mounted and wrapped.
- `withApi` now tolerates immutable response headers (OAuth redirect responses).

### Fixed

- **Dependabot config was invalid after the policy change** — the `ignore` rule omitted the schema-required `dependency-name`, so GitHub's parser rejected the file and Dependabot went fully silent (no updates, majors included). Fixed with the documented `dependency-name: "*"` wildcard; the check only validates post-merge, which motivated a LEARNINGS entry on GitHub-side validation being invisible to CI.
- **Secret scan crashes on push after history merges** — `gitleaks/gitleaks-action` derived an invalid commit range (`root^..HEAD` is unresolvable when the base is a first-parent root), erroring the job on our first push. Replaced with a direct, version-pinned gitleaks run (`zricethezav/gitleaks:v8.24.3`) over the **full history** on every run — deterministic, fails closed, identical for push and pull_request events. SARIF uploaded as an artifact.

### Changed

- **Dependency policy: npm major versions are never auto-bumped.** Dependabot now ignores `semver-major` npm updates; majors (TypeScript 6, eslint-config-next 16, Next 16…) are deliberate, ADR-backed upgrades. GitHub-Actions majors remain allowed (they resolve runner deprecation warnings). Rationale recorded in `docs/LEARNINGS.md` and the closed Dependabot PRs (#5, #6, #7).

## [0.1.0] — 2026-11-17

### Added — Phase 1: foundation

- Next.js 15 App Router scaffold: marketing landing, `(app)` shell placeholder, error boundaries (error / global-error / not-found).
- **Row-level tenancy, canary-proven:** `tenancy_canary` table, RLS + `FORCE` + default-deny policies (`migrations/hardening/0001_tenancy_hardening.sql`), `withUser()` transaction context, five adversarial tenancy tests. The pattern every Phase 2 table copies (ADR 0008).
- **`withApi()` route contract:** request IDs (`x-request-id` response header), structured pino logging with secret redaction (tested), uniform 500 JSON, Sentry capture when configured.
- **Rate-limiter contract:** `RateLimiter` interface, per-instance sliding-window memory driver, 429 helpers (`retry-after` + `x-ratelimit-*`), reference route `/api/demo-limited` — driver-swappable for Upstash in Phase 2 (ADR 0007).
- **Probes:** `/api/health` (liveness, dependency-free) and `/api/ready` (readiness: DB ping, 503 when degraded).
- **Security headers + CSP** on every response via edge middleware; HSTS on HTTPS only.
- **Observability:** lazy DB singleton (builds stay hermetic), env validation via zod, Sentry wiring that no-ops without a DSN.
- **Migrations:** drizzle-kit generation + custom idempotent runner (`scripts/apply-migrations.ts`) tracking `_quodera_migrations`; Docker Postgres 17 + pgvector on `:5433`.
- **CI (GitHub Actions):** five jobs — quality (typecheck/lint/format/unit/build), database (pgvector container; migrations + RLS tests), e2e (Playwright smoke vs production build), commitlint, gitleaks. Dependabot (npm + actions), PR template enforcing the guardrail checklist, CODEOWNERS.
- **Deploy smoke:** hourly production `/api/health` probe workflow.
- **Governance docs:** README, ARCHITECTURE (pipeline, citation schema, tenancy, failure modes), SECURITY (threat model + debt register), AGENTS, CODING_GUIDELINES, GUARDRAILS, PROVISIONING runbook, LEARNINGS journal, ADRs 0001–0008.
- **Verification gate:** `pnpm verify:phase1` (+ `SMOKE=1` HTTP probes).

[Unreleased]: https://github.com/tasaufmim/quodera/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/tasaufmim/quodera/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/tasaufmim/quodera/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/tasaufmim/quodera/releases/tag/v0.1.0
