import { NextResponse } from 'next/server';
import { createClient, getUserFromRequest } from '@/utils/supabase/server';
import { getProfileCompanyContext } from '@/lib/company-admin';

/**
 * GET /api/analytics/dashboard
 *
 * Returns owner-level dashboard metrics for the authenticated user's company:
 * - Job counts by status
 * - Bid counts by status
 * - Total revenue (accepted bids + completed jobs bid amount)
 * - Total acreage cleared (from jobs)
 * - Active fleet count
 * - Pending time entries awaiting approval
 * - Recent job activity (last 5 status changes)
 */
export async function GET(req: Request) {
  const supabase = await createClient(req);

  const { data: auth } = await getUserFromRequest(supabase, req);
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Fetch profile + company context
  const ctx = await getProfileCompanyContext(supabase, userId);
  if (!ctx?.companyId) {
    return NextResponse.json({ error: 'No company associated with this account' }, { status: 403 });
  }

  // Only owners and managers can see the full analytics dashboard
  const role = ctx.role;
  if (role !== 'owner' && role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden — owner or manager role required' }, { status: 403 });
  }

  const companyId = ctx.companyId;

  // Run all queries in parallel
  const [
    jobsResult,
    bidsResult,
    fleetResult,
    timeEntriesResult,
    recentJobsResult,
  ] = await Promise.all([
    // Jobs summary grouped by status
    supabase
      .from('jobs')
      .select('id, status, bid_snapshot, cedar_total_cells, cedar_cleared_cells, work_started_at, work_completed_at, manual_machine_hours, manual_fuel_gallons')
      .eq('company_id', companyId),

    // Bids summary grouped by status
    supabase
      .from('bids')
      .select('id, status, total_amount, total_acreage, created_at')
      .eq('company_id', companyId),

    // Active fleet count
    supabase
      .from('fleet_machines')
      .select('id, data')
      .eq('company_id', companyId),

    // Pending time entry approvals (no approved_by set, clock_out is set)
    supabase
      .from('job_time_entries')
      .select('id, job_id, operator_id, clock_in, clock_out, hours_manual, approved_by')
      .is('approved_by', null)
      .not('clock_out', 'is', null),

    // Recent job events for activity feed
    supabase
      .from('job_events')
      .select('id, job_id, created_at, type, created_by')
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  if (jobsResult.error) return NextResponse.json({ error: jobsResult.error.message }, { status: 500 });
  if (bidsResult.error) return NextResponse.json({ error: bidsResult.error.message }, { status: 500 });

  const jobs = jobsResult.data ?? [];
  const bids = bidsResult.data ?? [];
  const fleet = fleetResult.data ?? [];
  const timeEntries = timeEntriesResult.data ?? [];
  const recentEvents = recentJobsResult.data ?? [];

  // Job metrics
  const jobsByStatus = jobs.reduce((acc: Record<string, number>, j) => {
    acc[j.status] = (acc[j.status] ?? 0) + 1;
    return acc;
  }, {});

  const totalClearedCells = jobs.reduce((s, j) => s + (j.cedar_cleared_cells ?? 0), 0);
  const totalCells = jobs.reduce((s, j) => s + (j.cedar_total_cells ?? 0), 0);
  const totalMachineHours = jobs.reduce((s, j) => s + (j.manual_machine_hours ?? 0), 0);
  const totalFuelGallons = jobs.reduce((s, j) => s + (j.manual_fuel_gallons ?? 0), 0);

  // Estimate total acreage cleared from job bid_snapshots
  const totalAcreageCleared = jobs
    .filter((j) => j.status === 'completed')
    .reduce((s, j) => {
      const snap = j.bid_snapshot as { totalAcreage?: number } | null;
      return s + (snap?.totalAcreage ?? 0);
    }, 0);

  // Bid metrics
  const bidsByStatus = bids.reduce((acc: Record<string, number>, b) => {
    acc[b.status] = (acc[b.status] ?? 0) + 1;
    return acc;
  }, {});

  const totalBidValue = bids
    .filter((b) => b.status === 'accepted' || b.status === 'sent')
    .reduce((s, b) => s + (Number(b.total_amount) || 0), 0);

  const totalBidAcreage = bids.reduce((s, b) => s + (Number(b.total_acreage) || 0), 0);

  // Fleet metrics
  const fleetByStatus = fleet.reduce((acc: Record<string, number>, unit) => {
    const d = unit.data as Record<string, unknown> | null;
    const status = (typeof d?.status === 'string' ? d.status : 'unknown') as string;
    acc[status] = (acc[status] ?? 0) + 1;
    return acc;
  }, {});

  // Pending approvals (filter to jobs in this company — best-effort, time entries don't store company_id directly)
  const companyJobIds = new Set(jobs.map((j) => j.id));
  const pendingApprovals = timeEntries.filter((e) => companyJobIds.has(e.job_id)).length;

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    companyId,
    jobs: {
      total: jobs.length,
      byStatus: jobsByStatus,
      totalClearedCells,
      totalCells,
      completionPct: totalCells > 0 ? Math.round((totalClearedCells / totalCells) * 100) : 0,
      totalMachineHours: Math.round(totalMachineHours * 10) / 10,
      totalFuelGallons: Math.round(totalFuelGallons * 10) / 10,
      totalAcreageCleared: Math.round(totalAcreageCleared * 10) / 10,
    },
    bids: {
      total: bids.length,
      byStatus: bidsByStatus,
      totalBidValue: Math.round(totalBidValue * 100) / 100,
      totalBidAcreage: Math.round(totalBidAcreage * 10) / 10,
    },
    fleet: {
      total: fleet.length,
      byStatus: fleetByStatus,
    },
    timeEntries: {
      pendingApprovals,
    },
    recentActivity: recentEvents.map((e) => ({
      id: e.id,
      jobId: e.job_id,
      type: e.type,
      createdAt: e.created_at,
      createdBy: e.created_by,
    })),
  });
}
