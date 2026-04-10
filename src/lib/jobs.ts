import type { Bid } from '@/types';

// Deterministic job id derived from bid id (local-first, no DB needed).
// Note: this is NOT a cryptographic hash; it just keeps a stable mapping.
export function jobIdFromBidId(bidId: string) {
  return `job_${bidId}`;
}

export function jobBidSnapshotKey(bidId: string) {
  return `ccc_job_bid_${bidId}`;
}

export function saveJobBidSnapshot(bid: Bid) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(jobBidSnapshotKey(bid.id), JSON.stringify(bid));
}

export function loadJobBidSnapshot(bidId: string): Bid | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(jobBidSnapshotKey(bidId));
    if (!raw) return null;
    return JSON.parse(raw) as Bid;
  } catch {
    return null;
  }
}

export function jobProgressKey(jobId: string) {
  return `ccc_job_progress_${jobId}`;
}

export type ClearedCell = { id: string; pastureId: string; cellIndex: number; timestamp: number };

export function loadJobProgress(jobId: string): ClearedCell[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(jobProgressKey(jobId));
    return raw ? (JSON.parse(raw) as ClearedCell[]) : [];
  } catch {
    return [];
  }
}

export function saveJobProgress(jobId: string, clearedCells: ClearedCell[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(jobProgressKey(jobId), JSON.stringify(clearedCells));
}

export function mergeClearedCellIds(existing: Set<string>, incoming: string[]) {
  if (!incoming || incoming.length === 0) return existing;
  const next = new Set(existing);
  for (const id of incoming) next.add(id);
  return next;
}

export async function parseJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export function parseJobIdFromPath(url: string): string | null {
  try {
    const u = new URL(url);
    // /api/jobs/:id/events
    const parts = u.pathname.split('/').filter(Boolean);
    const i = parts.findIndex((p) => p === 'jobs');
    if (i === -1) return null;
    return parts[i + 1] ?? null;
  } catch {
    return null;
  }
}

export type JobRecord = {
  id: string;
  bidId: string;
  createdAt: string;
  title: string;
  status: 'active' | 'paused' | 'completed';
  cedar_total_cells: number;
  cedar_cleared_cells: number;
  members: Array<{ userId: string; role: 'owner' | 'worker' | 'viewer' }>;
};

export function localJobKey(jobId: string) {
  return `ccc_job_${jobId}`;
}

export function saveLocalJob(job: JobRecord) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(localJobKey(job.id), JSON.stringify(job));
}

export function loadLocalJob(jobId: string): JobRecord | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(localJobKey(jobId));
    if (!raw) return null;
    return JSON.parse(raw) as JobRecord;
  } catch {
    return null;
  }
}

export function localJobEventsKey(jobId: string) {
  return `ccc_job_events_${jobId}`;
}

export type LocalJobEvent = {
  id: string;
  created_at: string;
  type: string;
  data: unknown;
};

export function appendLocalJobEvent(jobId: string, event: Omit<LocalJobEvent, 'id'>) {
  if (typeof window === 'undefined') return;
  const id = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const existing = loadLocalJobEvents(jobId);
  const next = [{ id, ...event }, ...existing].slice(0, 200);
  localStorage.setItem(localJobEventsKey(jobId), JSON.stringify(next));
}

export function loadLocalJobEvents(jobId: string): LocalJobEvent[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(localJobEventsKey(jobId));
    return raw ? (JSON.parse(raw) as LocalJobEvent[]) : [];
  } catch {
    return [];
  }
}

export function createLocalJobFromBid(bid: Bid): JobRecord {
  const jobId = jobIdFromBidId(bid.id);
  const title = `${bid.propertyName || 'Untitled Property'} — ${bid.bidNumber}`;
  const job: JobRecord = {
    id: jobId,
    bidId: bid.id,
    createdAt: new Date().toISOString(),
    title,
    status: 'active',
    cedar_total_cells: 0,
    cedar_cleared_cells: 0,
    members: [{ userId: 'local', role: 'owner' }],
  };
  saveLocalJob(job);
  saveJobBidSnapshot(bid);
  appendLocalJobEvent(jobId, { created_at: job.createdAt, type: 'job_created', data: { bidId: bid.id } });
  return job;
}

export function loadLocalJobBundle(jobId: string): { job: JobRecord | null; bid: Bid | null; events: LocalJobEvent[] } {
  const job = loadLocalJob(jobId);
  const bid = job ? loadJobBidSnapshot(job.bidId) : null;
  const events = loadLocalJobEvents(jobId);
  return { job, bid, events };
}

