import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { getUserCompanyId } from '@/lib/user-company';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const ctx = await getUserCompanyId(supabase);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: client, error: clientErr } = await supabase
    .from('clients')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (clientErr) return NextResponse.json({ error: clientErr.message }, { status: 500 });
  if (!client) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (ctx.companyId && client.company_id !== ctx.companyId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (!ctx.companyId && client.company_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { data: bidRows, error: bidsErr } = await supabase
    .from('bids')
    .select(
      'id, bid_number, status, client_name, property_name, total_acreage, total_amount, created_at, updated_at'
    )
    .eq('client_id', id)
    .order('updated_at', { ascending: false });

  if (bidsErr) return NextResponse.json({ error: bidsErr.message }, { status: 500 });

  const bids = bidRows ?? [];
  const bidIds = bids.map((b) => b.id as string);

  let jobs: Record<string, unknown>[] = [];
  if (bidIds.length > 0) {
    const { data: jobRows, error: jobsErr } = await supabase
      .from('jobs')
      .select('id, bid_id, title, status, created_at')
      .in('bid_id', bidIds)
      .order('created_at', { ascending: false });

    if (jobsErr) return NextResponse.json({ error: jobsErr.message }, { status: 500 });
    jobs = jobRows ?? [];
  }

  return NextResponse.json({ client, bids, jobs });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const ctx = await getUserCompanyId(supabase);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!ctx.companyId) {
    return NextResponse.json(
      { error: 'Join or create a company before updating clients.' },
      { status: 400 }
    );
  }

  const { data: existing, error: exErr } = await supabase
    .from('clients')
    .select('id, company_id')
    .eq('id', id)
    .maybeSingle();

  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });
  if (!existing || existing.company_id !== ctx.companyId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = (await req.json()) as Record<string, unknown>;
  const updates: Record<string, unknown> = {};

  if (body.name !== undefined) {
    if (body.name === null) {
      return NextResponse.json({ error: 'name cannot be null' }, { status: 400 });
    }
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return NextResponse.json({ error: 'name must be a non-empty string' }, { status: 400 });
    }
    updates.name = body.name.trim();
  }

  const str = (k: string, trimEmptyToNull = true) => {
    if (body[k] === undefined) return;
    if (body[k] === null) {
      updates[k] = null;
      return;
    }
    if (typeof body[k] === 'string') {
      const v = (body[k] as string).trim();
      updates[k] = trimEmptyToNull && v === '' ? null : v;
    }
  };

  str('email');
  str('phone');
  str('address');
  str('preferred_clearing_method');
  str('preferred_contact');
  str('payment_terms');
  str('referred_by');

  if (body.notes !== undefined) {
    updates.notes = typeof body.notes === 'string' ? body.notes : null;
  }
  if (body.tags !== undefined) {
    updates.tags = Array.isArray(body.tags)
      ? (body.tags as unknown[]).filter((t): t is string => typeof t === 'string')
      : [];
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase.from('clients').update(updates).eq('id', id).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ client: data });
}
