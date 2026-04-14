-- Equipment photo storage bucket + equipment checkout/return tracking table.
-- Supports fleet tracking categories, checkout telematics, and persistent photo storage.

-- ─── Storage: equipment-photos bucket ──────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'equipment-photos',
  'equipment-photos',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Public read
drop policy if exists "equip_photos_select_public" on storage.objects;
create policy "equip_photos_select_public"
  on storage.objects for select
  to public
  using (bucket_id = 'equipment-photos');

-- Authenticated users in a company can upload to their company folder
drop policy if exists "equip_photos_insert_company" on storage.objects;
create policy "equip_photos_insert_company"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'equipment-photos'
    and public.user_company_id() is not null
  );

-- Authenticated users in a company can update photos
drop policy if exists "equip_photos_update_company" on storage.objects;
create policy "equip_photos_update_company"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'equipment-photos'
    and public.user_company_id() is not null
  )
  with check (
    bucket_id = 'equipment-photos'
    and public.user_company_id() is not null
  );

-- Authenticated users can delete their company's photos
drop policy if exists "equip_photos_delete_company" on storage.objects;
create policy "equip_photos_delete_company"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'equipment-photos'
    and public.user_company_id() is not null
  );

-- ─── Equipment Checkouts ───────────────────────────────────────────────────
-- Tracks checkout/return of equipment with telematics snapshot at each event.
create table if not exists public.equipment_checkouts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  machine_id uuid not null references public.fleet_machines (id) on delete cascade,
  checked_out_by uuid not null references auth.users (id) on delete cascade,
  job_id text references public.jobs (id) on delete set null,
  status text not null default 'checked_out'
    check (status in ('checked_out', 'returned')),

  -- Telematics at checkout
  checkout_at timestamptz not null default now(),
  checkout_hours real,
  checkout_mileage real,
  checkout_fuel_level real,
  checkout_condition text
    check (checkout_condition in ('excellent', 'good', 'fair', 'poor', 'needs_repair')),
  checkout_notes text,
  checkout_location text,

  -- Telematics at return (filled when returned)
  returned_at timestamptz,
  return_hours real,
  return_mileage real,
  return_fuel_level real,
  return_condition text
    check (return_condition in ('excellent', 'good', 'fair', 'poor', 'needs_repair')),
  return_notes text,
  return_location text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists equipment_checkouts_company_id_idx on public.equipment_checkouts (company_id);
create index if not exists equipment_checkouts_machine_id_idx on public.equipment_checkouts (machine_id);
create index if not exists equipment_checkouts_checked_out_by_idx on public.equipment_checkouts (checked_out_by);
create index if not exists equipment_checkouts_status_idx on public.equipment_checkouts (status);
create index if not exists equipment_checkouts_job_id_idx on public.equipment_checkouts (job_id);

alter table public.equipment_checkouts enable row level security;

drop policy if exists "equipment_checkouts_select_company" on public.equipment_checkouts;
create policy "equipment_checkouts_select_company"
  on public.equipment_checkouts for select to authenticated
  using (company_id = public.user_company_id());

drop policy if exists "equipment_checkouts_insert_company" on public.equipment_checkouts;
create policy "equipment_checkouts_insert_company"
  on public.equipment_checkouts for insert to authenticated
  with check (company_id = public.user_company_id());

drop policy if exists "equipment_checkouts_update_company" on public.equipment_checkouts;
create policy "equipment_checkouts_update_company"
  on public.equipment_checkouts for update to authenticated
  using (company_id = public.user_company_id())
  with check (company_id = public.user_company_id());

drop policy if exists "equipment_checkouts_delete_company" on public.equipment_checkouts;
create policy "equipment_checkouts_delete_company"
  on public.equipment_checkouts for delete to authenticated
  using (company_id = public.user_company_id());

drop trigger if exists set_equipment_checkouts_updated_at on public.equipment_checkouts;
create trigger set_equipment_checkouts_updated_at
  before update on public.equipment_checkouts
  for each row execute function public.set_updated_at();

-- Enable realtime for equipment_checkouts
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'equipment_checkouts'
     ) then
    execute 'alter publication supabase_realtime add table public.equipment_checkouts';
  end if;
end $$;
