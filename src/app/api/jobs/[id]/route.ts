import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/utils/supabase/server';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Ensure membership
  const { data: membership, error: membershipErr } = await supabase
    .from('job_members')
    .select('job_id')
    .eq('job_id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (membershipErr) return NextResponse.json({ error: membershipErr.message }, { status: 500 });
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .select('id, bid_id, title, status, created_at, bid_snapshot, cedar_total_cells, cedar_cleared_cells')
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

