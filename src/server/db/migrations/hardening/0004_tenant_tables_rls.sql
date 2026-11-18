-- 0004_tenant_tables_rls.sql — the canary pattern applied to the Phase 2.4
-- domain tables (ADR 0008). Policies carry the system-role arm from day one
-- (current_user = 'quodera_system' — ADR 0010): it is false for every existing
-- role until migrations create quodera_system, so default-deny is preserved.
--
-- Idempotent: safe to re-run; scripts/apply-migrations.ts records it once.

alter table documents      enable row level security;
alter table documents      force row level security;
alter table document_versions enable row level security;
alter table document_versions force row level security;
alter table threads        enable row level security;
alter table threads        force row level security;
alter table messages       enable row level security;
alter table messages       force row level security;
alter table api_usage      enable row level security;
alter table api_usage      force row level security;
alter table audit_events   enable row level security;
alter table audit_events   force row level security;

do $$
declare
  t text;
begin
  foreach t in array array['documents','document_versions','threads','messages','api_usage','audit_events']
  loop
    if not exists (
      select 1 from pg_policies
      where tablename = t and policyname = t || '_isolation'
    ) then
      execute format(
        'create policy %I on %I
           using ((user_id = nullif(current_setting(''app.user_id'', true), '''')::uuid)
                  or current_user = ''quodera_system'')
           with check ((user_id = nullif(current_setting(''app.user_id'', true), '''')::uuid)
                  or current_user = ''quodera_system'')',
        t || '_isolation', t
      );
    end if;
  end loop;
end
$$;

-- audit_events is append-only BY GRANT, not convention (SECURITY.md,
-- repudiation threat): the runtime role can INSERT and SELECT but never
-- UPDATE or DELETE. The quodera_system role (0005) retains full powers for
-- the upgrade carry-over.
revoke update, delete on audit_events from quodera_app;
