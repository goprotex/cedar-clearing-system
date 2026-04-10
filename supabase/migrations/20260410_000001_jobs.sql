-- Jobs + multi-user progress tracking (Supabase / Postgres)

create extension if not exists pgcrypto;

create table if not exists public.jobs (
  id text primary key,
  bid_id text not null,
  title text not null,
  status text not null default 'active' check (status in ('active','paused','completed','cancelled')),
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  bid_snapshot jsonb not null,
  cedar_total_cells integer not null default 0,
  cedar_cleared_cells integer not null default 0
);

create index if not exists jobs_created_by_idx on public.jobs (created_by);
create index if not exists jobs_bid_id_idx on public.jobs (bid_id);

create table if not exists public.job_members (
  job_id text not null references public.jobs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'worker' check (role in ('owner','worker','viewer')),
  created_at timestamptz not null default now(),
  primary key (job_id, user_id)
);

create index if not exists job_members_user_id_idx on public.job_members (user_id);

create table if not exists public.job_events (
  id uuid primary key default gen_random_uuid(),
  job_id text not null references public.jobs(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  type text not null,
  data jsonb
);

create index if not exists job_events_job_id_created_at_idx on public.job_events (job_id, created_at desc);

create table if not exists public.job_cleared_cells (
  job_id text not null references public.jobs(id) on delete cascade,
  cell_id text not null,
  cleared_at timestamptz not null default now(),
  cleared_by uuid not null references auth.users(id) on delete restrict,
  primary key (job_id, cell_id)
);

create index if not exists job_cleared_cells_job_id_idx on public.job_cleared_cells (job_id);

alter table public.jobs enable row level security;
alter table public.job_members enable row level security;
alter table public.job_events enable row level security;
alter table public.job_cleared_cells enable row level security;

-- Keep jobs.cedar_cleared_cells synced with deduped cleared cells.
create or replace function public.sync_job_cleared_cells_count()
returns trigger
language plpgsql
as $$
begin
  update public.jobs j
  set cedar_cleared_cells = (
    select count(*)::int
    from public.job_cleared_cells c
    where c.job_id = j.id
  )
  where j.id = coalesce(new.job_id, old.job_id);
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_sync_job_cleared_cells_count on public.job_cleared_cells;
create trigger trg_sync_job_cleared_cells_count
after insert or delete on public.job_cleared_cells
for each row execute function public.sync_job_cleared_cells_count();

-- Jobs: members can read; members can update; creator can insert.
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
);

drop policy if exists "jobs_insert_for_creator" on public.jobs;
create policy "jobs_insert_for_creator"
on public.jobs
for insert
to authenticated
with check (created_by = auth.uid());

drop policy if exists "jobs_update_for_members" on public.jobs;
create policy "jobs_update_for_members"
on public.jobs
for update
to authenticated
using (
  exists (
    select 1
    from public.job_members jm
    where jm.job_id = jobs.id
      and jm.user_id = auth.uid()
  )
)
with check (true);

-- Job members: user can see their memberships; job members can see the roster.
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
);

-- Membership insert: allow the creator (owner) to add themselves; allow owners to add others.
drop policy if exists "job_members_insert_owner_or_self" on public.job_members;
create policy "job_members_insert_owner_or_self"
on public.job_members
for insert
to authenticated
with check (
  (
    user_id = auth.uid()
    and exists (
      select 1
      from public.jobs j
      where j.id = job_members.job_id
        and j.created_by = auth.uid()
    )
  )
  or exists (
    select 1
    from public.job_members jm
    where jm.job_id = job_members.job_id
      and jm.user_id = auth.uid()
      and jm.role = 'owner'
  )
);

-- Allow owners to update roles / remove members.
drop policy if exists "job_members_update_owner" on public.job_members;
create policy "job_members_update_owner"
on public.job_members
for update
to authenticated
using (
  exists (
    select 1
    from public.job_members jm
    where jm.job_id = job_members.job_id
      and jm.user_id = auth.uid()
      and jm.role = 'owner'
  )
)
with check (true);

drop policy if exists "job_members_delete_owner" on public.job_members;
create policy "job_members_delete_owner"
on public.job_members
for delete
to authenticated
using (
  exists (
    select 1
    from public.job_members jm
    where jm.job_id = job_members.job_id
      and jm.user_id = auth.uid()
      and jm.role = 'owner'
  )
);

-- Job events: members can read; members can insert events as themselves.
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
);

drop policy if exists "job_events_insert_for_members" on public.job_events;
create policy "job_events_insert_for_members"
on public.job_events
for insert
to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1
    from public.job_members jm
    where jm.job_id = job_events.job_id
      and jm.user_id = auth.uid()
  )
);

-- Cleared cells: members can read; members can upsert their own clears.
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
);

drop policy if exists "job_cleared_cells_insert_for_members" on public.job_cleared_cells;
create policy "job_cleared_cells_insert_for_members"
on public.job_cleared_cells
for insert
to authenticated
with check (
  cleared_by = auth.uid()
  and exists (
    select 1
    from public.job_members jm
    where jm.job_id = job_cleared_cells.job_id
      and jm.user_id = auth.uid()
  )
);

drop policy if exists "job_cleared_cells_update_for_members" on public.job_cleared_cells;
create policy "job_cleared_cells_update_for_members"
on public.job_cleared_cells
for update
to authenticated
using (
  exists (
    select 1
    from public.job_members jm
    where jm.job_id = job_cleared_cells.job_id
      and jm.user_id = auth.uid()
  )
)
with check (cleared_by = auth.uid());

