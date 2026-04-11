import * as turf from '@turf/turf';
import type { Feature, Polygon } from 'geojson';
import type { CedarAnalysis, CedarAnalysisSummary, TileConsensusStats } from '@/types';

/** Target max sample points per HTTP request (keeps each chunk under serverless time limits). */
export const CEDAR_MAX_SAMPLES_PER_CHUNK = 3500;

function estimateSampleCountFromAcres(acreage: number): number {
  const areaM2 = Math.max(0, acreage) * 4046.8564224;
  const cellM2 = 15 * 15;
  return Math.max(1, Math.ceil(areaM2 / cellM2));
}

/**
 * Recursively split bbox until each piece's clipped polygon has ≤ max estimated samples.
 * Guarantees coverage of irregular shapes (not just a coarse grid over the outer bbox).
 */
function collectChunkBboxes(
  polygon: Feature<Polygon>,
  bbox: [number, number, number, number],
  pastureAcres: number,
  maxSamples: number
): [number, number, number, number][] {
  const polyArea = turf.area(polygon);
  if (polyArea <= 0) return [];

  const clipped = turf.bboxClip(polygon, bbox);
  if (!clipped || turf.area(clipped) <= 0) return [];

  const clippedAcres = (turf.area(clipped) / polyArea) * pastureAcres;
  const est = estimateSampleCountFromAcres(clippedAcres);

  if (est <= maxSamples) {
    return [bbox];
  }

  const [minLng, minLat, maxLng, maxLat] = bbox;
  const w = maxLng - minLng;
  const h = maxLat - minLat;
  if (w < 1e-8 || h < 1e-8) {
    return [bbox];
  }

  const splitVertical = w >= h;
  let a: [number, number, number, number];
  let b: [number, number, number, number];

  if (splitVertical) {
    const mid = (minLng + maxLng) / 2;
    a = [minLng, minLat, mid, maxLat];
    b = [mid, minLat, maxLng, maxLat];
  } else {
    const mid = (minLat + maxLat) / 2;
    a = [minLng, minLat, maxLng, mid];
    b = [minLng, mid, maxLng, maxLat];
  }

  return [...collectChunkBboxes(polygon, a, pastureAcres, maxSamples), ...collectChunkBboxes(polygon, b, pastureAcres, maxSamples)];
}

/**
 * Build non-overlapping chunk bboxes that cover the pasture.
 *
 * **Always chunks** when there is more than one estimated sample point: each HTTP request
 * stays small (time-safe) and every run can save resume checkpoints after each region.
 *
 * Empty array = degenerate case (~one grid cell): fall back to a single full-polygon request.
 */
export function buildSpectralChunkBboxes(
  coordinates: number[][][],
  acreage: number
): number[][] {
  const polygon = turf.polygon(coordinates);
  const bbox = turf.bbox(polygon) as [number, number, number, number];
  const est = estimateSampleCountFromAcres(acreage);

  // ~One 15m cell: a second region would be empty — use one API call.
  if (est <= 1) {
    return [];
  }

  // Target at least 2 regions: cap each leaf at roughly half the grid (and never above max).
  // Large pastures still subdivide until each leaf ≤ CEDAR_MAX_SAMPLES_PER_CHUNK.
  const halfEst = Math.max(1, Math.floor(est / 2));
  const maxSamplesPerChunk = Math.min(CEDAR_MAX_SAMPLES_PER_CHUNK, halfEst);

  const chunks = collectChunkBboxes(polygon, bbox, acreage, maxSamplesPerChunk);

  // Degenerate bbox (near-zero width/height): recursion may return a single cell — OK.
  return chunks.length > 0 ? chunks : [];
}

type VegClass = 'cedar' | 'oak' | 'mixed_brush' | 'grass' | 'bare';

function mergeTileConsensus(parts: CedarAnalysis[], mergedTotal: number): TileConsensusStats | undefined {
  const withTc = parts.filter((p) => p.summary.tileConsensus);
  if (withTc.length === 0) return undefined;
  const first = withTc[0].summary.tileConsensus!;
  let tileCount = 0;
  let consensusImprovedCells = 0;
  for (const p of withTc) {
    const t = p.summary.tileConsensus!;
    tileCount += t.tileCount;
    consensusImprovedCells += t.consensusImprovedCells;
  }
  return {
    ...first,
    tileCount,
    consensusImprovedCells,
    consensusImprovedPct:
      mergedTotal > 0 ? Math.round((consensusImprovedCells / mergedTotal) * 100) : 0,
  };
}

