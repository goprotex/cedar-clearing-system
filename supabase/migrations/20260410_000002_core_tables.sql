-- Core platform tables: companies, profiles, clients, properties, bids, pastures, caches
-- This builds the multi-tenant data layer for persisting bids in Supabase
-- instead of localStorage.

-- ─── Companies ───────────────────────────────────────────────────────────────

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  logo_url text,
  address text,
  phone text,
  email text,
  website text,
  license_number text,
  insurance_info text,
  terms_and_conditions text,
  rate_card jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.companies enable row level security;

-- ─── Profiles (linked to Supabase Auth) ──────────────────────────────────────

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  full_name text not null default '',
  role text not null default 'operator'
    check (role in ('owner','operator','crew_lead','viewer')),
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_company_id_idx on public.profiles (company_id);

alter table public.profiles enable row level security;

-- ─── Clients ─────────────────────────────────────────────────────────────────

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  address text,
  preferred_clearing_method text,
  preferred_contact text,
  payment_terms text,
  notes text,
  tags text[] default '{}',
  referred_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists clients_company_id_idx on public.clients (company_id);

alter table public.clients enable row level security;

-- ─── Properties ──────────────────────────────────────────────────────────────

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  name text,
  address text,
  total_acres real,
  gate_code text,
  access_notes text,
  center jsonb,
  boundary jsonb,
  soil_summary text,
  terrain_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists properties_client_id_idx on public.properties (client_id);
create index if not exists properties_company_id_idx on public.properties (company_id);

alter table public.properties enable row level security;

-- ─── Bids ────────────────────────────────────────────────────────────────────

