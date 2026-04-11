import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { getUserCompanyId } from '@/lib/user-company';

export async function GET() {
  const supabase = await createClient();
  const ctx = await getUserCompanyId(supabase);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!ctx.companyId) {
    return NextResponse.json({ clients: [] as unknown[], needsCompany: true });
  }

  const { data, error } = await supabase
    .from('clients')
    .select(
      'id, company_id, name, email, phone, address, notes, tags, created_at, updated_at'
    )
    .eq('company_id', ctx.companyId)
    .order('name', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ clients: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const ctx = await getUserCompanyId(supabase);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!ctx.companyId) {
    return NextResponse.json(
      { error: 'Join or create a company before adding clients.' },
      { status: 400 }
    );
  }

  const body = (await req.json()) as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  const row = {
    company_id: ctx.companyId,
    name,
    email: typeof body.email === 'string' ? body.email.trim() || null : null,
    phone: typeof body.phone === 'string' ? body.phone.trim() || null : null,
    address: typeof body.address === 'string' ? body.address.trim() || null : null,
    notes: typeof body.notes === 'string' ? body.notes : null,
    preferred_clearing_method:
      typeof body.preferred_clearing_method === 'string'
        ? body.preferred_clearing_method.trim() || null
        : null,
    preferred_contact:
      typeof body.preferred_contact === 'string' ? body.preferred_contact.trim() || null : null,
    payment_terms:
      typeof body.payment_terms === 'string' ? body.payment_terms.trim() || null : null,
    referred_by: typeof body.referred_by === 'string' ? body.referred_by.trim() || null : null,
    tags: Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === 'string') : [],
  };

  const { data, error } = await supabase.from('clients').insert(row).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ client: data });
}
