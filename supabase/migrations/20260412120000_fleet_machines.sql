-- Company-wide fleet equipment (manual entry until telematics). One row per unit; payload in `data` jsonb.

create table if not exists public.fleet_machines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fleet_machines_company_id_idx on public.fleet_machines (company_id);

alter table public.fleet_machines enable row level security;

drop policy if exists "fleet_machines_select_company" on public.fleet_machines;
create policy "fleet_machines_select_company"
  on public.fleet_machines for select to authenticated
  using (company_id = public.user_company_id());

drop policy if exists "fleet_machines_insert_company" on public.fleet_machines;
create policy "fleet_machines_insert_company"
  on public.fleet_machines for insert to authenticated
  with check (company_id = public.user_company_id());

drop policy if exists "fleet_machines_update_company" on public.fleet_machines;
create policy "fleet_machines_update_company"
  on public.fleet_machines for update to authenticated
  using (company_id = public.user_company_id())
  with check (company_id = public.user_company_id());

drop policy if exists "fleet_machines_delete_company" on public.fleet_machines;
create policy "fleet_machines_delete_company"
  on public.fleet_machines for delete to authenticated
  using (company_id = public.user_company_id());

drop trigger if exists set_fleet_machines_updated_at on public.fleet_machines;
create trigger set_fleet_machines_updated_at
  before update on public.fleet_machines
  for each row execute function public.set_updated_at();

alter table public.fleet_machines replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'fleet_machines'
     ) then
    execute 'alter publication supabase_realtime add table public.fleet_machines';
  end if;
end $$;
