# AGENTS.md — operating manual for AI coding agents

You are working on **Quodera**, a citation-grounded RAG platform. This file is
your contract. Read it before touching anything; docs/GUARDRAILS.md holds the
full invariants and is enforced in PR review.

## Non-negotiable rules

1. **Never put secrets in client code.** Anything imported by a file with
   `"use client"` — or reachable from `src/app` components — must never read
   `OPENROUTER_API_KEY`, `BETTER_AUTH_SECRET`, `GEMINI_API_KEY`, etc. All
   external calls go through server route handlers. No `NEXT_PUBLIC_` variable
   may hold a secret.
2. **All tenant data access goes through `withUser()`** (`src/server/db/rls.ts`).
   Raw `getDb()` queries against tenant tables are default-deny by RLS — treat
   "0 rows returned" outside `withUser` as a bug in the caller, not a database
   problem to work around.
3. **Every route handler is wrapped in `withApi()`** (`src/server/lib/api-handler.ts`).
   It provides request ids, structured logging, and error capture. If you write
   `export const GET = async () => {...}` directly, you skipped the contract.
4. **Validate every external input with zod** — request bodies, query strings,
   upload metadata, webhook payloads. No hand-rolled parsing.
5. **Never log secrets or PII.** Use the shared logger; if you introduce a new
   sensitive field name, add it to the redact list in `src/server/lib/logger.ts`
   and to `logger.test.ts`.
6. **Migrations are forward-only.** Never edit a file under
   `src/server/db/migrations/` that has been applied anywhere; write a new one.
   RLS/policy/index SQL goes in `migrations/hardening/` (idempotent, DO-block
   guarded) — drizzle's schema language cannot express it.
7. **Edge vs Node:** `src/middleware.ts` runs in the EDGE runtime — no Node
   APIs (no pino, no postgres, no AsyncLocalStorage). Node-only logic belongs
   in route handlers / `src/server`.
8. **Docs follow decisions.** If your change invalidates something in
   ARCHITECTURE.md / SECURITY.md / an ADR, update it in the same commit.

## Commands

| Task                                                | Command                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------- |
| install                                             | `pnpm install`                                                            |
| dev server                                          | `pnpm dev`                                                                |
| typecheck / lint / format                           | `pnpm typecheck` / `pnpm lint` / `pnpm format`                            |
| unit tests                                          | `pnpm test`                                                               |
| db tenancy tests (needs `pnpm db:up` + `.env`)      | `pnpm test:db`                                                            |
| e2e (builds nothing itself; run `pnpm build` first) | `pnpm build && pnpm test:e2e`                                             |
| new migration from schema                           | `pnpm db:generate` (then write hardening SQL if the table is tenant data) |
| apply migrations                                    | `pnpm db:migrate`                                                         |
| **definition of done**                              | `pnpm verify:phase1`                                                      |

Always finish with `pnpm verify:phase1` before claiming a task is complete.

## Repo map

- `src/app/` — routes. `(marketing)` public pages; `(app)` authenticated shell
  (Phase 2 gate); `api/` route handlers.
- `src/server/` — server-only. `db/` (drizzle + schema + RLS + migrations),
  `lib/` (env, logger, withApi, request context, observability),
  `rate-limit/` (contract + memory driver + 429 helpers).
- `e2e/` — Playwright smoke.
- `scripts/` — migration runner + phase verification.
- `docs/` — guidelines, guardrails, ADRs, provisioning.

## Conventions

- TypeScript strict (+ `noUncheckedIndexedAccess`). No `any`; no non-null
  assertions outside provably-safe spots (see docs/CODING_GUIDELINES.md).
- Imports: client code may import from `@/lib`/`@/components` only;
  `@/server/*` is server-only. Shared types go in `src/lib`.
- Commits: Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`,
  `refactor:`, `test:`, `perf:`). The commit-msg hook enforces it.
- Errors: throw inside handlers; `withApi` converts to a 500 JSON with a
  request id. Never swallow errors silently.

## Phase context (where we are)

Phase 1 (foundation) is complete: scaffold, CI/CD, RLS canary, observability,
rate-limit contract. Next is Phase 2 — auth (better-auth: Google/GitHub OAuth,
email magic links, and anonymous/guest ghost sessions per ADR 0009), real
domain schema (every table copies the canary pattern: user_id, RLS with FORCE,
and the five tenancy tests), Upstash global quotas incl. guest tiers, hardened
uploads with guest caps, and three-state route gating (anonymous, guest,
registered). Read docs/adr/0008 and docs/adr/0009 before touching auth,
quotas, or any new table.
