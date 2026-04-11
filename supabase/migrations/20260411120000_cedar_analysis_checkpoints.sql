-- Partial chunked spectral analysis checkpoints (resume after refresh).
-- Written only from server routes using the service role key (bypasses RLS).

create table if not exists public.cedar_analysis_checkpoints (
  bid_id text not null,
  pasture_id text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (bid_id, pasture_id)
);

create index if not exists cedar_analysis_checkpoints_updated_at_idx
  on public.cedar_analysis_checkpoints (updated_at desc);

alter table public.cedar_analysis_checkpoints enable row level security;

-- No policies: anon/authenticated cannot read/write; service_role bypasses RLS.

comment on table public.cedar_analysis_checkpoints is
  'Stores in-progress cedar-detect chunk results for resume; keyed by bid + pasture.';
