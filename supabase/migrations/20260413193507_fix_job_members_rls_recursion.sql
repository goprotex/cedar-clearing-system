-- Fix "infinite recursion detected in policy for relation job_members".
-- The SELECT policy used EXISTS (SELECT ... FROM job_members ...), which re-entered
-- RLS on the same table. Use a SECURITY DEFINER helper so membership checks do not recurse.

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
