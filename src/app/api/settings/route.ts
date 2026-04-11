import { NextResponse } from 'next/server';
import { createClient, getUserFromRequest } from '@/utils/supabase/server';
import type { UserAppPreferences } from '@/types/profile';
import { isCompanyAdmin } from '@/lib/company-admin';

const PROFILE_ROLES = ['owner', 'manager', 'operator', 'crew_lead', 'viewer'] as const;

export async function GET(req: Request) {
  const supabase = await createClient(req);
  const { data: auth, error: authErr } = await getUserFromRequest(supabase, req);
  if (authErr || !auth.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile, error: pErr } = await supabase
    .from('profiles')
    .select('id, full_name, role, phone, company_id, preferences, avatar_url')
    .eq('id', auth.user.id)
    .maybeSingle();

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  let companyName: string | null = null;
  if (profile?.company_id) {
    const { data: co } = await supabase.from('companies').select('name').eq('id', profile.company_id).maybeSingle();
    companyName = co?.name ?? null;
  }

  return NextResponse.json({
    email: auth.user.email ?? null,
    can_edit_own_role: await isCompanyAdmin(supabase, auth.user.id),
    profile: profile
      ? {
          full_name: profile.full_name,
          role: profile.role,
          phone: profile.phone,
          company_id: profile.company_id,
          company_name: companyName,
          avatar_url: profile.avatar_url ?? null,
          preferences: (profile.preferences as UserAppPreferences) ?? {},
        }
      : null,
  });
}

export async function PATCH(req: Request) {
  const supabase = await createClient(req);
  const { data: authData, error: authErr } = await getUserFromRequest(supabase, req);
  if (authErr || !authData.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const user = authData.user;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const b = body as {
    full_name?: string;
    phone?: string | null;
    role?: string;
    avatar_url?: string | null;
    preferences?: UserAppPreferences;
  };

  const hasField =
    typeof b.full_name === 'string' ||
    b.phone !== undefined ||
    typeof b.role === 'string' ||
    b.avatar_url !== undefined ||
    (b.preferences !== undefined && b.preferences !== null);
  if (!hasField) {
    return NextResponse.json({ error: 'No valid fields' }, { status: 400 });
  }

  const { data: current, error: curErr } = await supabase
    .from('profiles')
    .select('full_name, role, phone, preferences, avatar_url')
    .eq('id', user.id)
    .maybeSingle();
  if (curErr) return NextResponse.json({ error: curErr.message }, { status: 500 });

  const prevPrefs = (current?.preferences as Record<string, unknown> | null) ?? {};

  const defaultName = user.email?.split('@')[0]?.slice(0, 200) ?? '';

  let full_name = current?.full_name ?? defaultName;
  let role = current?.role ?? 'operator';
  let phone: string | null = current?.phone ?? null;
  let avatar_url: string | null = current?.avatar_url ?? null;
  let preferences: Record<string, unknown> = { ...prevPrefs };

  if (typeof b.full_name === 'string') {
    full_name = b.full_name.trim().slice(0, 200);
  }
  if (b.phone === null || typeof b.phone === 'string') {
    phone = b.phone === null ? null : b.phone.trim().slice(0, 40);
  }
  if (typeof b.role === 'string') {
    if (!PROFILE_ROLES.includes(b.role as (typeof PROFILE_ROLES)[number])) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }
    const admin = await isCompanyAdmin(supabase, user.id);
    if (b.role !== role && !admin) {
      return NextResponse.json(
        { error: 'Only company owners and managers can change app roles. Ask an admin or use the employee dashboard.' },
        { status: 403 },
      );
    }
    role = b.role;
  }
  if (b.avatar_url === null) {
    avatar_url = null;
  } else if (typeof b.avatar_url === 'string') {
    const u = b.avatar_url.trim();
    avatar_url = u.length ? u.slice(0, 2048) : null;
  }
  if (b.preferences !== undefined && b.preferences !== null && typeof b.preferences === 'object') {
    if (typeof b.preferences.monitor_tv_default === 'boolean') {
      preferences.monitor_tv_default = b.preferences.monitor_tv_default;
    }
  }

  const row = {
    id: user.id,
    full_name,
    role,
    phone,
    avatar_url,
    preferences,
  };

  const { error: upErr } = await supabase.from('profiles').upsert(row, { onConflict: 'id' });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
