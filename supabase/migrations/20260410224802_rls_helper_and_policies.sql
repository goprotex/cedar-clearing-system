-- ═══════════════════════════════════════════════════════════════════════════════
-- RLS Policies
-- ═══════════════════════════════════════════════════════════════════════════════
-- Multi-tenant isolation: users see only their own company's data.
-- Bids also support "personal" mode (company_id IS NULL) where created_by owns.

-- Helper: get the company_id for the current user
create or replace function public.user_company_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select company_id from public.profiles where id = auth.uid()
$$;

-- ─── Companies ───────────────────────────────────────────────────────────────

create policy "companies_select_own"
  on public.companies for select to authenticated
  using (id = public.user_company_id());

create policy "companies_update_own"
  on public.companies for update to authenticated
  using (id = public.user_company_id())
  with check (id = public.user_company_id());

create policy "companies_insert_authenticated"
  on public.companies for insert to authenticated
  with check (true);

-- ─── Profiles ────────────────────────────────────────────────────────────────

create policy "profiles_select_own"
  on public.profiles for select to authenticated
  using (id = auth.uid() or company_id = public.user_company_id());

create policy "profiles_update_self"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "profiles_insert_self"
  on public.profiles for insert to authenticated
  with check (id = auth.uid());

-- ─── Clients ─────────────────────────────────────────────────────────────────

create policy "clients_select_company"
  on public.clients for select to authenticated
  using (company_id = public.user_company_id());

create policy "clients_insert_company"
  on public.clients for insert to authenticated
  with check (company_id = public.user_company_id());

create policy "clients_update_company"
  on public.clients for update to authenticated
  using (company_id = public.user_company_id())
  with check (company_id = public.user_company_id());

create policy "clients_delete_company"
  on public.clients for delete to authenticated
  using (company_id = public.user_company_id());

-- ─── Properties ──────────────────────────────────────────────────────────────

create policy "properties_select_company"
  on public.properties for select to authenticated
  using (company_id = public.user_company_id());

create policy "properties_insert_company"
  on public.properties for insert to authenticated
  with check (company_id = public.user_company_id());

create policy "properties_update_company"
  on public.properties for update to authenticated
  using (company_id = public.user_company_id())
  with check (company_id = public.user_company_id());

create policy "properties_delete_company"
  on public.properties for delete to authenticated
  using (company_id = public.user_company_id());

-- ─── Bids ────────────────────────────────────────────────────────────────────
-- Bids can belong to a company (company_id set) or be personal (company_id IS NULL, owned by created_by).

create policy "bids_select_own"
  on public.bids for select to authenticated
  using (
    created_by = auth.uid()
    or company_id = public.user_company_id()
  );

create policy "bids_insert_own"
  on public.bids for insert to authenticated
  with check (
    created_by = auth.uid()
  );

create policy "bids_update_own"
  on public.bids for update to authenticated
  using (
    created_by = auth.uid()
    or company_id = public.user_company_id()
  )
  with check (
    created_by = auth.uid()
    or company_id = public.user_company_id()
  );

create policy "bids_delete_own"
  on public.bids for delete to authenticated
  using (
    created_by = auth.uid()
    or company_id = public.user_company_id()
  );

-- ─── Pastures ────────────────────────────────────────────────────────────────
-- Access follows the parent bid.

create policy "pastures_select_via_bid"
  on public.pastures for select to authenticated
  using (
    exists (
      select 1 from public.bids b
      where b.id = pastures.bid_id
        and (b.created_by = auth.uid() or b.company_id = public.user_company_id())
    )
  );

create policy "pastures_insert_via_bid"
  on public.pastures for insert to authenticated
  with check (
    exists (
      select 1 from public.bids b
      where b.id = pastures.bid_id
        and (b.created_by = auth.uid() or b.company_id = public.user_company_id())
    )
  );

create policy "pastures_update_via_bid"
  on public.pastures for update to authenticated
  using (
    exists (
      select 1 from public.bids b
      where b.id = pastures.bid_id
        and (b.created_by = auth.uid() or b.company_id = public.user_company_id())
    )
  )
  with check (
    exists (
      select 1 from public.bids b
      where b.id = pastures.bid_id
        and (b.created_by = auth.uid() or b.company_id = public.user_company_id())
    )
  );

create policy "pastures_delete_via_bid"
  on public.pastures for delete to authenticated
  using (
    exists (
      select 1 from public.bids b
      where b.id = pastures.bid_id
        and (b.created_by = auth.uid() or b.company_id = public.user_company_id())
    )
  );

-- ─── Soil Cache ──────────────────────────────────────────────────────────────
-- Soil data is public/shared — anyone authenticated can read and write cache entries.

create policy "soil_cache_select_all"
  on public.soil_cache for select to authenticated
  using (true);

create policy "soil_cache_insert_all"
  on public.soil_cache for insert to authenticated
  with check (true);

-- ─── Imagery Cache ───────────────────────────────────────────────────────────

create policy "imagery_cache_select_all"
  on public.imagery_cache for select to authenticated
  using (true);

create policy "imagery_cache_insert_all"
  on public.imagery_cache for insert to authenticated
  with check (true);

-- ─── PDF Versions ────────────────────────────────────────────────────────────

create policy "pdf_versions_select_via_bid"
  on public.pdf_versions for select to authenticated
  using (
    bid_id is null
    or exists (
      select 1 from public.bids b
      where b.id = pdf_versions.bid_id
        and (b.created_by = auth.uid() or b.company_id = public.user_company_id())
    )
  );

create policy "pdf_versions_insert_via_bid"
  on public.pdf_versions for insert to authenticated
  with check (
    bid_id is null
    or exists (
      select 1 from public.bids b
      where b.id = pdf_versions.bid_id
        and (b.created_by = auth.uid() or b.company_id = public.user_company_id())
    )
  );
