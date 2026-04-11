import { NextResponse } from 'next/server';
import type { Bid } from '@/types';
import { createClient } from '@/utils/supabase/server';
import { jobIdFromBidId } from '@/lib/jobs';

function countCedarCells(bid: Bid): number {
  let total = 0;
  for (const p of bid.pastures) {
    const feats = p.cedarAnalysis?.gridCells?.features ?? [];
    for (const f of feats) {
      const cls = f.properties?.classification;
      if (cls === 'cedar' || cls === 'oak' || cls === 'mixed_brush') total++;
    }
  }
  return total;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { bidId?: string; bid?: Bid };
    const bidId = body.bidId ?? body.bid?.id;
    const bid = body.bid;

    if (!bidId) {
      return NextResponse.json({ error: 'Missing bidId' }, { status: 400 });
    }
    if (!bid) {
      return NextResponse.json({ error: 'Missing bid payload' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr) return NextResponse.json({ error: userErr.message }, { status: 401 });
    const user = userRes.user;
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const jobId = jobIdFromBidId(bidId);
    const cedar_total_cells = countCedarCells(bid);

    // Create job (idempotent) and ensure the caller is a member (owner)
    const { error: jobErr } = await supabase.from('jobs').upsert({
      id: jobId,
      bid_id: bidId,
      bid_snapshot: bid,
      title: `${bid.propertyName || 'Untitled Property'} — ${bid.bidNumber}`,
      status: 'active',
      cedar_total_cells,
    });
    if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 });

    const { error: memberErr } = await supabase.from('job_members').upsert({
      job_id: jobId,
      user_id: user.id,
      role: 'owner',
    });
    if (memberErr) return NextResponse.json({ error: memberErr.message }, { status: 500 });

    return NextResponse.json({ jobId });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
}

