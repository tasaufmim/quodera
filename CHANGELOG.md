# Changelog

All notable changes to Quodera are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

### Fixed

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

[Unreleased]: https://github.com/tasaufmim/quodera/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/tasaufmim/quodera/releases/tag/v0.1.0
