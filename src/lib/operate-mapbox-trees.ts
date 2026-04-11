/**
 * Mapbox-native 3D tree stand-ins: fill-extrusion polygons on terrain (DEM).
 * Cedars and mixed brush use the same stacked tapered cylinders (conical cedar silhouette).
 * Oak keeps a distinct shorter/wider volume for contrast when present.
 */
import * as turf from '@turf/turf';
import type { TreePosition } from '@/lib/cedar-tree-data';

type TreeSpecies = TreePosition['species'];

const DEFAULT_MAX = 4000;
/** Cap GeoJSON features (cedars emit 3 tiers each). */
const MAX_FEATURES = 9000;

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
  options?: { maxTrees?: number; circleSteps?: number },
): GeoJSON.FeatureCollection {
  const maxTrees = Math.min(options?.maxTrees ?? DEFAULT_MAX, trees.length);
  const steps = Math.max(8, Math.min(20, options?.circleSteps ?? 12));
  const features: GeoJSON.Feature[] = [];

  for (let i = 0; i < maxTrees && features.length < MAX_FEATURES; i++) {
    const t = trees[i];
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
