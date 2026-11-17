-- 0003_policy_nullif.sql — make the tenancy policy robust to the custom-GUC
-- empty-string quirk (forward-only fix; 0001 stays untouched, see GUARDRAILS #7).
--
-- The quirk: after `set_config('app.user_id', …, true)` runs inside a
-- transaction on a pooled connection, Postgres can leave the custom GUC set to
-- '' (empty string) once the transaction commits — instead of removing it.
-- `''::uuid` then throws `invalid input syntax for type uuid`, turning a
-- default-deny SELECT into a 500. `nullif(x, '')` treats the residue as NULL,
-- restoring default-deny semantics.
--
-- This exact pattern is the standard fix used across Postgres RLS deployments.

do $$
begin
  if exists (
    select 1 from pg_policies
    where tablename = 'tenancy_canary' and policyname = 'tenancy_canary_isolation'
  ) then
    drop policy tenancy_canary_isolation on tenancy_canary;
  end if;

  create policy tenancy_canary_isolation on tenancy_canary
    using (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
    with check (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
end
$$;
