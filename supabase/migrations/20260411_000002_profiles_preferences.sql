-- App preferences stored on profile (JSON); safe defaults for RLS (user updates own row only).

alter table public.profiles
  add column if not exists preferences jsonb not null default '{}'::jsonb;