create table if not exists public.bids (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  bid_number text not null,
  status text not null default 'draft'
    check (status in ('draft','sent','accepted','declined','expired')),
  client_name text not null default '',
  client_email text default '',
  client_phone text default '',
  client_address text default '',
  property_name text default '',
  property_address text default '',
  property_center jsonb,
  map_zoom real default 14,
  total_acreage real default 0,
  total_amount numeric(12,2) default 0,
  estimated_days_low real default 0,
  estimated_days_high real default 0,
  mobilization_fee numeric(10,2) default 0,
  burn_permit_fee numeric(10,2) default 0,
  custom_line_items jsonb not null default '[]',
  contingency_pct real default 0,
  discount_pct real default 0,
  notes text default '',
  valid_until date,
  rate_card_snapshot jsonb,
  ai_confidence_score real,
  prediction_model_version integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bids_company_id_idx on public.bids (company_id);
create index if not exists bids_created_by_idx on public.bids (created_by);
create index if not exists bids_status_idx on public.bids (status);
create index if not exists bids_client_id_idx on public.bids (client_id);

alter table public.bids enable row level security;

-- ─── Pastures ────────────────────────────────────────────────────────────────

create table if not exists public.pastures (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid not null references public.bids(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  polygon jsonb not null,
  acreage real not null default 0,
  centroid jsonb,
  vegetation_type text not null default 'cedar',
  density text not null default 'moderate',
  terrain text not null default 'rolling',
  clearing_method text not null default 'rough_mulch',
  disposal_method text not null default 'mulch_in_place',
  method_options jsonb default '{}',
  -- Soil
  soil_data jsonb,
  soil_multiplier real default 1.0,
  soil_multiplier_override real,
  -- Elevation
  elevation_ft real,
  -- AI / Cedar analysis
  cedar_analysis jsonb,
  seasonal_analysis jsonb,
  ai_density_score real,
  ai_cedar_coverage_pct real,
  ai_oak_coverage_pct real,
  ai_tree_count jsonb,
  ai_heatmap_url text,
  ai_tree_positions jsonb,
  -- Drone
  drone_survey_id uuid,
  drone_verified boolean default false,
  -- Predictions
  estimated_hrs_per_acre real default 1.0,
  predicted_hrs_per_acre real,
  prediction_confidence real,
  -- Method-specific adders
  adders jsonb not null default '[]',
  -- Marked trees
  saved_trees jsonb not null default '[]',
  -- Financial
  subtotal numeric(10,2) default 0,
  method_multiplier real default 1.0,
  notes text default '',
  created_at timestamptz not null default now()
);

create index if not exists pastures_bid_id_idx on public.pastures (bid_id);

alter table public.pastures enable row level security;

-- ─── Soil Cache ──────────────────────────────────────────────────────────────

create table if not exists public.soil_cache (
  id uuid primary key default gen_random_uuid(),
  polygon_hash text unique not null,
  soil_data jsonb not null,
  queried_at timestamptz not null default now()
);

create index if not exists soil_cache_hash_idx on public.soil_cache (polygon_hash);

alter table public.soil_cache enable row level security;

-- ─── Imagery Cache ───────────────────────────────────────────────────────────

create table if not exists public.imagery_cache (
  id uuid primary key default gen_random_uuid(),
  polygon_hash text not null,
  source text not null,
  imagery_date date,
  analysis_result jsonb,
  image_url text,
  fetched_at timestamptz not null default now(),
  unique(polygon_hash, source)
);

create index if not exists imagery_cache_hash_idx on public.imagery_cache (polygon_hash);

alter table public.imagery_cache enable row level security;

-- ─── PDF Versions ────────────────────────────────────────────────────────────

create table if not exists public.pdf_versions (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid references public.bids(id) on delete cascade,
  job_id text,
  type text not null default 'bid'
    check (type in ('bid','progress_report','invoice')),
  version integer not null default 1,
  file_url text not null,
  generated_at timestamptz not null default now()
);

create index if not exists pdf_versions_bid_id_idx on public.pdf_versions (bid_id);

alter table public.pdf_versions enable row level security;

-- ═══════════════════════════════════════════════════════════════════════════════
-- RLS Policies
-- ═══════════════════════════════════════════════════════════════════════════════
-- Multi-tenant isolation: users see only their own company's data.
-- Bids also support "personal" mode (company_id IS NULL) where created_by owns.

-- Helper: get the company_id for the current user
create or replace function public.user_company_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select company_id from public.profiles where id = auth.uid()
$$;

-- ─── Companies ───────────────────────────────────────────────────────────────

create policy "companies_select_own"
  on public.companies for select to authenticated
  using (id = public.user_company_id());

create policy "companies_update_own"
  on public.companies for update to authenticated
  using (id = public.user_company_id())
  with check (id = public.user_company_id());

create policy "companies_insert_authenticated"
  on public.companies for insert to authenticated
  with check (true);

-- ─── Profiles ────────────────────────────────────────────────────────────────

create policy "profiles_select_own"
  on public.profiles for select to authenticated
  using (id = auth.uid() or company_id = public.user_company_id());

create policy "profiles_update_self"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "profiles_insert_self"
  on public.profiles for insert to authenticated
  with check (id = auth.uid());

-- ─── Clients ─────────────────────────────────────────────────────────────────

create policy "clients_select_company"
  on public.clients for select to authenticated
  using (company_id = public.user_company_id());

create policy "clients_insert_company"
  on public.clients for insert to authenticated
  with check (company_id = public.user_company_id());

create policy "clients_update_company"
  on public.clients for update to authenticated
  using (company_id = public.user_company_id())
  with check (company_id = public.user_company_id());

create policy "clients_delete_company"
  on public.clients for delete to authenticated
  using (company_id = public.user_company_id());

-- ─── Properties ──────────────────────────────────────────────────────────────

create policy "properties_select_company"
  on public.properties for select to authenticated
  using (company_id = public.user_company_id());

create policy "properties_insert_company"
  on public.properties for insert to authenticated
  with check (company_id = public.user_company_id());

create policy "properties_update_company"
  on public.properties for update to authenticated
  using (company_id = public.user_company_id())
  with check (company_id = public.user_company_id());

create policy "properties_delete_company"
  on public.properties for delete to authenticated
  using (company_id = public.user_company_id());

-- ─── Bids ────────────────────────────────────────────────────────────────────
-- Bids can belong to a company (company_id set) or be personal (company_id IS NULL, owned by created_by).

create policy "bids_select_own"
  on public.bids for select to authenticated
  using (
    created_by = auth.uid()
    or company_id = public.user_company_id()
  );

create policy "bids_insert_own"
  on public.bids for insert to authenticated
  with check (
    created_by = auth.uid()
  );

create policy "bids_update_own"
  on public.bids for update to authenticated
  using (
    created_by = auth.uid()
    or company_id = public.user_company_id()
  )
  with check (
    created_by = auth.uid()
    or company_id = public.user_company_id()
  );

create policy "bids_delete_own"
  on public.bids for delete to authenticated
  using (
    created_by = auth.uid()
    or company_id = public.user_company_id()
  );

-- ─── Pastures ────────────────────────────────────────────────────────────────
-- Access follows the parent bid.

create policy "pastures_select_via_bid"
  on public.pastures for select to authenticated
  using (
    exists (
      select 1 from public.bids b
      where b.id = pastures.bid_id
        and (b.created_by = auth.uid() or b.company_id = public.user_company_id())
    )
  );

create policy "pastures_insert_via_bid"
  on public.pastures for insert to authenticated
  with check (
    exists (
      select 1 from public.bids b
      where b.id = pastures.bid_id
        and (b.created_by = auth.uid() or b.company_id = public.user_company_id())
    )
  );

create policy "pastures_update_via_bid"
  on public.pastures for update to authenticated
  using (
    exists (
      select 1 from public.bids b
      where b.id = pastures.bid_id
        and (b.created_by = auth.uid() or b.company_id = public.user_company_id())
    )
  )
  with check (
    exists (
      select 1 from public.bids b
      where b.id = pastures.bid_id
        and (b.created_by = auth.uid() or b.company_id = public.user_company_id())
    )
  );

create policy "pastures_delete_via_bid"
  on public.pastures for delete to authenticated
  using (
    exists (
      select 1 from public.bids b
      where b.id = pastures.bid_id
        and (b.created_by = auth.uid() or b.company_id = public.user_company_id())
    )
  );

-- ─── Soil Cache ──────────────────────────────────────────────────────────────
-- Soil data is public/shared — anyone authenticated can read and write cache entries.

create policy "soil_cache_select_all"
  on public.soil_cache for select to authenticated
  using (true);

create policy "soil_cache_insert_all"
  on public.soil_cache for insert to authenticated
  with check (true);

-- ─── Imagery Cache ───────────────────────────────────────────────────────────

create policy "imagery_cache_select_all"
  on public.imagery_cache for select to authenticated
  using (true);

create policy "imagery_cache_insert_all"
  on public.imagery_cache for insert to authenticated
  with check (true);

-- ─── PDF Versions ────────────────────────────────────────────────────────────

create policy "pdf_versions_select_via_bid"
  on public.pdf_versions for select to authenticated
  using (
    bid_id is null
    or exists (
      select 1 from public.bids b
      where b.id = pdf_versions.bid_id
        and (b.created_by = auth.uid() or b.company_id = public.user_company_id())
    )
  );

create policy "pdf_versions_insert_via_bid"
  on public.pdf_versions for insert to authenticated
  with check (
    bid_id is null
    or exists (
      select 1 from public.bids b
      where b.id = pdf_versions.bid_id
        and (b.created_by = auth.uid() or b.company_id = public.user_company_id())
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════════
-- Auto-create profile on signup
-- ═══════════════════════════════════════════════════════════════════════════════

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email, '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ═══════════════════════════════════════════════════════════════════════════════
-- updated_at auto-touch trigger (reusable)
-- ═══════════════════════════════════════════════════════════════════════════════

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_companies_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger set_clients_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

create trigger set_properties_updated_at
  before update on public.properties
  for each row execute function public.set_updated_at();

create trigger set_bids_updated_at
  before update on public.bids
  for each row execute function public.set_updated_at();
