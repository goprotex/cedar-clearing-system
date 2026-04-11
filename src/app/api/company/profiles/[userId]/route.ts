import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceRoleClient } from '@/utils/supabase/admin';
import { isCompanyAdmin } from '@/lib/company-admin';

const EDITABLE_ROLES = ['owner', 'manager', 'operator', 'crew_lead', 'viewer'] as const;

type Body = {
  full_name?: string;
  phone?: string | null;
  role?: string;
  avatar_url?: string | null;
  email?: string;
};

export async function PATCH(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId: targetId } = await params;
  const supabase = await createClient(req);
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const actorId = auth.user.id;

  if (!(await isCompanyAdmin(supabase, actorId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (targetId === actorId) {
    return NextResponse.json({ error: 'Use /api/settings to update your own profile' }, { status: 400 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { data: actor } = await supabase
    .from('profiles')
    .select('company_id')
    .eq('id', actorId)
    .maybeSingle();
  const { data: target } = await supabase
    .from('profiles')
    .select('company_id, role')
    .eq('id', targetId)
    .maybeSingle();

  if (!actor?.company_id || target?.company_id !== actor.company_id) {
    return NextResponse.json({ error: 'Not in your company' }, { status: 403 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.full_name === 'string') updates.full_name = body.full_name.trim().slice(0, 200);
  if (body.phone === null || typeof body.phone === 'string') {
    updates.phone = body.phone === null ? null : body.phone.trim().slice(0, 40);
  }
  if (typeof body.role === 'string') {
    if (!EDITABLE_ROLES.includes(body.role as (typeof EDITABLE_ROLES)[number])) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }
    updates.role = body.role;
  }
  if (body.avatar_url === null || typeof body.avatar_url === 'string') {
    updates.avatar_url = body.avatar_url;
  }

  if (Object.keys(updates).length > 0) {
    const { error: upErr } = await supabase.from('profiles').update(updates).eq('id', targetId);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  if (typeof body.email === 'string') {
    const email = body.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
    }
    const admin = createServiceRoleClient();
    if (!admin) {
      return NextResponse.json(
        { error: 'Email updates require SUPABASE_SERVICE_ROLE_KEY on the server.' },
        { status: 503 },
      );
    }
    const { error: emErr } = await admin.auth.admin.updateUserById(targetId, { email });
    if (emErr) return NextResponse.json({ error: emErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
