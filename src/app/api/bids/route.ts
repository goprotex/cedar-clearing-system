import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { bidToRow, pastureToRow } from '@/lib/db';
import type { Bid, BidSummary, Pasture } from '@/types';

export async function GET() {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('bids')
    .select('id, bid_number, status, client_name, property_name, total_acreage, total_amount, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const bids: BidSummary[] = (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    bidNumber: r.bid_number as string,
    status: r.status as BidSummary['status'],
    clientName: (r.client_name as string) ?? '',
    propertyName: (r.property_name as string) ?? '',
    totalAcreage: (r.total_acreage as number) ?? 0,
    totalAmount: Number(r.total_amount) || 0,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }));

  return NextResponse.json({ bids });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const bid = body.bid as Bid | undefined;
  const pastures = body.pastures as Pasture[] | undefined;

  if (!bid?.id) {
    return NextResponse.json({ error: 'Missing bid.id' }, { status: 400 });
  }

  const bidRow = bidToRow(bid, auth.user.id);
  const { error: bidErr } = await supabase
    .from('bids')
    .upsert({ ...bidRow, updated_at: new Date().toISOString() }, { onConflict: 'id' });

  if (bidErr) return NextResponse.json({ error: bidErr.message }, { status: 500 });

  if (Array.isArray(pastures) && pastures.length > 0) {
    const pastureRows = pastures.map((p) => pastureToRow(p, bid.id));
    const { error: pErr } = await supabase
      .from('pastures')
      .upsert(pastureRows, { onConflict: 'id' });
    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
