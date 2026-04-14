import { NextResponse } from 'next/server';
import { createClient, getUserFromRequest } from '@/utils/supabase/server';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const { id: jobId, entryId } = await params;
  const supabase = await createClient(req);

  const { data: auth } = await getUserFromRequest(supabase, req);
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Only job owners and crew leads can approve time entries
  const { data: membership, error: memErr } = await supabase
    .from('job_members')
    .select('role')
    .eq('job_id', jobId)
    .eq('user_id', userId)
    .maybeSingle();
  if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (membership.role !== 'owner' && membership.role !== 'crew_lead') {
    return NextResponse.json({ error: 'Forbidden — only owners and crew leads can approve time entries' }, { status: 403 });
  }

  // Verify the time entry belongs to this job and is complete (has clock_out or hours_manual)
  const { data: entry, error: entryErr } = await supabase
    .from('job_time_entries')
    .select('id, job_id, clock_out, hours_manual, approved_by')
    .eq('id', entryId)
    .eq('job_id', jobId)
    .maybeSingle();
  if (entryErr) return NextResponse.json({ error: entryErr.message }, { status: 500 });
  if (!entry) return NextResponse.json({ error: 'Time entry not found' }, { status: 404 });

  if (!entry.clock_out && !entry.hours_manual) {
    return NextResponse.json({ error: 'Cannot approve an open time entry — operator must clock out first' }, { status: 422 });
  }

  if (entry.approved_by) {
    return NextResponse.json({ error: 'Time entry already approved' }, { status: 409 });
  }

  const { data: updated, error: updateErr } = await supabase
    .from('job_time_entries')
    .update({
      approved_by: userId,
      approved_at: new Date().toISOString(),
    })
    .eq('id', entryId)
    .eq('job_id', jobId)
    .select('*')
    .single();

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  return NextResponse.json({ timeEntry: updated });
}
