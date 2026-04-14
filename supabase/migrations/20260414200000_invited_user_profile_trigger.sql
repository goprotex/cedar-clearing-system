-- Migration: handle_invited_user_profile
-- When a user signs up via auth.admin.inviteUserByEmail(), their raw_user_meta_data
-- contains { company_id, role, full_name, invited_by }. This trigger auto-creates
-- the profile row with the correct company link so the invited user is immediately
-- part of the team.

create or replace function public.handle_invited_user_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_role text;
  v_full_name text;
begin
  -- Only fire on INSERT (new user creation)
  if tg_op <> 'INSERT' then
    return new;
  end if;

  -- Extract invite metadata from raw_user_meta_data
  v_company_id := (new.raw_user_meta_data ->> 'company_id')::uuid;
  v_role := coalesce(new.raw_user_meta_data ->> 'role', 'operator');
  v_full_name := new.raw_user_meta_data ->> 'full_name';

  -- Only proceed if company_id was set (i.e. this was a company invite)
  if v_company_id is null then
    return new;
  end if;

  -- Validate company exists
  if not exists (select 1 from public.companies where id = v_company_id) then
    return new;
  end if;

  -- Upsert profile — if the API already created one, update it; otherwise insert
  insert into public.profiles (id, company_id, role, full_name)
  values (new.id, v_company_id, v_role, v_full_name)
  on conflict (id) do update set
    company_id = coalesce(excluded.company_id, public.profiles.company_id),
    role = coalesce(excluded.role, public.profiles.role),
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    updated_at = now();

  return new;
end;
$$;

-- Create trigger on auth.users (only if it doesn't already exist)
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'on_auth_user_created_link_company'
    and tgrelid = 'auth.users'::regclass
  ) then
    create trigger on_auth_user_created_link_company
      after insert on auth.users
      for each row
      execute function public.handle_invited_user_signup();
  end if;
end;
$$;
