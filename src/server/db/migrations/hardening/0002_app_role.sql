-- 0002_app_role.sql — privileges for the runtime role (ADR 0008).
-- The role itself is bootstrapped by scripts/apply-migrations.ts (password is
-- environment-provided; never committed). This file is idempotent.

-- Schema access (Postgres 15+ revokes public-schema CREATE from PUBLIC; the
-- runtime role only needs USAGE — tables are created by the migration role).
grant usage on schema public to quodera_app;

-- Data privileges on everything that exists now…
grant select, insert, update, delete on all tables in schema public to quodera_app;

-- …and on everything the migration role creates later.
alter default privileges in schema public
  grant select, insert, update, delete on tables to quodera_app;

-- Deliberately NOT granted to the runtime role:
--   TRUNCATE / DDL / REFERENCES — owner-level powers, never needed at runtime,
--   and withholding them is what makes the tenancy tests meaningful.
