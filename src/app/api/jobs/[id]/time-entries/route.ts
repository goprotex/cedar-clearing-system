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

  const { data, error } = await supabase
    .from('job_time_entries')
    .select('*')
    .eq('job_id', jobId)
    .order('clock_in', { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ timeEntries: data ?? [] });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  const supabase = await createClient(req);
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const gate = await requireJobWorker(supabase, jobId, userId);
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status });

  let body: {
    action?: string;
    work_order_id?: string | null;
    notes?: string | null;
    hours?: number;
    entry_id?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const action = body.action ?? 'start';

  if (action === 'stop' && typeof body.entry_id === 'string') {
    const { data, error } = await supabase
      .from('job_time_entries')
      .update({ clock_out: new Date().toISOString() })
      .eq('id', body.entry_id)
      .eq('job_id', jobId)
      .eq('operator_id', userId)
      .is('clock_out', null)
      .select('*')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ timeEntry: data });
  }

  if (action === 'manual' && typeof body.hours === 'number' && body.hours > 0 && body.hours <= 24) {
    const now = new Date();
    const { data, error } = await supabase
      .from('job_time_entries')
      .insert({
        job_id: jobId,
        work_order_id: body.work_order_id ?? null,
        operator_id: userId,
        clock_in: now.toISOString(),
        clock_out: now.toISOString(),
        hours_manual: body.hours,
        notes: body.notes?.slice(0, 2000) ?? null,
      })
      .select('*')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ timeEntry: data });
  }

  if (action === 'start') {
    const { data: open } = await supabase
      .from('job_time_entries')
      .select('id')
      .eq('job_id', jobId)
      .eq('operator_id', userId)
      .is('clock_out', null)
      .maybeSingle();
    if (open) {
      return NextResponse.json({ error: 'Already clocked in — stop current entry first' }, { status: 409 });
    }

    const { data, error } = await supabase
      .from('job_time_entries')
      .insert({
        job_id: jobId,
        work_order_id: body.work_order_id ?? null,
        operator_id: userId,
        clock_in: new Date().toISOString(),
        notes: body.notes?.slice(0, 2000) ?? null,
      })
      .select('*')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ timeEntry: data });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
