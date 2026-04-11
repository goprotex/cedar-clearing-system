import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { canAccessJob } from '@/lib/job-access';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient(req);

  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!(await canAccessJob(supabase, userId, id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .select(
      'id, bid_id, title, status, created_at, bid_snapshot, cedar_total_cells, cedar_cleared_cells, work_started_at, work_completed_at, manual_machine_hours, manual_fuel_gallons',
    )
    .eq('id', id)
    .single();
  if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 });

  const { data: events, error: eventsErr } = await supabase
    .from('job_events')
    .select('id, created_at, created_by, type, data')
    .eq('job_id', id)
    .order('created_at', { ascending: false })
    .limit(200);
  if (eventsErr) return NextResponse.json({ error: eventsErr.message }, { status: 500 });

  return NextResponse.json({ job, events: events ?? [] });
}

