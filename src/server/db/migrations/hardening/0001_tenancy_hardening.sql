-- 0001_tenancy_hardening.sql — row-level tenancy for the canary table (ADR 0008).
-- Idempotent: safe to re-run; scripts/apply-migrations.ts records it once.
-- Postgres has no CREATE POLICY IF NOT EXISTS, hence the DO block.
-- NOTE: superseded by hardening/0003_policy_nullif.sql (custom-GUC empty-string
-- quirk) — kept for the forward-only history; fresh databases apply both.

alter table tenancy_canary enable row level security;

-- FORCE matters even though our app connects as the table owner: without it,
-- the owner role silently bypasses RLS entirely — the classic tenant-leak bug.
-- rls.test.ts "default-deny" case is the proof this is actually in force.
alter table tenancy_canary force row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'tenancy_canary' and policyname = 'tenancy_canary_isolation'
  ) then
    -- current_setting(..., true) returns NULL when the context is unset, and
    -- `user_id = NULL` filters every row: default-deny, by construction.
    create policy tenancy_canary_isolation on tenancy_canary
      using (user_id = current_setting('app.user_id', true)::uuid)
      with check (user_id = current_setting('app.user_id', true)::uuid);
  end if;
end
$$;

-- Hybrid-retrieval groundwork (ARCHITECTURE.md §pipeline): HNSW for dense
-- vectors, a generated tsvector + GIN for exact/BM25-style matching.
create index if not exists tenancy_canary_embedding_hnsw
  on tenancy_canary using hnsw (embedding vector_cosine_ops);

alter table tenancy_canary
  add column if not exists search tsvector
  generated always as (to_tsvector('english', content)) stored;

create index if not exists tenancy_canary_search_gin
  on tenancy_canary using gin (search);
