-- 0006_chunks_hardening.sql — the chunks table joins the canary pattern
-- (ADR 0008) plus its hybrid-retrieval indexes (ARCHITECTURE §6/§8).
-- Idempotent; applied by scripts/apply-migrations.ts once.

alter table chunks enable row level security;
alter table chunks force row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'chunks' and policyname = 'chunks_isolation'
  ) then
    create policy chunks_isolation on chunks
      using ((user_id = nullif(current_setting('app.user_id', true), '')::uuid)
             or current_user = 'quodera_system')
      with check ((user_id = nullif(current_setting('app.user_id', true), '')::uuid)
             or current_user = 'quodera_system');
  end if;
end
$$;

-- Hybrid retrieval groundwork (same shape as the canary): HNSW for dense
-- vectors, generated tsvector + GIN for exact/BM25-style matching.
create index if not exists chunks_embedding_hnsw
  on chunks using hnsw (embedding vector_cosine_ops);

alter table chunks
  add column if not exists search tsvector
  generated always as (to_tsvector('english', content)) stored;

create index if not exists chunks_search_gin
  on chunks using gin (search);
