-- Job progress dates, manual machine hours / fuel (until telemetry), job notes with attachments.
-- Storage bucket job-media for photos (path: {job_id}/{user_id}/...)

-- ─── Jobs: schedule + manual ops metrics ─────────────────────────────────────
alter table public.jobs add column if not exists work_started_at timestamptz;
alter table public.jobs add column if not exists work_completed_at timestamptz;
alter table public.jobs add column if not exists manual_machine_hours double precision;
alter table public.jobs add column if not exists manual_fuel_gallons double precision;

comment on column public.jobs.work_started_at is 'When field work began (ops board)';
comment on column public.jobs.work_completed_at is 'When field work ended (ops board)';
comment on column public.jobs.manual_machine_hours is 'Cumulative machine hours (manual until telemetry)';
comment on column public.jobs.manual_fuel_gallons is 'Fuel used in gallons (manual until telemetry)';

-- ─── Job notes ───────────────────────────────────────────────────────────────
create table if not exists public.job_notes (
  id uuid primary key default gen_random_uuid(),
  job_id text not null references public.jobs(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  body text not null default '',
  attachments jsonb not null default '[]'::jsonb
);

create index if not exists job_notes_job_id_created_at_idx on public.job_notes (job_id, created_at desc);

alter table public.job_notes enable row level security;

drop policy if exists "job_notes_select_members" on public.job_notes;
create policy "job_notes_select_members"
on public.job_notes for select to authenticated
using (
  exists (
    select 1 from public.job_members jm
    where jm.job_id = job_notes.job_id and jm.user_id = auth.uid()
  )
  or (
    public.user_can_monitor_company_jobs()
    and exists (
      select 1 from public.jobs j
      join public.bids b on b.id::text = j.bid_id
      where j.id = job_notes.job_id
        and b.company_id is not null
        and b.company_id = public.user_company_id()
    )
  )
);

drop policy if exists "job_notes_insert_members" on public.job_notes;
create policy "job_notes_insert_members"
on public.job_notes for insert to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.job_members jm
    where jm.job_id = job_notes.job_id and jm.user_id = auth.uid()
  )
);

drop policy if exists "job_notes_update_own_or_admin" on public.job_notes;
create policy "job_notes_update_own_or_admin"
on public.job_notes for update to authenticated
using (
  created_by = auth.uid()
  or exists (
    select 1 from public.job_members jm
    where jm.job_id = job_notes.job_id and jm.user_id = auth.uid() and jm.role = 'owner'
  )
  or (
    public.user_is_company_admin()
    and exists (
      select 1 from public.jobs j
      join public.bids b on b.id::text = j.bid_id
      where j.id = job_notes.job_id
        and b.company_id is not null
        and b.company_id = public.user_company_id()
    )
  )
)
with check (job_id = job_id);

drop policy if exists "job_notes_delete_own_or_admin" on public.job_notes;
create policy "job_notes_delete_own_or_admin"
on public.job_notes for delete to authenticated
using (
  created_by = auth.uid()
  or exists (
    select 1 from public.job_members jm
    where jm.job_id = job_notes.job_id and jm.user_id = auth.uid() and jm.role = 'owner'
  )
  or (
    public.user_is_company_admin()
    and exists (
      select 1 from public.jobs j
      join public.bids b on b.id::text = j.bid_id
      where j.id = job_notes.job_id
        and b.company_id is not null
        and b.company_id = public.user_company_id()
    )
  )
);

drop trigger if exists set_job_notes_updated_at on public.job_notes;
create trigger set_job_notes_updated_at
  before update on public.job_notes
  for each row execute function public.set_updated_at();

-- Extend jobs update: members can set progress fields (already have jobs_update_for_members)
-- Company supervisors already have broader access via existing pattern — add policy for manual fields only if needed.
-- jobs_update_for_members uses WITH CHECK (true) so manual columns are covered for members.

-- Realtime for notes (optional)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'job_notes'
  ) then
    alter publication supabase_realtime add table public.job_notes;
  end if;
end $$;

alter table if exists public.job_notes replica identity full;

-- ─── Storage: job photos ─────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'job-media',
  'job-media',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "job_media_select_public" on storage.objects;
create policy "job_media_select_public"
  on storage.objects for select to public
  using (bucket_id = 'job-media');

drop policy if exists "job_media_insert_member_path" on storage.objects;
create policy "job_media_insert_member_path"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'job-media'
    and split_part(name, '/', 2) = auth.uid()::text
    and exists (
      select 1 from public.job_members jm
      where jm.job_id = split_part(name, '/', 1)
        and jm.user_id = auth.uid()
    )
  );

drop policy if exists "job_media_update_own" on storage.objects;
create policy "job_media_update_own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'job-media'
    and split_part(name, '/', 2) = auth.uid()::text
  )
  with check (
    bucket_id = 'job-media'
    and split_part(name, '/', 2) = auth.uid()::text
  );

drop policy if exists "job_media_delete_own" on storage.objects;
create policy "job_media_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'job-media'
    and split_part(name, '/', 2) = auth.uid()::text
  );
