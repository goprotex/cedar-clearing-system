import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { requireJobMember } from '@/lib/job-api-auth';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  const supabase = await createClient(req);
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const gate = await requireJobMember(supabase, jobId, userId);
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status });

  const [wo, te, gps, sch] = await Promise.all([
    supabase.from('job_work_orders').select('*').eq('job_id', jobId).order('sort_order'),
    supabase.from('job_time_entries').select('*').eq('job_id', jobId).order('clock_in', { ascending: false }).limit(100),
    supabase.from('job_gps_tracks').select('*').eq('job_id', jobId).order('started_at', { ascending: false }).limit(50),
    supabase.from('job_schedule_blocks').select('*').eq('job_id', jobId).order('starts_at'),
  ]);

  if (wo.error) return NextResponse.json({ error: wo.error.message }, { status: 500 });
  if (te.error) return NextResponse.json({ error: te.error.message }, { status: 500 });
  if (gps.error) return NextResponse.json({ error: gps.error.message }, { status: 500 });
  if (sch.error) return NextResponse.json({ error: sch.error.message }, { status: 500 });

  return NextResponse.json({
    workOrders: wo.data ?? [],
    timeEntries: te.data ?? [],
    gpsTracks: gps.data ?? [],
    scheduleBlocks: sch.data ?? [],
  });
}
