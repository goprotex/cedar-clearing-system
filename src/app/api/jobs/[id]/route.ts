import { NextResponse } from 'next/server';
import { createClient, getUserFromRequest } from '@/utils/supabase/server';
import { canAccessJob } from '@/lib/job-access';
import { isCompanyAdmin } from '@/lib/company-admin';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient(req);

  const { data: auth } = await getUserFromRequest(supabase, req);
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

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient(req);

  const { data: auth } = await getUserFromRequest(supabase, req);
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Only job owners or company admins can delete a job
  const { data: membership } = await supabase
    .from('job_members')
    .select('role')
    .eq('job_id', id)
    .eq('user_id', userId)
    .maybeSingle();

  const isOwner = membership?.role === 'owner';
  if (!isOwner) {
    const adminCheck = await isCompanyAdmin(supabase, userId);
    if (!adminCheck) {
      return NextResponse.json({ error: 'Forbidden — job owners and company admins only' }, { status: 403 });
    }
  }

  const { error } = await supabase.from('jobs').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

