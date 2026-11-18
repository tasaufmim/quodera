# Learnings — the technical journal

The point of this project is _learning the hard parts, deliberately_. Each entry: what happened, why it was surprising, what we now do instead. Add one whenever you fight something for more than 20 minutes — future-you interviewing for the job will want these stories.

Format: `### YYYY-MM-DD — topic` + a short story.

---

### 2026-11-18 — Superuser dev environments mask FORCE-RLS failures

**What:** designing the guest→registered carry-over, the obvious move was the admin connection (it already existed). It would have passed every test in every environment we have — and failed ONLY on Neon, in production, on the first real upgrade.

**Why:** locally and in CI the admin is a Docker/runner SUPERUSER, and superusers bypass RLS categorically. On Neon the admin is the table OWNER, and FORCE binds owners. Same code, opposite outcomes, distinguished only by an environment we cannot test in.

**Now:** cross-tenant operations run on a dedicated `quodera_system` role whose policy arm (`current_user = 'quodera_system'`) is exercised directly by the tenancy suite — the operation works for the same reason in every environment, or fails in all of them. Generalized lesson: permission-dependent behavior must be owned by a role you control, never by whatever the local admin happens to be.

### 2026-11-17 — Parallel test FILES race on a shared physical database

**What:** after adding the guest suite, passing tests started failing randomly-ish: a magic-link user "vanished" mid-test, and a just-created guest row was missing. The same suites passed individually.

**Why:** every DB-backed test file truncates its fixtures in `beforeEach` — and vitest runs FILES in parallel. Four suites sharing one physical Postgres meant one file's truncate wiped another file's in-flight rows. It was latent with three fast files; a fourth, slower one surfaced it.

**Now:** `fileParallelism: false` in vitest.config.mts — integration suites sharing a database run sequentially. Within a file, tests already run serially. (The lesson generalizes: parallelism needs isolation; a shared database is not isolation.)

### 2026-11-17 — Library semantics beat design sketches — and tests are how you find out

**What:** ADR 0009 assumed guest→registered upgrade links the SAME `user_id` in place. better-auth's anonymous plugin actually creates a NEW registered user and deletes the ghost, handing both to `onLinkAccount`.

**Why it mattered:** with tenant tables live, an in-place assumption would have silently orphaned every guest's trial documents at signup.

**Now:** the upgrade integration test pins the actual contract — ghost deleted, registered user created, and the hook receives both ids. `onLinkAccount` is the sanctioned data-carry-over point for Phase 2.4. The ADR carries a postscript; designs are hypotheses until a test touches them.

### 2026-11-17 — postgres.js template parameters cannot live inside quoted literals

**What:** `now() - interval '${hours}'` exploded with a type error — postgres.js substitutes `${…}` as `$n` placeholders regardless of SQL context, so the placeholder landed inside a quoted string.

**Now:** intervals and similar literals are written as SQL text (`interval '49 hours'`), parameters only where they bind to typed positions.

### 2026-11-17 — Session resolution is chicken-and-egg with user-scoped RLS

**What:** the reflex move was applying the canary pattern (RLS on everything) to better-auth's tables too.

**Why it can't work:** session lookup happens **by token, before any tenant context exists** — `select session where token = ?` is cross-user by construction. RLS keyed on `app.user_id` would default-deny the login flow itself; and you can't `withUser()` your way to a session you don't have yet.

**Now:** identity tables (`user`, `session`, `account`, `verification`) are **system tables** — no user-scoped RLS, written only by better-auth's parameterized queries on the runtime role. The tenancy wall governs everything downstream of a `user_id` FK. Distinguishing the two trust domains (identity machinery vs tenant data) is the actual lesson; blanket "RLS everywhere" is not a design.

### 2026-11-17 — GitHub-side validation is invisible to CI (and there is no usable schema for it)

**What:** hours after merging the dependency policy, GitHub reported `Dependabot / .github/dependabot.yml — invalid details` — five minutes _after_ merge, on a check our branch protection cannot require, with Dependabot fully disabled (a config that fails parsing proposes nothing, not even patch updates).

**Why:** the `ignore` rule used `update-types` without `dependency-name`; GitHub's schema requires the name on every entry. CI couldn't catch it because GitHub validates this file **post-merge only** — the same class as the gitleaks-action failure: config consumed by GitHub services, invisible to our five required checks.

**Tried, honestly, and rejected:** validating `dependabot.yml` in CI against SchemaStore's `dependabot.json` — tested before trusting it, and it's the **v1-era schema** (`update_configs`, `version: 1`): it rejects every valid modern config. No maintained public schema for v2 exists, and the dependabot CLI has no lightweight `validate` subcommand. Shipping a validator that cannot fail is theater.

**Now:** `dependency-name: "*"` (the documented wildcard) makes the rule schema-valid. Policy: dependabot.yml changes get deliberate review, and the Dependabot check on `main` is part of the post-merge eyeball routine. Generalized lesson: _for anything GitHub parses server-side, assume CI is blind to it — verify by hand after merge._

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
