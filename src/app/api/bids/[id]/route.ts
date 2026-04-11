import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { rowToBid, rowToPasture, type BidRow, type PastureRow } from '@/lib/db';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
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

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { error } = await supabase.from('bids').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
