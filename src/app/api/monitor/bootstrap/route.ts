import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/utils/supabase/server';

type MonitorJob = {
  id: string;
  bid_id: string;
  title: string;
  status: string;
  created_at: string;
  bid_snapshot: unknown;
  cedar_total_cells: number;
  cedar_cleared_cells: number;
};

export async function GET() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) return NextResponse.json({ error: authErr.message }, { status: 401 });
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: memberships, error: memErr } = await supabase
    .from('job_members')
    .select('job_id, role')
    .eq('user_id', userId);
  if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });

  const jobIds = (memberships ?? []).map((m) => m.job_id);
  if (jobIds.length === 0) {
    return NextResponse.json({ jobs: [], clearedByJob: {} as Record<string, string[]>, operatorsByJob: {} as Record<string, unknown[]> });
  }

  const { data: jobs, error: jobsErr } = await supabase
    .from('jobs')
    .select('id, bid_id, title, status, created_at, bid_snapshot, cedar_total_cells, cedar_cleared_cells')
    .in('id', jobIds)
    .order('created_at', { ascending: false });
  if (jobsErr) return NextResponse.json({ error: jobsErr.message }, { status: 500 });

  const { data: cleared, error: clearedErr } = await supabase
    .from('job_cleared_cells')
    .select('job_id, cell_id')
    .in('job_id', jobIds);
  if (clearedErr) return NextResponse.json({ error: clearedErr.message }, { status: 500 });

  const clearedByJob: Record<string, string[]> = {};
  for (const row of cleared ?? []) {
    (clearedByJob[row.job_id] ??= []).push(row.cell_id);
  }

  const { data: operators, error: opErr } = await supabase
    .from('job_operator_positions')
    .select('job_id, user_id, lng, lat, accuracy_m, heading_deg, speed_mps, updated_at')
    .in('job_id', jobIds);
  if (opErr) return NextResponse.json({ error: opErr.message }, { status: 500 });

  const operatorsByJob: Record<string, unknown[]> = {};
  for (const row of operators ?? []) {
    (operatorsByJob[row.job_id] ??= []).push({
      user_id: row.user_id,
      lng: row.lng,
      lat: row.lat,
      heading: row.heading_deg ?? null,
      speed_mps: row.speed_mps ?? null,
      accuracy_m: row.accuracy_m ?? null,
      updated_at: row.updated_at,
    });
  }

  return NextResponse.json({ jobs: (jobs ?? []) as MonitorJob[], clearedByJob, operatorsByJob });
}

