-- 0007_citations_hardening.sql — the citations table joins the canary
-- pattern (ADR 0008). Idempotent; applied by scripts/apply-migrations.ts.

alter table citations enable row level security;
alter table citations force row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'citations' and policyname = 'citations_isolation'
  ) then
    create policy citations_isolation on citations
      using ((user_id = nullif(current_setting('app.user_id', true), '')::uuid)
             or current_user = 'quodera_system')
      with check ((user_id = nullif(current_setting('app.user_id', true), '')::uuid)
             or current_user = 'quodera_system');
  end if;
end
$$;
