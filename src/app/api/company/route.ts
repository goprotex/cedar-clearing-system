import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { isCompanyAdmin } from '@/lib/company-admin';

export type CompanyPayload = {
  id: string;
  name: string;
  logo_url: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  license_number: string | null;
  insurance_info: string | null;
};

export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile, error: pErr } = await supabase
    .from('profiles')
    .select('company_id')
    .eq('id', userId)
    .maybeSingle();
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  const companyId = profile?.company_id;
  if (!companyId) return NextResponse.json({ company: null });

  const { data: co, error: coErr } = await supabase
    .from('companies')
    .select('id, name, logo_url, address, phone, email, website, license_number, insurance_info')
    .eq('id', companyId)
    .maybeSingle();
  if (coErr) return NextResponse.json({ error: coErr.message }, { status: 500 });

  return NextResponse.json({ company: co ?? null });
}

export async function PATCH(req: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!(await isCompanyAdmin(supabase, userId))) {
    return NextResponse.json({ error: 'Forbidden — company owners and managers only' }, { status: 403 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('company_id')
    .eq('id', userId)
    .maybeSingle();
  const companyId = profile?.company_id;
  if (!companyId) return NextResponse.json({ error: 'No company linked to your profile' }, { status: 400 });

  let body: Partial<{
    name: string;
    logo_url: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    license_number: string | null;
    insurance_info: string | null;
  }>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.name === 'string' && body.name.trim()) updates.name = body.name.trim().slice(0, 200);
  if ('logo_url' in body) updates.logo_url = body.logo_url ?? null;
  if ('address' in body) updates.address = typeof body.address === 'string' ? body.address.trim().slice(0, 500) || null : null;
  if ('phone' in body) updates.phone = typeof body.phone === 'string' ? body.phone.trim().slice(0, 50) || null : null;
  if ('email' in body) updates.email = typeof body.email === 'string' ? body.email.trim().slice(0, 200) || null : null;
  if ('website' in body) updates.website = typeof body.website === 'string' ? body.website.trim().slice(0, 200) || null : null;
  if ('license_number' in body) updates.license_number = typeof body.license_number === 'string' ? body.license_number.trim().slice(0, 100) || null : null;
  if ('insurance_info' in body) updates.insurance_info = typeof body.insurance_info === 'string' ? body.insurance_info.trim().slice(0, 500) || null : null;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields' }, { status: 400 });
  }

  const { data: co, error } = await supabase
    .from('companies')
    .update(updates)
    .eq('id', companyId)
    .select('id, name, logo_url, address, phone, email, website, license_number, insurance_info')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ company: co });
}
