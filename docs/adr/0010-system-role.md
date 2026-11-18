# ADR 0010: A system role for cross-tenant operations

- **Status:** accepted
- **Date:** 2026-11-18

## Context

The upgrade carry-over (ADR 0009 postscript) reassigns tenant rows across
owners: `update … set user_id = $to where user_id = $from`. For every role the
tenancy model (ADR 0008) knows, this is rightly impossible:

- the **runtime role** violates WITH CHECK — reassigning owners is the one
  mutation the wall exists to prevent;
- the **admin connection** is the table OWNER on Neon, and FORCE RLS binds
  owners — the UPDATE would be default-deny-blocked there.

The trap: locally and in CI the admin is a Docker/runner **superuser**, and
superusers bypass RLS categorically. A carry-over written against the admin
connection would pass every test in every environment we have — and fail
only in production, where Neon's project owner is subject to FORCE. The bug
would be invisible until the first real guest upgraded.

## Decision

A dedicated, unprivileged-in-every-other-way **system role**, `quodera_system`
(`nosuperuser nobypassrls`), created by migrations with an env-provided
password (`APP_SYSTEM_DB_PASSWORD`), connected via `DATABASE_SYSTEM_URL`:

1. Every tenant-table policy gains one explicit arm:
   `… or current_user = 'quodera_system'` (hardening/0004, 0005). Default-deny
   is untouched for every other role.
2. The role receives the same table grants as the runtime role — EXCEPT that
   it keeps UPDATE/DELETE on `audit_events` (carry-over needs them; the
   runtime role's revocation stays in force).
3. The upgrade carry-over runs on this connection, inside `onLinkAccount`,
   BEFORE the anonymous plugin deletes the ghost. Signup never fails because
   the copy did — errors are logged, never thrown.
4. Only sanctioned system operations use it: today the carry-over. Migrations
   stay on the admin connection; the purge cron rides FK cascades from an
   admin delete. Adding a third caller requires an ADR note here.

## Consequences

- Cross-tenant operations are explicit, granted, and **testable in every
  environment** — including CI's superuser container, because the system role
  itself is NOT a superuser and its policy arm is exercised directly
  (tenancy.test.ts: "system role" suite).
- Role membership is the one credential a session cannot fake: unlike a GUC
  flag (`set_config('app.system', 'on')` — forgeable by any buggy query), no
  amount of context manipulation makes `current_user` something else without
  the role's password.
- One more env var and role to manage (PROVISIONING §3/§5); a missing
  `DATABASE_SYSTEM_URL` degrades upgrades to "data not carried" with a loud
  error log — never a failed signup.
- Policies are slightly longer; the arm is auditable and uniform across every
  tenant table (the generic tenancy suite would catch any table missing it).

## Alternatives considered

| Alternative                                  | Why not                                                                                              |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Carry-over on the admin connection           | Fails on Neon (owner + FORCE RLS); invisible locally/CI (superuser bypass) — a prod-only bug         |
| GUC system flag (`set_config('app.system')`) | forgeable by ANY connection — a bug in app code could mint system powers                             |
| Copy rows instead of reassigning             | new ids break FK graphs (versions ← documents, chunks ← versions later); reassignment preserves them |
| `SECURITY DEFINER` function                  | definer is the table owner → still FORCE-RLS-bound on Neon; adds an SQL-language maintenance surface |
