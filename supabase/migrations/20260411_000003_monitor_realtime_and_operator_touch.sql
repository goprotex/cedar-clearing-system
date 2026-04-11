-- Scout monitor: Realtime (postgres_changes) + operator position timestamps
--
-- 1) Add job_cleared_cells and job_operator_positions to the supabase_realtime publication
--    so clients can subscribe via .on('postgres_changes', ...). Safe if already added.
-- 2) replica identity full on job_operator_positions helps WAL payloads for filtered UPDATEs.
-- 3) Touch updated_at on row update (upsert updates were not bumping updated_at).

-- ─── Realtime publication (idempotent add) ───────────────────────────────────
-- Hosted Supabase projects include publication `supabase_realtime`. If missing (rare), create it:
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'job_cleared_cells'
  ) then
    alter publication supabase_realtime add table public.job_cleared_cells;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'job_operator_positions'
  ) then
    alter publication supabase_realtime add table public.job_operator_positions;
  end if;
end $$;

-- Full row replica identity for realtime UPDATE payloads (optional but recommended for filters)
alter table if exists public.job_operator_positions replica identity full;

-- ─── Keep updated_at fresh on GPS upserts ────────────────────────────────────
-- set_updated_at() is defined in 20260410_000002_core_tables.sql
drop trigger if exists set_job_operator_positions_updated_at on public.job_operator_positions;
create trigger set_job_operator_positions_updated_at
  before update on public.job_operator_positions
  for each row execute function public.set_updated_at();
