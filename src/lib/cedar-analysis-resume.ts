/**
 * Persists partial chunked spectral analysis to Supabase (primary) and localStorage
 * (fallback) so a failed or interrupted run can resume — even across devices.
 */

import type { CedarAnalysis } from '@/types';

const STORAGE_PREFIX = 'ccc_cedar_resume_';
const MAX_REMOTE_CHECKPOINT_BYTES = 900_000;

export const CEDAR_RESUME_VERSION = 2 as const;

export interface CedarChunkResumeState {
  v: typeof CEDAR_RESUME_VERSION;
  bidId: string;
  pastureId: string;
  polygonHash: string;
  acreage: number;
  /** Stable fingerprint per chunk polygon ring (matches current chunk layout). */
  chunkKeys: string[];
  /**
   * Results per chunk, indexed by position. `null` entries indicate chunks that
   * failed during the last run and still need to be retried.
   */
  parts: (CedarAnalysis | null)[];
  /** Indices of chunks that permanently failed (after all retries). */
  failedChunkIndices: number[];
  updatedAt: number;
}

/** Number of successfully completed (non-null) parts. */
export function completedPartCount(state: CedarChunkResumeState): number {
  return state.parts.filter((p) => p !== null).length;
}

export function hashPasturePolygon(coordinates: number[][][]): string {
  const s = JSON.stringify(coordinates);
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return `h${(h >>> 0).toString(16)}`;
}

export function chunkKeysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Fingerprint one chunk polygon (exterior ring) for resume matching. */
export function hashChunkPolygonCoords(coords: number[][]): string {
  return hashPasturePolygon([coords]);
}

function storageKey(bidId: string, pastureId: string): string {
  return `${STORAGE_PREFIX}${bidId}_${pastureId}`;
}

/** Upgrade v1 state to v2 (add failedChunkIndices, allow null parts). */
function migrateState(raw: Record<string, unknown>): CedarChunkResumeState | null {
  if (!raw || !Array.isArray(raw.parts) || !Array.isArray(raw.chunkKeys)) return null;
  const version = raw.v as number;
  if (version !== 1 && version !== 2) return null;

  return {
    v: CEDAR_RESUME_VERSION,
    bidId: raw.bidId as string,
    pastureId: raw.pastureId as string,
    polygonHash: raw.polygonHash as string,
    acreage: raw.acreage as number,
    chunkKeys: raw.chunkKeys as string[],
    parts: raw.parts as (CedarAnalysis | null)[],
    failedChunkIndices: Array.isArray(raw.failedChunkIndices)
      ? (raw.failedChunkIndices as number[])
      : [],
    updatedAt: raw.updatedAt as number,
  };
}

export function loadCedarChunkResume(bidId: string, pastureId: string): CedarChunkResumeState | null {
  try {
    const raw = localStorage.getItem(storageKey(bidId, pastureId));
    if (!raw) return null;
    return migrateState(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveCedarChunkResume(state: CedarChunkResumeState): void {
  try {
    localStorage.setItem(storageKey(state.bidId, state.pastureId), JSON.stringify(state));
  } catch {
    // Quota or private mode — analysis still works without resume
  }
}

export function clearCedarChunkResume(bidId: string, pastureId: string): void {
  try {
    localStorage.removeItem(storageKey(bidId, pastureId));
  } catch {
    /* ignore */
  }
}

function buildRemoteCheckpointState(state: CedarChunkResumeState): CedarChunkResumeState {
  return {
    ...state,
    parts: state.parts.map((part) => {
      if (!part) return null;
      const compactPart: CedarAnalysis = {
        ...part,
        crownMasks: undefined,
      };
      return compactPart;
    }),
  };
}

function pickNewerResume(
  a: CedarChunkResumeState,
  b: CedarChunkResumeState
): CedarChunkResumeState {
  const aCompleted = completedPartCount(a);
  const bCompleted = completedPartCount(b);
  if (aCompleted !== bCompleted) {
    return aCompleted >= bCompleted ? a : b;
  }
  return (a.updatedAt ?? 0) >= (b.updatedAt ?? 0) ? a : b;
}

/**
 * Load checkpoint: prefers Supabase (when configured) and merges with localStorage
 * so the best partial progress wins across devices.
 */
export async function loadCedarChunkResumeHybrid(
  bidId: string,
  pastureId: string
): Promise<CedarChunkResumeState | null> {
  const local = loadCedarChunkResume(bidId, pastureId);

  let remote: CedarChunkResumeState | null = null;
  try {
    const res = await fetch(
      `/api/cedar-checkpoint?bidId=${encodeURIComponent(bidId)}&pastureId=${encodeURIComponent(pastureId)}`
    );
    if (res.ok) {
      const data = (await res.json()) as {
        configured?: boolean;
        checkpoint?: Record<string, unknown> | null;
      };
      if (data.checkpoint && typeof data.checkpoint === 'object') {
        remote = migrateState(data.checkpoint);
      }
    }
  } catch {
    /* offline or API missing */
  }

  if (remote && local) {
    const merged = pickNewerResume(remote, local);
    if (merged !== local) {
      saveCedarChunkResume(merged);
    }
    return merged;
  }
  return remote ?? local;
}

/** Save to localStorage and Supabase (when API is configured). */
export async function saveCedarChunkResumeHybrid(state: CedarChunkResumeState): Promise<void> {
  saveCedarChunkResume(state);

  const remoteState = buildRemoteCheckpointState(state);
  const remoteJson = JSON.stringify(remoteState);
  if (remoteJson.length > MAX_REMOTE_CHECKPOINT_BYTES) {
    return;
  }

  try {
    await fetch('/api/cedar-checkpoint', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: remoteJson,
    });
  } catch {
    /* remote optional */
  }
}

/** Clear local + remote checkpoint. */
export async function clearCedarChunkResumeHybrid(bidId: string, pastureId: string): Promise<void> {
  clearCedarChunkResume(bidId, pastureId);
  try {
    await fetch(
      `/api/cedar-checkpoint?bidId=${encodeURIComponent(bidId)}&pastureId=${encodeURIComponent(pastureId)}`,
      { method: 'DELETE' }
    );
  } catch {
    /* ignore */
  }
}
