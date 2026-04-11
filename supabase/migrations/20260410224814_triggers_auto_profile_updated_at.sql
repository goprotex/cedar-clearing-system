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
