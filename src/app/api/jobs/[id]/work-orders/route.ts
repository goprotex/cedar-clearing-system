import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { requireJobWorker } from '@/lib/job-api-auth';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  const supabase = await createClient(req);
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: membership } = await supabase
    .from('job_members')
    .select('job_id')
    .eq('job_id', jobId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data, error } = await supabase.from('job_work_orders').select('*').eq('job_id', jobId).order('sort_order');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ workOrders: data ?? [] });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  const supabase = await createClient(req);
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const gate = await requireJobWorker(supabase, jobId, userId);
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status });

  let body: { pasture_id?: string; pasture_name?: string; instructions?: string; sort_order?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const pasture_id = typeof body.pasture_id === 'string' ? body.pasture_id : '';
  const pasture_name = typeof body.pasture_name === 'string' ? body.pasture_name.trim().slice(0, 200) : 'Pasture';
  const instructions = typeof body.instructions === 'string' ? body.instructions.slice(0, 4000) : '';
  const sort_order = typeof body.sort_order === 'number' && Number.isFinite(body.sort_order) ? body.sort_order : 0;

  const { data, error } = await supabase
    .from('job_work_orders')
    .insert({ job_id: jobId, pasture_id, pasture_name, instructions, sort_order })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ workOrder: data });
}
