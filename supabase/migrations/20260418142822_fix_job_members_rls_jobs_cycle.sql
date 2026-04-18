-- Fix remaining "infinite recursion detected in policy for relation job_members".
--
-- Root cause (still present after previous fix attempts):
--   The SELECT policy on job_members contained a third condition that queried
--   public.jobs WITH normal RLS.  The jobs_select_for_members policy in turn
--   queries public.job_members WITH normal RLS, creating the cycle:
--
--     job_members_select_for_members
--       → EXISTS (SELECT 1 FROM public.jobs …)          ← evaluated with RLS
--         → jobs_select_for_members
--           → EXISTS (SELECT 1 FROM public.job_members …) ← evaluated with RLS
--             → job_members_select_for_members  ← INFINITE RECURSION
--
-- Fix: wrap the jobs/bids lookup in a SECURITY DEFINER helper so it bypasses
-- RLS on both tables, breaking the cycle.

-- ─── Helper: does this job belong to the current user's company? ────────────
-- SECURITY DEFINER queries jobs + bids without triggering their RLS policies,
-- so no recursive policy chain is possible.
create or replace function public.job_belongs_to_user_company(p_job_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.jobs j
    join public.bids b on b.id::text = j.bid_id
    where j.id = p_job_id
      and b.company_id is not null
      and b.company_id = public.user_company_id()
  );
$$;

grant execute on function public.job_belongs_to_user_company(text) to authenticated;

-- ─── SELECT: rebuild the policy using only SECURITY DEFINER helpers ──────────
-- Every table access inside the policy now either:
--   • compares auth.uid() directly (no table query), or
--   • goes through a SECURITY DEFINER function that bypasses RLS.
-- This eliminates all possible recursive policy chains.
drop policy if exists "job_members_select_for_members" on public.job_members;
create policy "job_members_select_for_members"
on public.job_members
for select
to authenticated
using (
  -- Own row (no query needed)
  user_id = auth.uid()
  -- Any other member of the same job (SECURITY DEFINER → bypasses job_members RLS)
  or public.user_is_job_member(job_members.job_id, auth.uid())
  -- Company supervisor seeing their company's job roster (SECURITY DEFINER → bypasses jobs/bids RLS)
  or (
    public.user_can_monitor_company_jobs()
    and public.job_belongs_to_user_company(job_members.job_id)
  )
);
