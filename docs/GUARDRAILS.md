# Guardrails — the ten invariants

Every change to this repo is reviewed against these. They are deliberately few, absolute, and (where possible) machine-enforced. If a rule blocks you, the answer is an ADR changing the rule — not a silent exception.

| #   | Invariant                                                                                                                                                                             | Enforced by                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1   | **No secret ever reaches the client.** No `NEXT_PUBLIC_` var may hold a secret; no external provider is called from the browser. All external calls go through server route handlers. | gitleaks, code review, PR checklist                     |
| 2   | **Every tenant table: `user_id NOT NULL` + `ENABLE/FORCE ROW LEVEL SECURITY` + policies on `current_setting('app.user_id')` + the five tenancy tests.** Access only via `withUser()`. | rls.test.ts pattern, hardening migrations, PR checklist |
| 3   | **Every route handler is wrapped in `withApi()`** — request id, structured logs, error capture.                                                                                       | code review, e2e                                        |
| 4   | **Every external input is zod-validated** (body, query, upload metadata, webhooks).                                                                                                   | code review, PR checklist                               |
| 5   | **Every answer path attaches citations** (from Phase 4 onward): no citation, no answer. Refusal is acceptable; uncited claims are not.                                                | evals (Phase 6), code review                            |
| 6   | **Every public route is rate-limited**, using the shared contract (`retry-after`, `x-ratelimit-*`) — never ad-hoc 429s.                                                               | headers.test.ts, e2e, code review                       |
| 7   | **Migrations are forward-only.** Never edit an applied `.sql`; drizzle-inexpressible DDL (RLS, policies, indexes) goes in `migrations/hardening/` as idempotent SQL.                  | migration runner, review                                |
| 8   | **No secrets or PII in logs.** New sensitive field ⇒ redact list in `logger.ts` AND `logger.test.ts`.                                                                                 | logger.test.ts, review                                  |
| 9   | **Env vars are declared, not discovered.** App-read vars go in `src/server/lib/env.ts` + `.env.example`; script/CI-only vars are documented in `.env.example` — same commit.          | env.ts parse, review, PR checklist                      |
| 10  | **Docs follow decisions.** A change that invalidates ARCHITECTURE.md / SECURITY.md / an ADR updates it in the same commit.                                                            | PR template, review                                     |

## Why so absolute?

Guardrail #2 is the one that cannot ever be "just this once": a single tenant table without FORCE'd RLS is a cross-tenant leak wearing a feature branch's clothes. The same reasoning scales down: the checklist is cheap; the class of bug it prevents is catastrophic.

## Adding / changing a guardrail

Write an ADR (`docs/adr/`) with the reasoning, update this table, update the PR template — in one commit. Guardrails are versioned by git history, not by memory.
