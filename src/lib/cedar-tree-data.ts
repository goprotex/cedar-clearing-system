// Tree positions derived from cedar analysis — shared by hologram map layers and operator view.

import * as turf from '@turf/turf';
import type { CedarAnalysis, MarkedTree } from '@/types';

export interface TreePosition {
  lng: number;
  lat: number;
  species: 'cedar' | 'oak' | 'mixed';
  height: number;
  canopyDiameter: number;
}

export interface PastureWall {
  id: string;
  coordinates: [number, number][];
  color: string;
}

type Species = 'cedar' | 'oak' | 'mixed';

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function extractTreesFromAnalysis(
  pastures: Array<{
    cedarAnalysis: { gridCells: GeoJSON.FeatureCollection; summary: { gridSpacingM: number } } | null;
    density: string;
  }>
): TreePosition[] {
  const trees: TreePosition[] = [];
  const rand = seededRandom(42);

  for (const pasture of pastures) {
    if (!pasture.cedarAnalysis?.gridCells?.features) continue;

    for (const feature of pasture.cedarAnalysis.gridCells.features) {
      const props = feature.properties ?? {};
      const cls = props.classification as string;
      if (cls !== 'cedar' && cls !== 'oak' && cls !== 'mixed_brush') continue;

      const species: Species = cls === 'mixed_brush' ? 'mixed' : (cls as Species);

      const ndvi = (props.ndvi as number) ?? 0.2;
      const bandVotes = (props.bandVotes as number) ?? 2;

      let treeCount = 5;
      if (ndvi > 0.6) treeCount += 10;
      else if (ndvi > 0.5) treeCount += 8;
      else if (ndvi > 0.4) treeCount += 6;
      else if (ndvi > 0.3) treeCount += 4;
      else if (ndvi > 0.2) treeCount += 2;
      else if (ndvi > 0.1) treeCount += 1;

      if (bandVotes >= 5) treeCount += 4;
      else if (bandVotes >= 4) treeCount += 3;
      else if (bandVotes >= 3) treeCount += 2;
      else if (bandVotes >= 2) treeCount += 1;

      // Hologram canopy: cedar cells carry most of the workload — bias density up vs oak/mixed
      if (species === 'cedar') {
        treeCount = Math.round(treeCount * 1.45);
      }

      const coords = (feature.geometry as GeoJSON.Polygon).coordinates[0];
      const lngs = coords.map((c) => c[0]);
      const lats = coords.map((c) => c[1]);
      const minLng = Math.min(...lngs);
      const maxLng = Math.max(...lngs);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);

      for (let t = 0; t < treeCount; t++) {
        const lng = minLng + rand() * (maxLng - minLng);
        const lat = minLat + rand() * (maxLat - minLat);
        const ndviScale = 0.7 + Math.min(ndvi, 0.7) * 1.0;

        let height: number;
        let canopy: number;
        if (species === 'cedar') {
          height = (4 + rand() * 8) * ndviScale;
          canopy = (3 + rand() * 5) * ndviScale;
        } else if (species === 'oak') {
          height = (5 + rand() * 7) * ndviScale;
          canopy = (5 + rand() * 7) * ndviScale;
        } else {
          height = (3 + rand() * 5) * ndviScale;
          canopy = (3 + rand() * 4) * ndviScale;
        }

        trees.push({
          lng,
          lat,
          species,
          height: Math.round(height * 10) / 10,
          canopyDiameter: Math.round(canopy * 10) / 10,
        });
      }
    }
  }

  return trees;
}

/** Max removal pins after analysis — avoids flooding the map; stride-samples across cedar cells. */
export const AUTO_MARK_CEDAR_MAX_PINS = 900;

function gridCellCentroid(feature: GeoJSON.Feature): [number, number] | null {
  const g = feature.geometry;
  if (!g) return null;
  try {
    if (g.type === 'Polygon') {
      return turf.centroid(turf.polygon(g.coordinates)).geometry.coordinates as [number, number];
    }
    if (g.type === 'MultiPolygon') {
      return turf.centroid(turf.multiPolygon(g.coordinates)).geometry.coordinates as [number, number];
    }
  } catch {
    return null;
  }
  return null;
}

type CedarCellPin = {
  lng: number;
  lat: number;
  confidence: number;
  bandVotes: number;
  ndvi: number;
};

/**
 * One map pin per cedar-classified grid cell (optionally subsampled).
 * Use this for auto-marked removals — not extractTreesFromAnalysis (which simulates many trees per cell for 3D view).
 */
export function buildAutoMarkedCedarsFromAnalysis(
  analysis: CedarAnalysis,
  maxPins: number = AUTO_MARK_CEDAR_MAX_PINS
): MarkedTree[] {
  const feats = analysis.gridCells?.features ?? [];
  const cands: CedarCellPin[] = [];

  for (const f of feats) {
    const props = (f.properties ?? {}) as Record<string, unknown>;
    if (props.classification !== 'cedar') continue;
    const ll = gridCellCentroid(f);
    if (!ll) continue;
    const ndvi = typeof props.ndvi === 'number' ? props.ndvi : 0.25;
    const confidence = typeof props.confidence === 'number' ? props.confidence : 0.5;
    const bandVotes = typeof props.bandVotes === 'number' ? props.bandVotes : 2;
    cands.push({ lng: ll[0], lat: ll[1], confidence, bandVotes, ndvi });
  }

  cands.sort((a, b) => {
    const dv = b.bandVotes - a.bandVotes;
    if (dv !== 0) return dv;
    return b.confidence - a.confidence;
  });

  const n = cands.length;
  if (n === 0) return [];

  const want = Math.min(n, maxPins);
  const picked: CedarCellPin[] = [];
  for (let j = 0; j < want; j++) {
    const idx = Math.min(n - 1, Math.floor((j + 0.5) * (n / want)));
    picked.push(cands[idx]);
  }

  const ts = Date.now();
  return picked.map((c, i) => {
    const ndviScale = 0.72 + Math.min(c.ndvi, 0.68) * 0.85;
    const height = Math.round((5 + c.ndvi * 9) * ndviScale * 10) / 10;
    const canopy = Math.round((3 + c.ndvi * 7) * ndviScale * 10) / 10;
    return {
      id: `cedar-cell-${ts}-${i}-${Math.random().toString(36).slice(2, 7)}`,
      lng: c.lng,
      lat: c.lat,
      species: 'cedar' as const,
      action: 'remove' as const,
      label: 'Remove cedar',
      height,
      canopyDiameter: canopy,
    };
  });
}
