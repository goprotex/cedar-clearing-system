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
  chunkBboxes: number[][];
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

export function chunkBboxesEqual(a: number[][], b: number[][]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ra = a[i];
    const rb = b[i];
    if (!ra || !rb || ra.length !== rb.length) return false;
    for (let j = 0; j < ra.length; j++) {
      if (Math.abs(ra[j] - rb[j]) > 1e-9) return false;
    }
  }
  return true;
}

function storageKey(bidId: string, pastureId: string): string {
  return `${STORAGE_PREFIX}${bidId}_${pastureId}`;
}

export function loadCedarChunkResume(bidId: string, pastureId: string): CedarChunkResumeState | null {
  try {
    const raw = localStorage.getItem(storageKey(bidId, pastureId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CedarChunkResumeState;
    if (parsed.v !== CEDAR_RESUME_VERSION || !Array.isArray(parsed.parts) || !Array.isArray(parsed.chunkBboxes)) {
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
