# Learnings — the technical journal

The point of this project is _learning the hard parts, deliberately_. Each entry: what happened, why it was surprising, what we now do instead. Add one whenever you fight something for more than 20 minutes — future-you interviewing for the job will want these stories.

Format: `### YYYY-MM-DD — topic` + a short story.

---

### 2026-11-17 — gitleaks-action derives invalid commit ranges after history merges

**What:** the first push of the merged history (local phase-1 commit + GitHub's "Initial commit") failed the secret-scan job with `ERROR: Unexpected exit code [1]` — no leak found, the scanner itself died.

**Why:** `gitleaks/gitleaks-action` builds a `before^..after` commit range from the push event. Our phase-1 commit is a **root** on the first-parent chain of the merge, so `537f606^` resolves to nothing — git rejects the range (`fatal: ambiguous argument`), gitleaks exits nonzero, the job goes red. Scanned bytes: ~0.

**Now:** the job runs gitleaks directly from a pinned image (`zricethezav/gitleaks:v8.24.3`) over the **full history** on every run — no range derivation, identical behavior for push and pull_request events, fails closed. (Also the moment we realized dependabot PR scans only cover the PR's commits — full-history scanning was overdue anyway.)

### 2026-11-17 — SET LOCAL on a custom GUC can leave `''` behind on pooled connections

**What:** the default-deny test threw `invalid input syntax for type uuid: ""` — the policy's `current_setting('app.user_id', true)` returned an **empty string**, not NULL, on a pooled session after an earlier `withUser` transaction.

**Why:** after transaction-local `set_config` of a _custom_ (unregistered) GUC, Postgres reverts the setting to its "previous value" — and when there was no previous value, some paths leave an empty string instead of removing the variable. `''::uuid` then explodes, converting default-deny into a 500.

**Now:** policies cast via `nullif(current_setting(...), '')::uuid` (hardening/0003, the forward-only fix — 0001 stays untouched). Empty residue and true-unset both mean "no tenant context → zero rows."

### 2026-11-17 — Superusers bypass RLS entirely (FORCE only binds owners)

**What:** the tenancy suite shipped green on paper — migration ran, policies existed — yet tenant B could read tenant A's rows, forged inserts succeeded, and the owner-without-context case returned rows.

**Why:** the Docker container's default `postgres` user is a **superuser**, and superusers bypass row security categorically — `FORCE ROW LEVEL SECURITY` only binds the table _owner_. The tests were correct; the connection role made them meaningless. This would have failed identically in the CI service container.

**Now:** migrations bootstrap an unprivileged runtime role (`quodera_app`, `nosuperuser nobypassrls`); the app and all behavioral tests connect as it (`DATABASE_URL`), while migrations and fixtures use the admin role (`DATABASE_ADMIN_URL`). Grants live in `hardening/0002_app_role.sql` and deliberately exclude TRUNCATE/DDL. Fixture power and runtime power are now provably different things.

### 2026-11-17 — Table owners bypass RLS unless FORCED

**What:** Postgres RLS was enabled and policies looked right, but the "default-deny" test kept returning rows.

**Why:** the app connects as the table owner (the Neon branch owner role), and owners bypass row security by default. `ENABLE ROW LEVEL SECURITY` alone does nothing for owner connections.

**Now:** every hardening migration emits `ENABLE` **and** `FORCE ROW LEVEL SECURITY`, and rls.test.ts has a dedicated case that fails if FORCE ever disappears — the owner with no tenant context must see zero rows.

### 2026-11-17 — pnpm 12 blocks install scripts by default

**What:** `pnpm add` errored with `ERR_PNPM_IGNORED_BUILDS` for esbuild and lefthook, and the classic `pnpm.onlyBuiltDependencies` field in package.json was silently ignored.

**Why:** pnpm 12 moved settings to `pnpm-workspace.yaml` and made build-script denial the default (supply-chain hardening).

**Now:** `pnpm-workspace.yaml` carries a `onlyBuiltDependencies` allowlist (esbuild, lefthook) with a comment explaining each — adding to it requires justification in the PR.

### 2026-11-17 — Edge middleware is not Node

**What:** wanted to generate request IDs + log in middleware; pino and AsyncLocalStorage don't exist there.

**Why:** Next.js middleware runs in the edge runtime (V8 isolate, no Node stdlib).

**Now:** middleware does headers only; request IDs and logging live in `withApi` on the Node runtime (ARCHITECTURE.md §8 documents the split so we stop re-discovering it).

### 2026-11-17 — Serverless rate limiting is per-instance

**What:** the in-memory limiter passes tests but would under-count in production: each Vercel instance keeps its own Map.

**Why:** serverless = N processes, each with private memory.

**Now:** the limiter is an interface; the memory driver is explicitly labeled a contract-prover for Phase 1, and global quotas move to Upstash (fetch-based, edge-compatible) in Phase 2 — ADR 0007.

### 2026-11-17 — `next build` must not need a database

**What:** importing a DB client that connects eagerly broke CI builds with no DATABASE_URL.

**Why:** module side effects at import time.

**Now:** `getDb()` is a lazy singleton — the app boots and builds hermetically, and `/api/ready` distinguishes "degraded" (503) from "dead" (no response).
