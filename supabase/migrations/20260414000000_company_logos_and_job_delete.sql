-- Company logos storage bucket + job delete policy.

-- ─── Storage: company-logos bucket ──────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'company-logos',
  'company-logos',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Public read access
drop policy if exists "company_logos_select_public" on storage.objects;
create policy "company_logos_select_public"
  on storage.objects for select
  to public
  using (bucket_id = 'company-logos');

-- Company admins (owner/manager) can upload to their company folder ({company_id}/...)
drop policy if exists "company_logos_insert_admin" on storage.objects;
create policy "company_logos_insert_admin"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'company-logos'
    and public.user_is_company_admin()
    and (storage.foldername(name))[1] = (public.user_company_id())::text
  );

drop policy if exists "company_logos_update_admin" on storage.objects;
create policy "company_logos_update_admin"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'company-logos'
    and public.user_is_company_admin()
    and (storage.foldername(name))[1] = (public.user_company_id())::text
  )
  with check (
    bucket_id = 'company-logos'
    and public.user_is_company_admin()
    and (storage.foldername(name))[1] = (public.user_company_id())::text
  );

drop policy if exists "company_logos_delete_admin" on storage.objects;
create policy "company_logos_delete_admin"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'company-logos'
    and public.user_is_company_admin()
    and (storage.foldername(name))[1] = (public.user_company_id())::text
  );

-- ─── Jobs: delete policy ─────────────────────────────────────────────────────
-- Company admins (owner/manager) can delete any job in their company (via bid link).
-- Job owners (role='owner' in job_members) can delete jobs they own.

drop policy if exists "jobs_delete_owner" on public.jobs;
create policy "jobs_delete_owner"
  on public.jobs for delete
  to authenticated
  using (
    exists (
      select 1 from public.job_members jm
      where jm.job_id = jobs.id
        and jm.user_id = auth.uid()
        and jm.role = 'owner'
    )
    or (
      public.user_is_company_admin()
      and exists (
        select 1 from public.jobs j2
        join public.bids b on b.id::text = j2.bid_id
        where j2.id = jobs.id
          and b.company_id is not null
          and b.company_id = public.user_company_id()
      )
    )
  );
