import { NextResponse } from 'next/server';
import { createClient, getUserFromRequest } from '@/utils/supabase/server';
import { rowToBid, rowToPasture, type BidRow, type PastureRow } from '@/lib/db';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: auth, error: authErr } = await getUserFromRequest(supabase);
  if (authErr || !auth.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: bidRow, error: bidErr } = await supabase
    .from('bids')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (bidErr) return NextResponse.json({ error: bidErr.message }, { status: 500 });
  if (!bidRow) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: pastureRows, error: pasturesErr } = await supabase
    .from('pastures')
    .select('*')
    .eq('bid_id', id)
    .order('sort_order', { ascending: true });

  if (pasturesErr) return NextResponse.json({ error: pasturesErr.message }, { status: 500 });

  const pastures = (pastureRows ?? []).map((r: PastureRow) => rowToPasture(r));
  const bid = rowToBid(bidRow as BidRow, pastures);

  return NextResponse.json({ bid });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: auth, error: authErr } = await getUserFromRequest(supabase);
  if (authErr || !auth.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { error } = await supabase.from('bids').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: auth, error: authErr } = await getUserFromRequest(supabase, req);
  if (authErr || !auth.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Verify bid exists and is accessible (RLS will also enforce this)
  const { data: existing, error: exErr } = await supabase
    .from('bids')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Matches the DB check constraint: check (status in ('draft','sent','accepted','declined','expired'))
  const VALID_STATUSES = ['draft', 'sent', 'accepted', 'declined', 'expired'];
  const updates: Record<string, unknown> = {};

  if (typeof body.status === 'string') {
    if (!VALID_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` }, { status: 400 });
    }
    updates.status = body.status;
  }
  if (body.client_name !== undefined) {
    if (typeof body.client_name !== 'string') {
      return NextResponse.json({ error: 'client_name must be a string' }, { status: 400 });
    }
    const clientName = body.client_name.trim();
    if (clientName.length === 0) {
      return NextResponse.json({ error: 'client_name cannot be empty' }, { status: 400 });
    }
    if (clientName.length > 200) {
      return NextResponse.json({ error: 'client_name must be 200 characters or fewer' }, { status: 400 });
    }
    updates.client_name = clientName;
  }
  if (body.property_name !== undefined) {
    if (body.property_name !== null && typeof body.property_name !== 'string') {
      return NextResponse.json({ error: 'property_name must be a string or null' }, { status: 400 });
    }
    if (typeof body.property_name === 'string' && body.property_name.trim().length > 200) {
      return NextResponse.json({ error: 'property_name must be 200 characters or fewer' }, { status: 400 });
    }
    updates.property_name = typeof body.property_name === 'string' ? body.property_name.trim() : null;
  }
  if (body.notes !== undefined) {
    updates.notes = typeof body.notes === 'string' ? body.notes : '';
  }
  if (body.valid_until !== undefined) {
    if (body.valid_until === null) {
      updates.valid_until = null;
    } else if (typeof body.valid_until === 'string') {
      // Require YYYY-MM-DD format to match the `date` column type
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.valid_until)) {
        return NextResponse.json({ error: 'valid_until must be a date in YYYY-MM-DD format' }, { status: 400 });
      }
      updates.valid_until = body.valid_until;
    } else {
      return NextResponse.json({ error: 'valid_until must be a YYYY-MM-DD date string or null' }, { status: 400 });
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  updates.updated_at = new Date().toISOString();

  const { error } = await supabase.from('bids').update(updates).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
