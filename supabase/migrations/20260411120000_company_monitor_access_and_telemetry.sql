-- Company-wide scout monitor access for profile roles owner + manager (same company as bid).
-- Adds profile role `manager` and extends RLS on jobs-related tables.
-- Adds empty-ready `job_telemetry_latest` for future machine/engine stats (wire-up later).

-- ─── Profile role: add `manager` ─────────────────────────────────────────────
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('owner', 'manager', 'operator', 'crew_lead', 'viewer'));

-- ─── Helper: signed-in user may see all jobs for their company (monitor / dispatch) ───
create or replace function public.user_can_monitor_company_jobs()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select p.company_id is not null
        and p.role in ('owner', 'manager')
      from public.profiles p
      where p.id = auth.uid()
    ),
    false
  );
$$;

-- ─── Jobs: company supervisors see all jobs whose bid belongs to their company ───
drop policy if exists "jobs_select_for_members" on public.jobs;
create policy "jobs_select_for_members"
on public.jobs
for select
to authenticated
using (
  exists (
    select 1
    from public.job_members jm
    where jm.job_id = jobs.id
      and jm.user_id = auth.uid()
  )
  or (
    public.user_can_monitor_company_jobs()
    and exists (
      select 1
      from public.bids b
      where b.id::text = bid_id
        and b.company_id is not null
        and b.company_id = public.user_company_id()
    )
  )
);

-- ─── Cleared cells ───────────────────────────────────────────────────────────
drop policy if exists "job_cleared_cells_select_for_members" on public.job_cleared_cells;
create policy "job_cleared_cells_select_for_members"
on public.job_cleared_cells
for select
to authenticated
using (
  exists (
    select 1
    from public.job_members jm
    where jm.job_id = job_cleared_cells.job_id
      and jm.user_id = auth.uid()
  )
  or (
    public.user_can_monitor_company_jobs()
    and exists (
      select 1
      from public.jobs j
      join public.bids b on b.id::text = j.bid_id
      where j.id = job_cleared_cells.job_id
        and b.company_id is not null
        and b.company_id = public.user_company_id()
    )
  )
);

-- ─── Operator positions (Realtime SELECT uses same policy) ───────────────────
drop policy if exists "job_operator_positions_select_for_members" on public.job_operator_positions;
create policy "job_operator_positions_select_for_members"
on public.job_operator_positions
for select
to authenticated
using (
  exists (
    select 1
    from public.job_members jm
    where jm.job_id = job_operator_positions.job_id
      and jm.user_id = auth.uid()
  )
  or (
    public.user_can_monitor_company_jobs()
    and exists (
      select 1
      from public.jobs j
      join public.bids b on b.id::text = j.bid_id
      where j.id = job_operator_positions.job_id
        and b.company_id is not null
        and b.company_id = public.user_company_id()
    )
  )
);

-- ─── Job events (optional monitor detail) ───────────────────────────────────
drop policy if exists "job_events_select_for_members" on public.job_events;
create policy "job_events_select_for_members"
on public.job_events
for select
to authenticated
using (
  exists (
    select 1
    from public.job_members jm
    where jm.job_id = job_events.job_id
      and jm.user_id = auth.uid()
  )
  or (
    public.user_can_monitor_company_jobs()
    and exists (
      select 1
      from public.jobs j
      join public.bids b on b.id::text = j.bid_id
      where j.id = job_events.job_id
        and b.company_id is not null
        and b.company_id = public.user_company_id()
    )
  )
);

-- ─── Job members roster: supervisors see members for company jobs ──────────
drop policy if exists "job_members_select_for_members" on public.job_members;
create policy "job_members_select_for_members"
on public.job_members
for select
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.job_members jm2
    where jm2.job_id = job_members.job_id
      and jm2.user_id = auth.uid()
  )
  or (
    public.user_can_monitor_company_jobs()
    and exists (
      select 1
      from public.jobs j
      join public.bids b on b.id::text = j.bid_id
      where j.id = job_members.job_id
        and b.company_id is not null
        and b.company_id = public.user_company_id()
    )
  )
);

-- ─── Telemetry placeholder (populate from equipment / telematics later) ──────
create table if not exists public.job_telemetry_latest (
  job_id text not null references public.jobs(id) on delete cascade,
  source_key text not null default 'default',
  kind text not null default 'custom' check (kind in ('machine', 'engine', 'progress', 'custom')),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (job_id, source_key)
);

create index if not exists job_telemetry_latest_job_id_idx on public.job_telemetry_latest (job_id);

alter table public.job_telemetry_latest enable row level security;

drop policy if exists "job_telemetry_latest_select_scope" on public.job_telemetry_latest;
create policy "job_telemetry_latest_select_scope"
on public.job_telemetry_latest
for select
to authenticated
using (
  exists (
    select 1
    from public.job_members jm
    where jm.job_id = job_telemetry_latest.job_id
      and jm.user_id = auth.uid()
  )
  or (
    public.user_can_monitor_company_jobs()
    and exists (
      select 1
      from public.jobs j
      join public.bids b on b.id::text = j.bid_id
      where j.id = job_telemetry_latest.job_id
        and b.company_id is not null
        and b.company_id = public.user_company_id()
    )
  )
);

-- Writers: service role / future edge functions; optional member insert can be added later.

-- Realtime: stream telemetry updates to the monitor when rows appear
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'job_telemetry_latest'
  ) then
    alter publication supabase_realtime add table public.job_telemetry_latest;
  end if;
end $$;

alter table if exists public.job_telemetry_latest replica identity full;
