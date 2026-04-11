-- Avatar on profiles; company admins (owner/manager) can update colleague profiles in same company.
-- Trigger prevents non-admins from changing their own (or anyone's) app role without privilege.
-- Storage bucket `avatars` for profile pictures.

-- ─── Profiles: avatar ────────────────────────────────────────────────────────
alter table public.profiles add column if not exists avatar_url text;

-- ─── Helpers ─────────────────────────────────────────────────────────────────
create or replace function public.user_is_company_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select p.company_id is not null
        and p.role in ('owner', 'manager')
      from public.profiles p
      where p.id = auth.uid()
    ),
    false
  );
$$;

-- Enforce role changes: only company admins; cross-company edits blocked for others' rows
create or replace function public.profiles_enforce_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_id uuid;
begin
  if new.role is distinct from old.role then
    if not public.user_is_company_admin() then
      raise exception 'Only company owners and managers can change app roles';
    end if;
    if new.id <> auth.uid() then
      c_id := public.user_company_id();
      if old.company_id is distinct from c_id or new.company_id is distinct from old.company_id then
        raise exception 'Cannot change roles outside your company roster';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_enforce_role_change on public.profiles;
create trigger trg_profiles_enforce_role_change
  before update of role on public.profiles
  for each row
  execute function public.profiles_enforce_role_change();

-- ─── RLS: allow company admins to update other profiles in same company ─────
drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists "profiles_update_company_admin" on public.profiles;
create policy "profiles_update_company_admin"
  on public.profiles for update to authenticated
  using (
    public.user_is_company_admin()
    and company_id is not null
    and company_id = public.user_company_id()
    and id <> auth.uid()
  )
  with check (
    company_id = public.user_company_id()
    and company_id is not null
  );

-- ─── Storage: avatars bucket ────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Policies on storage.objects (Supabase storage)
drop policy if exists "avatars_select_public" on storage.objects;
create policy "avatars_select_public"
  on storage.objects for select
  to public
  using (bucket_id = 'avatars');

drop policy if exists "avatars_insert_own_folder" on storage.objects;
create policy "avatars_insert_own_folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
