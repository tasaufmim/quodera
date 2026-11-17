# Coding guidelines

These are the rules that keep a solo project shippable at industry quality. They are deliberately short; AGENTS.md holds the condensed version.

## TypeScript

- `strict` + `noUncheckedIndexedAccess` — both non-negotiable. Indexing an array returns `T | undefined`; handle it.
- No `any`. `unknown` + narrowing, or a proper type.
- Non-null assertions (`!`) only where an invariant is _provable in the same expression_ (e.g. after a `length` check on the same line). Never to silence the checker.
- Prefer discriminated unions over boolean flags. Prefer `satisfies` over type annotations on object literals.
- Types for API boundaries live next to the zod schema and are derived from it (`z.infer`), never hand-written twice.

## Structure & imports

```
src/
  app/          # routing + UI composition ONLY — no business logic
  server/       # everything that must never reach the client
  components/   # shared UI (client components opt in with "use client")
  lib/          # isomorphic helpers/types shared by client & server
```

- Client code may import from `@/components`, `@/lib` — **never `@/server`**. The boundary is the security perimeter (GUARDRAILS #1).
- Server modules never import from `src/app`.
- No cross-imports between route handlers; shared logic goes to `src/server/{module}`.

## Errors

- Inside route handlers: `throw`. `withApi` converts unhandled throws into a 500 JSON `{error, requestId}` and reports to Sentry. Never `catch {}`.
- Expected failures (validation, limits, not-found) return explicit `Response.json(..., {status})` shapes — keep the 4xx bodies machine-readable: `{error: "rate_limited", ...}`.
- Errors carry context for logs, never for users: users get the request id, logs get the stack.

## Validation

- Every external input (body, query, headers-you-trust, upload metadata, webhooks) → zod schema → `safeParse` → 400 on failure. No exceptions, including "internal" callers — the next caller is always external.

## Logging

- One logger (`src/server/lib/logger.ts`). No `console.*` outside scripts.
- Bind request context (`requestId`, `route`) via child loggers — `withApi` already does this.
- Log events (what happened, duration, status), never payloads (contents, prompts, keys). New sensitive field ⇒ redact list + test (GUARDRAILS #8).

## Testing

| Level    | Tool                   | Required for                                                            |
| -------- | ---------------------- | ----------------------------------------------------------------------- |
| Unit     | Vitest                 | pure logic: limiter math, redaction, parsing helpers, schema validation |
| Tenancy  | Vitest + real Postgres | **every new tenant table** — copy rls.test.ts's five cases              |
| E2E      | Playwright             | every public route's contract (status codes, headers, error shapes)     |
| Evals 📍 | Phase 6                | retrieval + citation quality — the golden set                           |

- A test that cannot fail protects nothing: negative cases (cross-tenant, 4th request, redacted field) are the point.
- Tests run in CI against the same Postgres image as production (`pgvector/pgvector:pg17`).

## Commits, branches, PRs

- Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`, `perf:`) — enforced by lefthook + CI commitlint.
- Work happens on short-lived branches → PR → CI green → merge to `main` → deploy. Even solo: the PR is where guardrails are checked.
- One logical change per commit; docs follow the decision in the same commit (GUARDRAILS #10).

## Dependencies

- Every dependency must justify its existence in one line (PR description). Prefer stdlib/platform.
- Adding an install-script dependency means updating `pnpm-workspace.yaml`'s `onlyBuiltDependencies` — and explaining why in the PR.
- Lockfile changes only via PR. Dependabot does the boring ones.

## Formatting

Prettier owns the style (`.prettierrc`); ESLint owns correctness (`eslint.config.mjs`). Don't argue with either in review — run `pnpm format`.
