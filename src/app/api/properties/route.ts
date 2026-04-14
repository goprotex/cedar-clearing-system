import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { getUserCompanyId } from '@/lib/user-company';

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const ctx = await getUserCompanyId(supabase);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!ctx.companyId) {
    return NextResponse.json({ properties: [], needsCompany: true });
  }

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('client_id');

  let query = supabase
    .from('properties')
    .select(
      'id, client_id, company_id, name, address, total_acres, gate_code, access_notes, center, boundary, soil_summary, terrain_notes, created_at, updated_at'
    )
    .eq('company_id', ctx.companyId)
    .order('name', { ascending: true });

  if (clientId) {
    query = query.eq('client_id', clientId);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ properties: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const ctx = await getUserCompanyId(supabase);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!ctx.companyId) {
    return NextResponse.json(
      { error: 'Join or create a company before adding properties.' },
      { status: 400 }
    );
  }

  const body = (await req.json()) as Record<string, unknown>;
  const clientId = typeof body.client_id === 'string' ? body.client_id.trim() : '';
  if (!clientId) {
    return NextResponse.json({ error: 'client_id is required' }, { status: 400 });
  }

  // Verify the client belongs to this company
  const { data: client, error: clientErr } = await supabase
    .from('clients')
    .select('id')
    .eq('id', clientId)
    .eq('company_id', ctx.companyId)
    .maybeSingle();
  if (clientErr) return NextResponse.json({ error: clientErr.message }, { status: 500 });
  if (!client) {
    return NextResponse.json({ error: 'Client not found in your company' }, { status: 404 });
  }

  const row = {
    client_id: clientId,
    company_id: ctx.companyId,
    name: typeof body.name === 'string' ? body.name.trim() || null : null,
    address: typeof body.address === 'string' ? body.address.trim() || null : null,
    total_acres:
      typeof body.total_acres === 'number' && Number.isFinite(body.total_acres)
        ? body.total_acres
        : null,
    gate_code: typeof body.gate_code === 'string' ? body.gate_code.trim() || null : null,
    access_notes:
      typeof body.access_notes === 'string' ? body.access_notes.trim() || null : null,
    center: body.center ?? null,
    boundary: body.boundary ?? null,
    soil_summary:
      typeof body.soil_summary === 'string' ? body.soil_summary.trim() || null : null,
    terrain_notes:
      typeof body.terrain_notes === 'string' ? body.terrain_notes.trim() || null : null,
  };

  const { data, error } = await supabase.from('properties').insert(row).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ property: data }, { status: 201 });
}
