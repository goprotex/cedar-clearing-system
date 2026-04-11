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
