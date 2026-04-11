-- Allow company owner/manager to update jobs (schedule + manual metrics) for company bids.

drop policy if exists "jobs_update_company_supervisors" on public.jobs;
create policy "jobs_update_company_supervisors"
on public.jobs
for update
to authenticated
using (
  public.user_can_monitor_company_jobs()
  and exists (
    select 1
    from public.bids b
    where b.id::text = bid_id
      and b.company_id is not null
      and b.company_id = public.user_company_id()
  )
)
with check (
  public.user_can_monitor_company_jobs()
  and exists (
    select 1
    from public.bids b
    where b.id::text = bid_id
      and b.company_id is not null
      and b.company_id = public.user_company_id()
  )
);
