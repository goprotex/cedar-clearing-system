import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { requireJobWorker } from '@/lib/job-api-auth';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; workOrderId: string }> },
) {
  const { id: jobId, workOrderId } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const gate = await requireJobWorker(supabase, jobId, userId);
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status });

  let body: { status?: string; instructions?: string; pasture_name?: string; sort_order?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  const allowed = new Set(['pending', 'in_progress', 'done', 'skipped']);
  if (typeof body.status === 'string' && allowed.has(body.status)) patch.status = body.status;
  if (typeof body.instructions === 'string') patch.instructions = body.instructions.slice(0, 4000);
  if (typeof body.pasture_name === 'string') patch.pasture_name = body.pasture_name.slice(0, 200);
  if (typeof body.sort_order === 'number' && Number.isFinite(body.sort_order)) patch.sort_order = body.sort_order;

  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'No valid fields' }, { status: 400 });

  const { data, error } = await supabase
    .from('job_work_orders')
    .update(patch)
    .eq('id', workOrderId)
    .eq('job_id', jobId)
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ workOrder: data });
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string; workOrderId: string }> },
) {
  const { id: jobId, workOrderId } = await params;
  const supabase = await createClient();
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
    return NextResponse.json({ error: 'Only job owners can delete work orders' }, { status: 403 });
  }

  const { error } = await supabase.from('job_work_orders').delete().eq('id', workOrderId).eq('job_id', jobId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
