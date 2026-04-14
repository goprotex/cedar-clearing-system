-- Fix photo uploads: job_members RLS recursion on INSERT/UPDATE/DELETE + job-media policy.
--
-- Root causes addressed:
-- 1. job_members INSERT/UPDATE/DELETE policies have inline
--    EXISTS (SELECT 1 FROM job_members ...) which triggers the SELECT RLS policy,
--    causing infinite recursion. The prior fix (20260413) only patched SELECT.
-- 2. job-media INSERT policy requires job_members membership, but jobs are
--    localStorage-only so there are never any job_members rows → always fails.

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. SECURITY DEFINER helper: check if user is a job *owner* (bypasses RLS)
-- ═══════════════════════════════════════════════════════════════════════════════

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

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. Rewrite job_members INSERT policy (remove inline sub-SELECT on job_members)
-- ═══════════════════════════════════════════════════════════════════════════════

drop policy if exists "job_members_insert_owner_or_self" on public.job_members;
create policy "job_members_insert_owner_or_self"
on public.job_members
for insert
to authenticated
with check (
  -- Creator adding themselves as first member
  (
    user_id = auth.uid()
    and exists (
      select 1
      from public.jobs j
      where j.id = job_members.job_id
        and j.created_by = auth.uid()
    )
  )
  -- Existing owner adding others (uses SECURITY DEFINER to avoid recursion)
  or public.user_is_job_owner(job_members.job_id, auth.uid())
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. Rewrite job_members UPDATE policy
-- ═══════════════════════════════════════════════════════════════════════════════

drop policy if exists "job_members_update_owner" on public.job_members;
create policy "job_members_update_owner"
on public.job_members
for update
to authenticated
using (
  public.user_is_job_owner(job_members.job_id, auth.uid())
)
with check (true);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. Rewrite job_members DELETE policy
-- ═══════════════════════════════════════════════════════════════════════════════

drop policy if exists "job_members_delete_owner" on public.job_members;
create policy "job_members_delete_owner"
on public.job_members
for delete
to authenticated
using (
  public.user_is_job_owner(job_members.job_id, auth.uid())
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. Fix job-media INSERT: allow authenticated users to upload to their own
--    subfolder (path = {job_id}/{user_id}/...) without requiring job_members.
--    The job_members check is impossible while jobs live only in localStorage.
--    Company-level or membership checks can be re-added when jobs migrate to
--    Supabase.
-- ═══════════════════════════════════════════════════════════════════════════════

drop policy if exists "job_media_insert_member_path" on storage.objects;
create policy "job_media_insert_member_path"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'job-media'
    and split_part(name, '/', 2) = auth.uid()::text
  );
