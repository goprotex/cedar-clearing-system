/**
 * Mapbox-native 3D tree stand-ins: small fill-extrusion cylinders from GeoJSON
 * so trees sit on terrain (DEM) — no custom WebGL layer required.
 */
import * as turf from '@turf/turf';
import type { TreePosition } from '@/lib/tree-layer';

const DEFAULT_MAX = 4000;

export function treeFeaturesForMapboxExtrusion(
  trees: TreePosition[],
  options?: { maxTrees?: number; circleSteps?: number },
): GeoJSON.FeatureCollection {
  const max = Math.min(options?.maxTrees ?? DEFAULT_MAX, trees.length);
  const steps = Math.max(6, Math.min(24, options?.circleSteps ?? 12));
  const features: GeoJSON.Feature[] = [];

  for (let i = 0; i < max; i++) {
    const t = trees[i];
    const radiusM = Math.max(1.2, (t.canopyDiameter || 3) / 2);
    const height = Math.max(2, Math.min(t.height || 8, 25));

    const color =
      t.species === 'cedar' ? '#15803d' : t.species === 'oak' ? '#a16207' : '#166534';

    try {
      const poly = turf.circle([t.lng, t.lat], radiusM, { steps, units: 'meters' });
      features.push({
        type: 'Feature',
        geometry: poly.geometry,
        properties: {
          species: t.species,
          height_m: height,
          color,
        },
      });
    } catch {
      /* skip bad coords */
    }
  }

  return { type: 'FeatureCollection', features };
}
