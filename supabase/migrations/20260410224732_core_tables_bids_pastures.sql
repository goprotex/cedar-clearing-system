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
