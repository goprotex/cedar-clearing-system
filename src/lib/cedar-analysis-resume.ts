/**
 * Persists partial chunked spectral analysis to localStorage so a failed run
 * can resume after refresh (same bid + pasture + polygon + chunk layout).
 */

import type { CedarAnalysis } from '@/types';

const STORAGE_PREFIX = 'ccc_cedar_resume_';

export const CEDAR_RESUME_VERSION = 1 as const;

export interface CedarChunkResumeState {
  v: typeof CEDAR_RESUME_VERSION;
  bidId: string;
  pastureId: string;
  polygonHash: string;
  acreage: number;
  /** Stable fingerprint per chunk polygon ring (matches current chunk layout). */
  chunkKeys: string[];
  parts: CedarAnalysis[];
  updatedAt: number;
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

export function loadCedarChunkResume(bidId: string, pastureId: string): CedarChunkResumeState | null {
  try {
    const raw = localStorage.getItem(storageKey(bidId, pastureId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CedarChunkResumeState;
    if (parsed.v !== CEDAR_RESUME_VERSION || !Array.isArray(parsed.parts) || !Array.isArray(parsed.chunkKeys)) {
      return null;
    }
    return parsed;
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

function pickNewerResume(
  a: CedarChunkResumeState,
  b: CedarChunkResumeState
): CedarChunkResumeState {
  if (a.parts.length !== b.parts.length) {
    return a.parts.length >= b.parts.length ? a : b;
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
        checkpoint?: CedarChunkResumeState | null;
      };
      if (data.checkpoint && typeof data.checkpoint === 'object') {
        remote = data.checkpoint;
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
  try {
    await fetch('/api/cedar-checkpoint', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
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
