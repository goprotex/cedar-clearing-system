import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import type { MonitorBootstrapResponse, MonitorTelemetryRow } from '@/types/monitor-bootstrap';

type MonitorJob = {
  id: string;
  bid_id: string;
  title: string;
  status: string;
  created_at: string;
  bid_snapshot: unknown;
  cedar_total_cells: number;
  cedar_cleared_cells: number;
  work_started_at: string | null;
  work_completed_at: string | null;
  manual_machine_hours: number | null;
  manual_fuel_gallons: number | null;
};

function isCompanySupervisorRole(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'manager';
}

export async function GET(req: Request) {
  const supabase = await createClient(req);

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth.user?.id) {
    return NextResponse.json({
      jobs: [],
      clearedByJob: {} as Record<string, string[]>,
      operatorsByJob: {} as Record<string, unknown[]>,
      telemetryByJob: {} as Record<string, MonitorTelemetryRow[]>,
      scope: 'membership',
    } satisfies MonitorBootstrapResponse);
  }

  const userId = auth.user.id;

  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('company_id, role')
    .eq('id', userId)
    .maybeSingle();
  if (profileErr) return NextResponse.json({ error: profileErr.message }, { status: 500 });

  const companyId = profile?.company_id ?? null;
  const profileRole = profile?.role ?? null;
  const companySupervisor = Boolean(companyId && isCompanySupervisorRole(profileRole));

  let jobIds: string[] = [];
  let scope: MonitorBootstrapResponse['scope'] = 'membership';

  if (companySupervisor) {
    const { data: bidRows, error: bidsErr } = await supabase
      .from('bids')
      .select('id')
      .eq('company_id', companyId);
    if (bidsErr) return NextResponse.json({ error: bidsErr.message }, { status: 500 });

    const bidUuids = (bidRows ?? []).map((r) => r.id as string);
    if (bidUuids.length === 0) {
      jobIds = [];
    } else {
      const { data: companyJobs, error: cjErr } = await supabase
        .from('jobs')
        .select('id')
        .in('bid_id', bidUuids);
      if (cjErr) return NextResponse.json({ error: cjErr.message }, { status: 500 });
      jobIds = (companyJobs ?? []).map((j) => j.id as string);
    }
    scope = 'company';

    const { data: memberships, error: memErr } = await supabase
      .from('job_members')
      .select('job_id')
      .eq('user_id', userId);
    if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });
    const memberIds = new Set((memberships ?? []).map((m) => m.job_id as string));
    for (const id of jobIds) memberIds.add(id);
    jobIds = Array.from(memberIds);
  } else {
    const { data: memberships, error: memErr } = await supabase
      .from('job_members')
      .select('job_id')
      .eq('user_id', userId);
    if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });
    jobIds = (memberships ?? []).map((m) => m.job_id as string);
  }

  if (jobIds.length === 0) {
    return NextResponse.json({
      jobs: [],
      clearedByJob: {} as Record<string, string[]>,
      operatorsByJob: {} as Record<string, unknown[]>,
      telemetryByJob: {} as Record<string, MonitorTelemetryRow[]>,
      scope,
    } satisfies MonitorBootstrapResponse);
  }

  const { data: jobs, error: jobsErr } = await supabase
    .from('jobs')
    .select(
      'id, bid_id, title, status, created_at, bid_snapshot, cedar_total_cells, cedar_cleared_cells, work_started_at, work_completed_at, manual_machine_hours, manual_fuel_gallons',
    )
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
    .select('job_id, user_id, lng, lat, accuracy_m, heading, speed_mps, updated_at')
    .in('job_id', jobIds);
  if (opErr) return NextResponse.json({ error: opErr.message }, { status: 500 });

  const operatorsByJob: Record<string, unknown[]> = {};
  for (const row of operators ?? []) {
    (operatorsByJob[row.job_id] ??= []).push({
      user_id: row.user_id,
      lng: row.lng,
      lat: row.lat,
      heading: row.heading ?? null,
      speed_mps: row.speed_mps ?? null,
      accuracy_m: row.accuracy_m ?? null,
      updated_at: row.updated_at,
    });
  }

  const telemetryByJob: Record<string, MonitorTelemetryRow[]> = {};
  const { data: telemRows, error: telemErr } = await supabase
    .from('job_telemetry_latest')
    .select('job_id, source_key, kind, data, updated_at')
    .in('job_id', jobIds);
  if (!telemErr) {
    for (const row of telemRows ?? []) {
      const jid = row.job_id as string;
      const entry: MonitorTelemetryRow = {
        source_key: row.source_key as string,
        kind: row.kind as MonitorTelemetryRow['kind'],
        data: (row.data as Record<string, unknown>) ?? {},
        updated_at: row.updated_at as string,
      };
      (telemetryByJob[jid] ??= []).push(entry);
    }
  }
  // If migration not applied yet or RLS blocks, bootstrap still returns jobs/operators.

  return NextResponse.json({
    jobs: (jobs ?? []) as MonitorJob[],
    clearedByJob,
    operatorsByJob,
    telemetryByJob,
    scope,
  } satisfies MonitorBootstrapResponse);
}
