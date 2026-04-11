-- Job team invites: owners invite by email; invitees accept with a secret link (hashed token).

create table if not exists public.job_invites (
  id uuid primary key default gen_random_uuid(),
  job_id text not null references public.jobs(id) on delete cascade,
  email text not null,
  role text not null default 'worker' check (role in ('worker','viewer')),
  token_hash text not null,
  invited_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null
);

create unique index if not exists job_invites_token_hash_idx on public.job_invites (token_hash);

-- One pending invite per job + email (case-insensitive)
create unique index if not exists job_invites_pending_job_email_idx
  on public.job_invites (job_id, lower(email))
  where accepted_at is null;

create index if not exists job_invites_job_id_idx on public.job_invites (job_id);

alter table public.job_invites enable row level security;

drop policy if exists "job_invites_select_owners" on public.job_invites;
create policy "job_invites_select_owners"
on public.job_invites
for select
to authenticated
using (
  exists (
    select 1
    from public.job_members jm
    where jm.job_id = job_invites.job_id
      and jm.user_id = auth.uid()
      and jm.role = 'owner'
  )
);

drop policy if exists "job_invites_insert_owners" on public.job_invites;
create policy "job_invites_insert_owners"
on public.job_invites
for insert
to authenticated
with check (
  exists (
    select 1
    from public.job_members jm
    where jm.job_id = job_invites.job_id
      and jm.user_id = auth.uid()
      and jm.role = 'owner'
  )
  and invited_by = auth.uid()
);

drop policy if exists "job_invites_delete_owners" on public.job_invites;
create policy "job_invites_delete_owners"
on public.job_invites
for delete
to authenticated
using (
  exists (
    select 1
    from public.job_members jm
    where jm.job_id = job_invites.job_id
      and jm.user_id = auth.uid()
      and jm.role = 'owner'
  )
);

-- Accept invite: validates token + logged-in user email matches invite.
create or replace function public.accept_job_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  r public.job_invites%rowtype;
  v_email text;
begin
  if p_token is null or length(trim(p_token)) < 16 then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  v_hash := encode(digest(trim(p_token), 'sha256'), 'hex');

  select * into r
  from public.job_invites
  where token_hash = v_hash
    and accepted_at is null
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_or_used');
  end if;

  if r.expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  v_email := (select email from auth.users where id = auth.uid());
  if v_email is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if lower(trim(v_email)) is distinct from lower(trim(r.email)) then
    return jsonb_build_object('ok', false, 'error', 'email_mismatch');
  end if;

  insert into public.job_members (job_id, user_id, role)
  values (r.job_id, auth.uid(), r.role)
  on conflict (job_id, user_id) do update
    set role = excluded.role;

  update public.job_invites
  set accepted_at = now(), accepted_by = auth.uid()
  where id = r.id;

  return jsonb_build_object(
    'ok', true,
    'job_id', r.job_id,
    'bid_id', (select j.bid_id from public.jobs j where j.id = r.job_id limit 1)
  );
end;
$$;

revoke all on function public.accept_job_invite(text) from public;
grant execute on function public.accept_job_invite(text) to authenticated;

-- Roster with emails (members only; reads auth.users inside security definer).
create or replace function public.get_job_team(p_job_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.job_members jm
    where jm.job_id = p_job_id and jm.user_id = auth.uid()
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

revoke all on function public.get_job_team(text) from public;
grant execute on function public.get_job_team(text) to authenticated;

-- Pending invites (owners only).
create or replace function public.get_job_invites_pending(p_job_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.job_members jm
    where jm.job_id = p_job_id and jm.user_id = auth.uid() and jm.role = 'owner'
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

revoke all on function public.get_job_invites_pending(text) from public;
grant execute on function public.get_job_invites_pending(text) to authenticated;
