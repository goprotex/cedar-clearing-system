import type { Bid } from '@/types';

/** Shape aligned with monitor bootstrap + local job cards */
export type ActiveJobSummary = {
  id: string;
  title: string;
  status: string;
  created_at: string;
  bid_snapshot: Bid;
  cedar_total_cells: number;
  cedar_cleared_cells: number;
};

export function mergeJobsById(remote: ActiveJobSummary[], local: ActiveJobSummary[]): ActiveJobSummary[] {
  const byId = new Map<string, ActiveJobSummary>();
  for (const j of remote) byId.set(j.id, j);
  for (const j of local) {
    if (!byId.has(j.id)) byId.set(j.id, j);
  }
  return Array.from(byId.values());
}

/** Local converted jobs from `ccc_job_*` keys (same rules as scout monitor). */
export function loadLocalStorageJobs(): ActiveJobSummary[] {
  if (typeof window === 'undefined') return [];
  const results: ActiveJobSummary[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith('ccc_job_') || key.startsWith('ccc_job_bid_') || key.startsWith('ccc_job_events_') || key.startsWith('ccc_job_progress_')) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const job = JSON.parse(raw) as { id: string; bidId: string; title: string; status: string; createdAt: string; cedar_cleared_cells?: number };
      if (!job.id || !job.bidId) continue;

      const bidRaw = localStorage.getItem(`ccc_job_bid_${job.bidId}`);
      if (!bidRaw) continue;
      const bid: Bid = JSON.parse(bidRaw);
      if (!bid.pastures?.length) continue;

      let cedarTotal = 0;
      for (const p of bid.pastures) {
        for (const f of (p.cedarAnalysis?.gridCells?.features ?? [])) {
          const cls = (f as { properties?: { classification?: string } }).properties?.classification;
          if (cls === 'cedar' || cls === 'oak' || cls === 'mixed_brush') cedarTotal++;
        }
      }

      results.push({
        id: job.id,
        title: job.title || `Job ${job.id}`,
        status: job.status || 'active',
        created_at: job.createdAt || new Date().toISOString(),
        bid_snapshot: bid,
        cedar_total_cells: cedarTotal,
        cedar_cleared_cells: job.cedar_cleared_cells ?? 0,
      });
    }
  } catch { /* ignore */ }
  return results;
}
