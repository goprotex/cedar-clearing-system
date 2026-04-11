import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

/** Cross-job schedule for the signed-in user (next ~60 days + past 7 days). */
export async function GET(req: Request) {
  const supabase = await createClient(req);
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: memberships, error: mErr } = await supabase
    .from('job_members')
    .select('job_id')
    .eq('user_id', userId);
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });
  const jobIds = (memberships ?? []).map((m) => m.job_id);
  if (jobIds.length === 0) return NextResponse.json({ blocks: [] });

  const url = new URL(req.url);
  const daysAhead = Math.min(90, Math.max(1, parseInt(url.searchParams.get('days') ?? '60', 10) || 60));

  const from = new Date();
  from.setDate(from.getDate() - 7);
  const to = new Date();
  to.setDate(to.getDate() + daysAhead);

  const { data: blocks, error: bErr } = await supabase
    .from('job_schedule_blocks')
    .select('id, job_id, starts_at, ends_at, title, notes')
    .in('job_id', jobIds)
    .lte('starts_at', to.toISOString())
    .gte('ends_at', from.toISOString())
    .order('starts_at');
  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });

  return NextResponse.json({ blocks: blocks ?? [] });
}
