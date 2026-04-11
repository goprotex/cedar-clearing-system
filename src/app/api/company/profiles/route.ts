import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createServiceRoleClient } from '@/utils/supabase/admin';
import { isCompanyAdmin } from '@/lib/company-admin';

export type CompanyProfileRow = {
  id: string;
  full_name: string;
  role: string;
  phone: string | null;
  company_id: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
  email?: string | null;
};

/**
 * List profiles in the caller's company (owners and managers only).
 * Enriches rows with auth email when service role is available.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user?.id) {
    return NextResponse.json({ error: 'Unauthorized', profiles: [] as CompanyProfileRow[] }, { status: 401 });
  }

  if (!(await isCompanyAdmin(supabase, user.id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: me, error: meErr } = await supabase
    .from('profiles')
    .select('company_id')
    .eq('id', user.id)
    .maybeSingle();

  if (meErr) {
    return NextResponse.json({ error: meErr.message }, { status: 500 });
  }

  const companyId = me?.company_id;
  if (!companyId) {
    return NextResponse.json({ company_id: null, profiles: [] as CompanyProfileRow[] });
  }

  const { data: rows, error: listErr } = await supabase
    .from('profiles')
    .select('id, full_name, role, phone, company_id, avatar_url, created_at, updated_at')
    .eq('company_id', companyId)
    .order('full_name', { ascending: true });

  if (listErr) {
    return NextResponse.json({ error: listErr.message }, { status: 500 });
  }

  const profiles = rows ?? [];
  const ids = profiles.map((p) => p.id);
  const emailById: Record<string, string | null> = {};

  const admin = createServiceRoleClient();
  if (admin && ids.length > 0) {
    for (const id of ids) {
      const { data: u } = await admin.auth.admin.getUserById(id);
      emailById[id] = u.user?.email ?? null;
    }
  }

  return NextResponse.json({
    company_id: companyId,
    profiles: profiles.map((p) => ({
      ...p,
      email: emailById[p.id] ?? null,
    })),
  });
}
