import { NextResponse } from 'next/server';
import { createClient, getUserFromRequest } from '@/utils/supabase/server';
import { rowToBid, rowToPasture, type BidRow, type PastureRow } from '@/lib/db';

const ALLOWED_STATUSES = new Set(['draft', 'sent', 'accepted', 'declined', 'expired']);

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient(req);

  const { data: auth, error: authErr } = await getUserFromRequest(supabase, req);
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

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient(req);

  const { data: auth, error: authErr } = await getUserFromRequest(supabase, req);
  if (authErr || !auth.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: {
    status?: string;
    notes?: string;
    valid_until?: string | null;
    client_name?: string;
    client_email?: string;
    client_phone?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof body.status === 'string') {
    if (!ALLOWED_STATUSES.has(body.status)) {
      return NextResponse.json({ error: 'Invalid status. Allowed: draft, sent, accepted, declined, expired' }, { status: 400 });
    }
    patch.status = body.status;
  }
  if (typeof body.notes === 'string') patch.notes = body.notes.slice(0, 10000);
  if ('valid_until' in body) patch.valid_until = body.valid_until ?? null;
  if (typeof body.client_name === 'string') patch.client_name = body.client_name.slice(0, 200);
  if (typeof body.client_email === 'string') patch.client_email = body.client_email.slice(0, 200);
  if (typeof body.client_phone === 'string') patch.client_phone = body.client_phone.slice(0, 50);

  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const { error } = await supabase.from('bids').update(patch).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient(req);

  const { data: auth, error: authErr } = await getUserFromRequest(supabase, req);
  if (authErr || !auth.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { error } = await supabase.from('bids').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
