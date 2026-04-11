import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { requireJobWorker } from '@/lib/job-api-auth';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; blockId: string }> },
) {
  const { id: jobId, blockId } = await params;
  const supabase = await createClient(req);
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const gate = await requireJobWorker(supabase, jobId, userId);
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status });

  let body: { starts_at?: string; ends_at?: string; title?: string; notes?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.title === 'string') patch.title = body.title.slice(0, 200);
  if (body.notes !== undefined) patch.notes = body.notes === null ? null : String(body.notes).slice(0, 2000);
  if (typeof body.starts_at === 'string') patch.starts_at = new Date(body.starts_at).toISOString();
  if (typeof body.ends_at === 'string') patch.ends_at = new Date(body.ends_at).toISOString();

  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'No valid fields' }, { status: 400 });

  const { data, error } = await supabase
    .from('job_schedule_blocks')
    .update(patch)
    .eq('id', blockId)
    .eq('job_id', jobId)
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ block: data });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; blockId: string }> },
) {
  const { id: jobId, blockId } = await params;
  const supabase = await createClient(req);
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: mem } = await supabase
    .from('job_members')
    .select('role')
    .eq('job_id', jobId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!mem || mem.role !== 'owner') {
    return NextResponse.json({ error: 'Only job owners can delete schedule blocks' }, { status: 403 });
  }

  const { error } = await supabase.from('job_schedule_blocks').delete().eq('id', blockId).eq('job_id', jobId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
