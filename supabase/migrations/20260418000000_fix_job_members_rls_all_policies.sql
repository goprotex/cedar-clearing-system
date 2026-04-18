-- Comprehensive fix for "infinite recursion detected in policy for relation job_members".
--
-- Root cause: the original SELECT policy on job_members used
--   EXISTS (SELECT 1 FROM public.job_members ...)
-- which re-entered RLS on the same table, causing infinite recursion.
--
-- The INSERT / UPDATE / DELETE policies also referenced job_members from
-- within job_members policies. Once the SELECT policy was fixed the inner
-- queries no longer recurse, but to make every policy self-contained and
-- future-proof we use SECURITY DEFINER helper functions throughout.
--
-- This migration is idempotent (uses CREATE OR REPLACE + DROP POLICY IF EXISTS).

-- ─── Helper: is the given user a member of the given job? ───────────────────
-- SECURITY DEFINER so the inner query bypasses RLS on job_members and never
-- triggers this same policy recursively.
create or replace function public.user_is_job_member(p_job_id text, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.job_members jm
    where jm.job_id = p_job_id
      and jm.user_id = p_user_id
  );
$$;

grant execute on function public.user_is_job_member(text, uuid) to authenticated;

-- ─── Helper: is the given user an owner of the given job? ───────────────────
create or replace function public.user_is_job_owner(p_job_id text, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.job_members jm
    where jm.job_id = p_job_id
      and jm.user_id = p_user_id
      and jm.role = 'owner'
  );
$$;

grant execute on function public.user_is_job_owner(text, uuid) to authenticated;

-- ─── SELECT: own row OR member of the same job OR company supervisor ─────────
drop policy if exists "job_members_select_for_members" on public.job_members;
create policy "job_members_select_for_members"
on public.job_members
for select
to authenticated
using (
  user_id = auth.uid()
  or public.user_is_job_member(job_members.job_id, auth.uid())
  or (
    public.user_can_monitor_company_jobs()
    and exists (
      select 1
      from public.jobs j
      join public.bids b on b.id::text = j.bid_id
      where j.id = job_members.job_id
        and b.company_id is not null
        and b.company_id = public.user_company_id()
    )
  )
);

-- ─── INSERT: job creator adds themselves (owner), or existing owner adds others ─
drop policy if exists "job_members_insert_owner_or_self" on public.job_members;
create policy "job_members_insert_owner_or_self"
on public.job_members
for insert
to authenticated
with check (
  (
    user_id = auth.uid()
    and exists (
      select 1
      from public.jobs j
      where j.id = job_members.job_id
        and j.created_by = auth.uid()
    )
  )
  or public.user_is_job_owner(job_members.job_id, auth.uid())
);

-- ─── UPDATE: owners may change roles ────────────────────────────────────────
drop policy if exists "job_members_update_owner" on public.job_members;
create policy "job_members_update_owner"
on public.job_members
for update
to authenticated
using (public.user_is_job_owner(job_members.job_id, auth.uid()))
with check (true);

-- ─── DELETE: owners may remove members ──────────────────────────────────────
drop policy if exists "job_members_delete_owner" on public.job_members;
create policy "job_members_delete_owner"
on public.job_members
for delete
to authenticated
using (public.user_is_job_owner(job_members.job_id, auth.uid()));
