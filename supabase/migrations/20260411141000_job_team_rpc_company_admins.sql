-- Allow company owners/managers to load job team + invites for company jobs (same bid company).

create or replace function public.get_job_team(p_job_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    exists (
      select 1 from public.job_members jm
      where jm.job_id = p_job_id and jm.user_id = auth.uid()
    )
    or (
      public.user_is_company_admin()
      and exists (
        select 1
        from public.jobs j
        join public.bids b on b.id::text = j.bid_id
        where j.id = p_job_id
          and b.company_id is not null
          and b.company_id = public.user_company_id()
      )
    )
  ) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  return jsonb_build_object(
    'ok', true,
    'members', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'user_id', jm.user_id,
          'role', jm.role,
          'email', au.email,
          'created_at', jm.created_at
        )
        order by jm.created_at
      )
      from public.job_members jm
      join auth.users au on au.id = jm.user_id
      where jm.job_id = p_job_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_job_invites_pending(p_job_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    exists (
      select 1 from public.job_members jm
      where jm.job_id = p_job_id and jm.user_id = auth.uid() and jm.role = 'owner'
    )
    or (
      public.user_is_company_admin()
      and exists (
        select 1
        from public.jobs j
        join public.bids b on b.id::text = j.bid_id
        where j.id = p_job_id
          and b.company_id is not null
          and b.company_id = public.user_company_id()
      )
    )
  ) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  return jsonb_build_object(
    'ok', true,
    'invites', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', ji.id,
          'email', ji.email,
          'role', ji.role,
          'created_at', ji.created_at,
          'expires_at', ji.expires_at
        )
        order by ji.created_at desc
      )
      from public.job_invites ji
      where ji.job_id = p_job_id and ji.accepted_at is null
    ), '[]'::jsonb)
  );
end;
$$;
