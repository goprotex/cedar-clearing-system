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

