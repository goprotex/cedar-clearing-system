/**
 * Mapbox-native 3D tree stand-ins: fill-extrusion polygons on terrain (DEM).
 * Cedars and mixed brush use the same stacked tapered cylinders (conical cedar silhouette).
 * Oak keeps a distinct shorter/wider volume for contrast when present.
 */
import * as turf from '@turf/turf';
import type { TreePosition } from '@/lib/cedar-tree-data';

type TreeSpecies = TreePosition['species'];

/** Display cap — raw tree list follows grid order; we shuffle before taking this many so the map fills the pasture, not one strip. */
const DEFAULT_MAX = 12000;
/** Cap GeoJSON features (cedars emit 3 tiers each ≈ ×3). */
const MAX_FEATURES = 40000;

/** Deterministic PRNG for stable shuffle given same seed (same frame data → same layout). */
function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Spread tree instances across the pasture when capping count (fixes “one vertical column” from grid iteration order). */
export function sampleTreesForDisplay(trees: TreePosition[], maxCount: number, seed: number): TreePosition[] {
  if (trees.length <= maxCount) return trees;
  const rand = mulberry32(seed);
  const idx = trees.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = idx[i]!;
    idx[i] = idx[j]!;
    idx[j] = t;
  }
  return idx.slice(0, maxCount).map((i) => trees[i]!);
}

function hashTreesSeed(trees: TreePosition[]): number {
  let h = trees.length | 0;
  const n = Math.min(48, trees.length);
  for (let i = 0; i < n; i++) {
    const t = trees[i]!;
    h = (Math.imul(31, h) + (t.lng * 100000) + (t.lat * 100000) + i) | 0;
  }
  return h;
}

const CEDAR_TIERS = [
  { hFrac: 0.38, rFrac: 1.0, color: '#134e2a' },
  { hFrac: 0.33, rFrac: 0.58, color: '#166534' },
  { hFrac: 0.29, rFrac: 0.34, color: '#1a7f3b' },
] as const;

function pushCylinder(
  features: GeoJSON.Feature[],
  lng: number,
  lat: number,
  radiusM: number,
  baseM: number,
  segmentHeightM: number,
  color: string,
  steps: number,
  species: TreeSpecies,
) {
  const poly = turf.circle([lng, lat], radiusM, { steps, units: 'meters' });
  features.push({
    type: 'Feature',
    geometry: poly.geometry,
    properties: {
      base_m: baseM,
      height_m: segmentHeightM,
      color,
      species,
    },
  });
}

export function treeFeaturesForMapboxExtrusion(
  trees: TreePosition[],
  options?: { maxTrees?: number; circleSteps?: number; seed?: number },
): GeoJSON.FeatureCollection {
  const cap = Math.min(options?.maxTrees ?? DEFAULT_MAX, trees.length);
  const seed = options?.seed ?? hashTreesSeed(trees);
  const displayTrees = sampleTreesForDisplay(trees, cap, seed);
  const steps = Math.max(8, Math.min(20, options?.circleSteps ?? 12));
  const features: GeoJSON.Feature[] = [];

  for (let i = 0; i < displayTrees.length && features.length < MAX_FEATURES; i++) {
    const t = displayTrees[i];
    const canopyR = Math.max(1.0, (t.canopyDiameter || 3) / 2);
    const height = Math.max(2, Math.min(t.height || 8, 25));

    try {
      if (t.species === 'cedar' || t.species === 'mixed') {
        // Stacked cone: three cylinders with decreasing radius (cedar / juniper silhouette).
        let base = 0;
        for (const tier of CEDAR_TIERS) {
          const segH = height * tier.hFrac;
          const r = Math.max(0.45, canopyR * tier.rFrac);
          pushCylinder(features, t.lng, t.lat, r, base, segH, tier.color, steps, t.species);
          base += segH;
          if (features.length >= MAX_FEATURES) break;
        }
      } else if (t.species === 'oak') {
        // Rounded canopy: wider, shorter ellipsoid-ish (single squat cylinder).
        const r = Math.max(1.2, canopyR * 1.05);
        const h = Math.min(height * 0.72, 18);
        pushCylinder(features, t.lng, t.lat, r, 0, h, '#92400e', steps, 'oak');
      }
    } catch {
      /* skip bad coords */
    }
  }

  return { type: 'FeatureCollection', features };
}
