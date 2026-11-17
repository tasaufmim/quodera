# ADR 0008: Tenancy as default-deny RLS, proven by a canary table first

- **Status:** accepted
- **Date:** 2026-11-17

## Context

Cross-tenant leakage is the one catastrophic failure class in this product (people upload legal and professional documents). The original sketch said "individual database," which ADR 0003 resolved to row-level tenancy — but the _pattern_ had to be proven before eight real tables were built on it (Phase 1's canary-first sequencing). Two traps were known in advance: the app connects as the table **owner** (owners bypass RLS unless forced), and tenant context set via `SET` persists on pooled connections unless transaction-scoped.

## Decision

Every tenant table ships with `ENABLE ROW LEVEL SECURITY`, **`FORCE ROW LEVEL SECURITY`** (so even the owner is subject), and policies comparing `user_id` to `nullif(current_setting('app.user_id', true), '')::uuid` — which yields NULL when unset (or when a pooled connection carries the empty-string residue a transaction-local `set_config` can leave behind), making the whole thing **default-deny by construction**. The only sanctioned access path is `withUser(userId, fn)`, which opens a transaction and calls `set_config('app.user_id', …, true)` (transaction-local — context dies with the transaction and can never leak across a pooled connection). The pattern was proven in Phase 1 by the `tenancy_canary` table and five tenancy tests (own-read, cross-read=0, cross-insert=throws, cross-update/delete=0, owner-without-context=0), and every Phase 2 table copies all of it.

## Consequences

- Tenant isolation is a database guarantee, not an application discipline: a future query-builder bug still cannot cross tenants.
- Slightly higher setup ceremony per table (hardening SQL + five tests) — amortized by copy-paste from the canary.
- `TRUNCATE`/DDL remain owner powers (used by tests for cleanup, never by request code).
- The tests are adversarial: they fail if FORCE is dropped, if a policy is loosened, or if context leaks — a test that cannot fail protects nothing.

## Postscript (same day, after the first real run)

The first execution of the tenancy suite failed in the most instructive way possible: every isolation case leaked. Root cause: the Docker/CI `postgres` user is a **superuser**, and superusers bypass RLS categorically — `FORCE` only binds the _table owner_. The setup, not the tests, was wrong. Resolution (now part of this ADR):

- Migrations bootstrap a **runtime role** `quodera_app` (`nosuperuser nobypassrls`, password from `APP_DB_PASSWORD`); the application connects as it (`DATABASE_URL`).
- Migrations and test fixtures run over the **admin role** (`DATABASE_ADMIN_URL`: container superuser locally, Neon project owner in prod).
- Grants (`hardening/0002_app_role.sql`) deliberately exclude TRUNCATE/DDL — fixture power and runtime power are different privileges, and the tests now prove it.

Lesson generalized: **RLS is only ever as real as the role you connect as.** A tenancy test that runs as a superuser is theater.

## Alternatives considered

| Alternative                                                      | Why not                                                                                                            |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Application-layer filtering only (`where userId = session.user`) | one forgotten WHERE clause = leak; the database never enforces anything                                            |
| Database-per-user on Neon branches                               | branch-per-user explodes operationally; cross-user queries (none today) become impossible; backups are a nightmare |
| Postgres `SET session` instead of `set_config(..., true)`        | session-scoped settings leak across pooled connections — the transaction-local form is the only safe one           |
