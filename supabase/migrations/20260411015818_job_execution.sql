-- Work orders, time entries, GPS tracks, schedule blocks (job execution layer)

-- Work orders (per pasture / unit of work)
create table if not exists public.job_work_orders (
  id uuid primary key default gen_random_uuid(),
  job_id text not null references public.jobs(id) on delete cascade,
  pasture_id text not null default '',
  pasture_name text not null default '',
  instructions text not null default '',
  status text not null default 'pending' check (status in ('pending','in_progress','done','skipped')),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists job_work_orders_job_id_idx on public.job_work_orders (job_id);

-- Time entries (clock in/out or manual hours)
create table if not exists public.job_time_entries (
  id uuid primary key default gen_random_uuid(),
  job_id text not null references public.jobs(id) on delete cascade,
  work_order_id uuid references public.job_work_orders(id) on delete set null,
  operator_id uuid not null references auth.users(id) on delete cascade,
  clock_in timestamptz not null,
  clock_out timestamptz,
  hours_manual double precision,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists job_time_entries_job_id_idx on public.job_time_entries (job_id);
create index if not exists job_time_entries_operator_idx on public.job_time_entries (operator_id);

-- GPS tracks (breadcrumb or imported polyline)
create table if not exists public.job_gps_tracks (
  id uuid primary key default gen_random_uuid(),
  job_id text not null references public.jobs(id) on delete cascade,
  operator_id uuid not null references auth.users(id) on delete cascade,
  source text not null default 'phone' check (source in ('phone','manual','import')),
  started_at timestamptz not null,
  ended_at timestamptz,
  points jsonb not null default '[]'::jsonb,
  distance_m double precision,
  area_acres_estimate double precision,
  label text,
  created_at timestamptz not null default now()
);

create index if not exists job_gps_tracks_job_id_idx on public.job_gps_tracks (job_id);

-- Schedule blocks (dispatch calendar)
create table if not exists public.job_schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  job_id text not null references public.jobs(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  title text not null default '',
  notes text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists job_schedule_blocks_job_id_idx on public.job_schedule_blocks (job_id);
create index if not exists job_schedule_blocks_starts_idx on public.job_schedule_blocks (starts_at);

alter table public.job_work_orders enable row level security;
alter table public.job_time_entries enable row level security;
alter table public.job_gps_tracks enable row level security;
alter table public.job_schedule_blocks enable row level security;

-- work_orders
drop policy if exists "job_work_orders_select" on public.job_work_orders;
create policy "job_work_orders_select"
on public.job_work_orders for select to authenticated
using (exists (select 1 from public.job_members jm where jm.job_id = job_work_orders.job_id and jm.user_id = auth.uid()));

drop policy if exists "job_work_orders_write_worker" on public.job_work_orders;
create policy "job_work_orders_write_worker"
on public.job_work_orders for insert to authenticated
with check (
  exists (
    select 1 from public.job_members jm
    where jm.job_id = job_work_orders.job_id and jm.user_id = auth.uid()
      and jm.role in ('owner','worker')
  )
);

drop policy if exists "job_work_orders_update_worker" on public.job_work_orders;
create policy "job_work_orders_update_worker"
on public.job_work_orders for update to authenticated
using (
  exists (
    select 1 from public.job_members jm
    where jm.job_id = job_work_orders.job_id and jm.user_id = auth.uid()
      and jm.role in ('owner','worker')
  )
);

drop policy if exists "job_work_orders_delete_owner" on public.job_work_orders;
create policy "job_work_orders_delete_owner"
on public.job_work_orders for delete to authenticated
using (
  exists (
    select 1 from public.job_members jm
    where jm.job_id = job_work_orders.job_id and jm.user_id = auth.uid() and jm.role = 'owner'
  )
);

-- time_entries
drop policy if exists "job_time_entries_select" on public.job_time_entries;
create policy "job_time_entries_select"
on public.job_time_entries for select to authenticated
using (exists (select 1 from public.job_members jm where jm.job_id = job_time_entries.job_id and jm.user_id = auth.uid()));

drop policy if exists "job_time_entries_insert_self" on public.job_time_entries;
create policy "job_time_entries_insert_self"
on public.job_time_entries for insert to authenticated
with check (
  operator_id = auth.uid()
  and exists (
    select 1 from public.job_members jm
    where jm.job_id = job_time_entries.job_id and jm.user_id = auth.uid()
      and jm.role in ('owner','worker')
  )
);

drop policy if exists "job_time_entries_update_self" on public.job_time_entries;
create policy "job_time_entries_update_self"
on public.job_time_entries for update to authenticated
using (operator_id = auth.uid());

drop policy if exists "job_time_entries_delete_self_or_owner" on public.job_time_entries;
create policy "job_time_entries_delete_self_or_owner"
on public.job_time_entries for delete to authenticated
using (
  operator_id = auth.uid()
  or exists (select 1 from public.job_members jm where jm.job_id = job_time_entries.job_id and jm.user_id = auth.uid() and jm.role = 'owner')
);

-- gps_tracks
drop policy if exists "job_gps_tracks_select" on public.job_gps_tracks;
create policy "job_gps_tracks_select"
on public.job_gps_tracks for select to authenticated
using (exists (select 1 from public.job_members jm where jm.job_id = job_gps_tracks.job_id and jm.user_id = auth.uid()));

drop policy if exists "job_gps_tracks_insert_self" on public.job_gps_tracks;
create policy "job_gps_tracks_insert_self"
on public.job_gps_tracks for insert to authenticated
with check (
  operator_id = auth.uid()
  and exists (
    select 1 from public.job_members jm
    where jm.job_id = job_gps_tracks.job_id and jm.user_id = auth.uid()
      and jm.role in ('owner','worker')
  )
);

drop policy if exists "job_gps_tracks_update_self" on public.job_gps_tracks;
create policy "job_gps_tracks_update_self"
on public.job_gps_tracks for update to authenticated
using (operator_id = auth.uid());

drop policy if exists "job_gps_tracks_delete_self_or_owner" on public.job_gps_tracks;
create policy "job_gps_tracks_delete_self_or_owner"
on public.job_gps_tracks for delete to authenticated
using (
  operator_id = auth.uid()
  or exists (select 1 from public.job_members jm where jm.job_id = job_gps_tracks.job_id and jm.user_id = auth.uid() and jm.role = 'owner')
);

-- schedule
drop policy if exists "job_schedule_blocks_select" on public.job_schedule_blocks;
create policy "job_schedule_blocks_select"
on public.job_schedule_blocks for select to authenticated
using (exists (select 1 from public.job_members jm where jm.job_id = job_schedule_blocks.job_id and jm.user_id = auth.uid()));

drop policy if exists "job_schedule_blocks_insert_worker" on public.job_schedule_blocks;
create policy "job_schedule_blocks_insert_worker"
on public.job_schedule_blocks for insert to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.job_members jm
    where jm.job_id = job_schedule_blocks.job_id and jm.user_id = auth.uid()
      and jm.role in ('owner','worker')
  )
);

drop policy if exists "job_schedule_blocks_update_worker" on public.job_schedule_blocks;
create policy "job_schedule_blocks_update_worker"
on public.job_schedule_blocks for update to authenticated
using (
  exists (
    select 1 from public.job_members jm
    where jm.job_id = job_schedule_blocks.job_id and jm.user_id = auth.uid()
      and jm.role in ('owner','worker')
  )
);

drop policy if exists "job_schedule_blocks_delete_owner" on public.job_schedule_blocks;
create policy "job_schedule_blocks_delete_owner"
on public.job_schedule_blocks for delete to authenticated
using (
  exists (
    select 1 from public.job_members jm
    where jm.job_id = job_schedule_blocks.job_id and jm.user_id = auth.uid() and jm.role = 'owner'
  )
);
