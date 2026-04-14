-- Add approval columns to job_time_entries
-- Crew leads and job owners can approve time entries for payroll verification.

alter table public.job_time_entries
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists approved_at timestamptz;

-- Crew leads/owners can approve entries for their jobs (update approved_by, approved_at)
drop policy if exists "job_time_entries_approve" on public.job_time_entries;
create policy "job_time_entries_approve"
  on public.job_time_entries for update to authenticated
  using (
    exists (
      select 1 from public.job_members jm
      where jm.job_id = job_time_entries.job_id
        and jm.user_id = auth.uid()
        and jm.role in ('owner', 'crew_lead')
    )
  );
