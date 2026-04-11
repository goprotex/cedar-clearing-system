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
