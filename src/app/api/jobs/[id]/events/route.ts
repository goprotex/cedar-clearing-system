import { NextResponse } from 'next/server';
import { createClient, getUserFromRequest } from '@/utils/supabase/server';
import { parseJobIdFromPath, parseJsonBody } from '@/lib/jobs';

export async function POST(req: Request) {
  const jobId = parseJobIdFromPath(req.url);
  if (!jobId) return NextResponse.json({ error: 'Missing job id' }, { status: 400 });

  const body = (await parseJsonBody(req)) as { type?: string; data?: unknown } | null;
  const type = body?.type;
  const data = body?.data;

  if (!type) return NextResponse.json({ error: 'Missing event type' }, { status: 400 });

  const supabase = await createClient(req);
  const { data: auth } = await getUserFromRequest(supabase, req);
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Ensure requester is a member of the job
  const { data: membership, error: membershipErr } = await supabase
    .from('job_members')
    .select('job_id')
    .eq('job_id', jobId)
    .eq('user_id', userId)
    .maybeSingle();
  if (membershipErr) return NextResponse.json({ error: membershipErr.message }, { status: 500 });
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data: inserted, error: insertErr } = await supabase
    .from('job_events')
    .insert({
      job_id: jobId,
      created_by: userId,
      type,
      data,
    })
    .select('id, created_at')
    .single();
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  // Lightweight progress aggregator for operator clears
  if (type === 'operator_cell_cleared') {
    // Expect data: { cellId: "pastureId:idx", timestamp, ... }
    // We store cleared cells in a deduped table for easy progress queries.
    const cellId = (body?.data as { cellId?: string } | null)?.cellId;
    if (cellId) {
      await supabase.from('job_cleared_cells').upsert({
        job_id: jobId,
        cell_id: cellId,
        cleared_by: userId,
      }, { onConflict: 'job_id,cell_id' });
    }
  }

  return NextResponse.json({ ok: true, event: inserted });
}

