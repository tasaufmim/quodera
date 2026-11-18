-- 0005_system_role.sql — the sanctioned cross-tenant operator (ADR 0010).
--
-- Why it exists: the upgrade carry-over (guest → registered, ADR 0009
-- postscript) reassigns tenant rows across owners. The runtime role can
-- never do that (WITH CHECK); the ADMIN connection on Neon is the table
-- OWNER, and FORCE RLS binds owners too — carry-over would fail in
-- production while passing locally, where the Docker admin is a superuser
-- that bypasses RLS entirely. A dedicated role makes the operation
-- explicit, granted, and testable in every environment.
--
-- The role is created by scripts/apply-migrations.ts (password from
-- APP_SYSTEM_DB_PASSWORD, never committed). This file grants its privileges.

grant usage on schema public to quodera_system;

grant select, insert, update, delete on all tables in schema public to quodera_system;

alter default privileges in schema public
  grant select, insert, update, delete on tables to quodera_system;

-- Bring the canary's policy (0003 form) up to the system-role form so every
-- tenant table shares one policy shape.
do $$
begin
  if exists (
    select 1 from pg_policies
    where tablename = 'tenancy_canary' and policyname = 'tenancy_canary_isolation'
  ) then
    drop policy tenancy_canary_isolation on tenancy_canary;
  end if;

  create policy tenancy_canary_isolation on tenancy_canary
    using ((user_id = nullif(current_setting('app.user_id', true), '')::uuid)
           or current_user = 'quodera_system')
    with check ((user_id = nullif(current_setting('app.user_id', true), '')::uuid)
           or current_user = 'quodera_system');
end
$$;
