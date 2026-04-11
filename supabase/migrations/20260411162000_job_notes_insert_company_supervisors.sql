-- Company supervisors can add notes on company jobs even if not in job_members.

drop policy if exists "job_notes_insert_company_supervisors" on public.job_notes;
create policy "job_notes_insert_company_supervisors"
on public.job_notes for insert to authenticated
with check (
  created_by = auth.uid()
  and public.user_can_monitor_company_jobs()
  and exists (
    select 1 from public.jobs j
    join public.bids b on b.id::text = j.bid_id
    where j.id = job_notes.job_id
      and b.company_id is not null
      and b.company_id = public.user_company_id()
  )
);
