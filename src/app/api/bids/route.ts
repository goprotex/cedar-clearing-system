import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/utils/supabase/server';

export async function GET() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

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

  return NextResponse.json({ bids: data ?? [] });
}

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { bid, pastures } = body;

  if (!bid?.id) {
    return NextResponse.json({ error: 'Missing bid.id' }, { status: 400 });
  }

  const { error: bidErr } = await supabase
    .from('bids')
    .upsert({ ...bid, created_by: auth.user.id, updated_at: new Date().toISOString() }, { onConflict: 'id' });

  if (bidErr) return NextResponse.json({ error: bidErr.message }, { status: 500 });

  if (Array.isArray(pastures) && pastures.length > 0) {
    const { error: pErr } = await supabase
      .from('pastures')
      .upsert(pastures, { onConflict: 'id' });
    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
