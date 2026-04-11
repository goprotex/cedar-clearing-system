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
};

/** List profiles in the caller's company (owners and managers only). */
export async function GET(req: Request) {
  const supabase = await createClient(req);
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!(await isCompanyAdmin(supabase, auth.user.id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: me } = await supabase
    .from('profiles')
    .select('company_id')
    .eq('id', auth.user.id)
    .maybeSingle();
  const companyId = me?.company_id;
  if (!companyId) {
    return NextResponse.json({ profiles: [] as CompanyProfileRow[] });
  }

  const { data: rows, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, phone, company_id, avatar_url, created_at')
    .eq('company_id', companyId)
    .order('full_name', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

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
    profiles: profiles.map((p) => ({
      ...p,
      email: emailById[p.id] ?? null,
    })),
  });
}
