import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServiceRole } from '@/lib/supabase-service';
import type { CedarChunkResumeState } from '@/lib/cedar-analysis-resume';

export const maxDuration = 60;

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

/** GET: load checkpoint (with bidId + pastureId), or health: ?health=1 → { configured }. */
export async function GET(req: NextRequest) {
  const supabase = getSupabaseServiceRole();
  if (!supabase) {
    return NextResponse.json({ configured: false, checkpoint: null });
  }

  if (req.nextUrl.searchParams.get('health') === '1') {
    return NextResponse.json({ configured: true });
  }

  const bidId = req.nextUrl.searchParams.get('bidId')?.trim() ?? '';
  const pastureId = req.nextUrl.searchParams.get('pastureId')?.trim() ?? '';
  if (!bidId || !pastureId) {
    return bad('bidId and pastureId are required (or use ?health=1)');
  }

  const { data, error } = await supabase
    .from('cedar_analysis_checkpoints')
    .select('payload, updated_at')
    .eq('bid_id', bidId)
    .eq('pasture_id', pastureId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data?.payload) {
    return NextResponse.json({ configured: true, checkpoint: null });
  }

  return NextResponse.json({
    configured: true,
    checkpoint: data.payload as CedarChunkResumeState,
    updatedAt: data.updated_at,
  });
}

export async function PUT(req: NextRequest) {
  const supabase = getSupabaseServiceRole();
  if (!supabase) {
    return NextResponse.json({ configured: false, saved: false });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return bad('Invalid JSON');
  }

  const state = body as Partial<CedarChunkResumeState>;
  if (!state.bidId || !state.pastureId || !Array.isArray(state.parts) || !Array.isArray(state.chunkKeys)) {
    return bad('Invalid checkpoint payload');
  }

  const { error } = await supabase.from('cedar_analysis_checkpoints').upsert(
    {
      bid_id: state.bidId,
      pasture_id: state.pastureId,
      payload: state as CedarChunkResumeState,
      updated_at: new Date(state.updatedAt ?? Date.now()).toISOString(),
    },
    { onConflict: 'bid_id,pasture_id' }
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ configured: true, saved: true });
}

export async function DELETE(req: NextRequest) {
  const supabase = getSupabaseServiceRole();
  if (!supabase) {
    return NextResponse.json({ configured: false, deleted: false });
  }

  const bidId = req.nextUrl.searchParams.get('bidId')?.trim() ?? '';
  const pastureId = req.nextUrl.searchParams.get('pastureId')?.trim() ?? '';
  if (!bidId || !pastureId) {
    return bad('bidId and pastureId are required');
  }

  const { error } = await supabase
    .from('cedar_analysis_checkpoints')
    .delete()
    .eq('bid_id', bidId)
    .eq('pasture_id', pastureId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ configured: true, deleted: true });
}
