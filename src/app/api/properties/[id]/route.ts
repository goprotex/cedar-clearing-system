import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { getUserCompanyId } from '@/lib/user-company';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const ctx = await getUserCompanyId(supabase, req);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: property, error } = await supabase
    .from('properties')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!property) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (ctx.companyId && property.company_id !== ctx.companyId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ property });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const ctx = await getUserCompanyId(supabase, req);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!ctx.companyId) {
    return NextResponse.json(
      { error: 'Join or create a company before updating properties.' },
      { status: 400 }
    );
  }

  const { data: existing, error: exErr } = await supabase
    .from('properties')
    .select('id, company_id')
    .eq('id', id)
    .maybeSingle();
  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });
  if (!existing || existing.company_id !== ctx.companyId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = (await req.json()) as Record<string, unknown>;
  const updates: Record<string, unknown> = {};
  const invalidFields: string[] = [];

  const nullableString = (k: string) => {
    if (body[k] === undefined) return;
    if (body[k] === null) {
      updates[k] = null;
      return;
    }
    if (typeof body[k] !== 'string') {
      invalidFields.push(k);
      return;
    }

    const value = body[k].trim();
    updates[k] = value || null;
  };

  const nullableFiniteNumber = (k: string) => {
    if (body[k] === undefined) return;
    if (body[k] === null) {
      updates[k] = null;
      return;
    }
    if (typeof body[k] !== 'number' || !Number.isFinite(body[k])) {
      invalidFields.push(k);
      return;
    }

    updates[k] = body[k];
  };

  nullableString('name');
  nullableString('address');
  nullableString('gate_code');
  nullableString('access_notes');
  nullableString('soil_summary');
  nullableString('terrain_notes');

  nullableFiniteNumber('total_acres');
  if (body.center !== undefined) updates.center = body.center ?? null;
  if (body.boundary !== undefined) updates.boundary = body.boundary ?? null;

  if (invalidFields.length > 0) {
    return NextResponse.json(
      { error: `Invalid value for field(s): ${invalidFields.join(', ')}` },
      { status: 400 }
    );
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('properties')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ property: data });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const ctx = await getUserCompanyId(supabase, req);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!ctx.companyId) {
    return NextResponse.json(
      { error: 'Join or create a company before deleting properties.' },
      { status: 400 }
    );
  }

  const { data: existing, error: exErr } = await supabase
    .from('properties')
    .select('id, company_id')
    .eq('id', id)
    .maybeSingle();
  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });
  if (!existing || existing.company_id !== ctx.companyId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { error } = await supabase.from('properties').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