/**
 * Merge chunked analyses: dedupe cells by cell center (6 decimals), recompute summary for full pasture.
 */
export function mergeCedarChunkResults(parts: CedarAnalysis[], acreage: number): CedarAnalysis {
  if (parts.length === 0) {
    return {
      gridCells: { type: 'FeatureCollection', features: [] },
      summary: {
        totalSamples: 0,
        cedar: { count: 0, pct: 0 },
        oak: { count: 0, pct: 0 },
        mixedBrush: { count: 0, pct: 0 },
        grass: { count: 0, pct: 0 },
        bare: { count: 0, pct: 0 },
        estimatedCedarAcres: 0,
        averageNDVI: 0,
        averageGNDVI: 0,
        averageSAVI: 0,
        confidence: 0,
        avgBandVotes: 0,
        highConfidenceCedarCells: 0,
        gridSpacingM: 15,
      },
    };
  }

  if (parts.length === 1) {
    return parts[0];
  }

  const mergedFeatures: GeoJSON.Feature[] = [];
  const seen = new Set<string>();

  for (const part of parts) {
    for (const f of part.gridCells.features) {
      const g = f.geometry as GeoJSON.Polygon;
      const coords = g?.coordinates?.[0];
      if (!coords || coords.length < 2) continue;
      let sx = 0;
      let sy = 0;
      const n = coords.length - 1;
      for (let i = 0; i < n; i++) {
        sx += coords[i][0];
        sy += coords[i][1];
      }
      const lng = sx / n;
      const lat = sy / n;
      const key = `${lng.toFixed(6)},${lat.toFixed(6)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      mergedFeatures.push(f);
    }
  }

  const total = mergedFeatures.length;
  if (total === 0) {
    return parts[0];
  }

  let cedarCount = 0;
  let oakCount = 0;
  let mixedCount = 0;
  let grassCount = 0;
  let bareCount = 0;
  let sumNdvi = 0;
  let sumGndvi = 0;
  let sumSavi = 0;
  let sumConf = 0;
  let sumBandVotes = 0;
  let highConfCedar = 0;

  for (const f of mergedFeatures) {
    const p = f.properties ?? {};
    const cls = p.classification as VegClass;
    if (cls === 'cedar') cedarCount++;
    else if (cls === 'oak') oakCount++;
    else if (cls === 'mixed_brush') mixedCount++;
    else if (cls === 'grass') grassCount++;
    else bareCount++;

    sumNdvi += (p.ndvi as number) ?? 0;
    sumGndvi += (p.gndvi as number) ?? 0;
    sumSavi += (p.savi as number) ?? 0;
    sumConf += (p.confidence as number) ?? 0;
    sumBandVotes += (p.bandVotes as number) ?? 0;
    if (cls === 'cedar' && ((p.bandVotes as number) ?? 0) >= 3) highConfCedar++;
  }

  const cedarPct = cedarCount / total;

  const summary: CedarAnalysisSummary = {
    totalSamples: total,
    cedar: { count: cedarCount, pct: Math.round(cedarPct * 100) },
    oak: { count: oakCount, pct: Math.round((oakCount / total) * 100) },
    mixedBrush: { count: mixedCount, pct: Math.round((mixedCount / total) * 100) },
    grass: { count: grassCount, pct: Math.round((grassCount / total) * 100) },
    bare: { count: bareCount, pct: Math.round((bareCount / total) * 100) },
    estimatedCedarAcres: Math.round(cedarPct * acreage * 10) / 10,
    averageNDVI: Math.round((sumNdvi / total) * 1000) / 1000,
    averageGNDVI: Math.round((sumGndvi / total) * 1000) / 1000,
    averageSAVI: Math.round((sumSavi / total) * 1000) / 1000,
    confidence: Math.round((sumConf / total) * 100),
    avgBandVotes: Math.round((sumBandVotes / total) * 10) / 10,
    highConfidenceCedarCells: highConfCedar,
    gridSpacingM: 15,
    tileConsensus: mergeTileConsensus(parts, total),
    chunkedRun: {
      chunkCount: parts.length,
      maxSamplesPerChunk: CEDAR_MAX_SAMPLES_PER_CHUNK,
    },
  };

  return {
    gridCells: { type: 'FeatureCollection', features: mergedFeatures },
    summary,
  };
}
