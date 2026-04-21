import * as turf from '@turf/turf';
import type { Feature, Polygon } from 'geojson';
import type { CedarAnalysis, CedarAnalysisSummary, TileConsensusStats } from '@/types';

/** Target max sample points per HTTP request (keeps each chunk under serverless time limits). */
export const CEDAR_MAX_SAMPLES_PER_CHUNK = 3500;

type VegClass = 'cedar' | 'oak' | 'mixed_brush' | 'grass' | 'bare';

interface SamplePoint {
  lng: number;
  lat: number;
  classification: VegClass;
  confidence: number;
  bandVotes: number;
  ndvi: number;
  gndvi: number;
  savi: number;
}

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

/**
 * Overlapping tile consensus: applies spatial context refinement across the entire merged dataset.
 * Overlays 5×5-pixel tiles (75m) at 2-pixel stride (30m) = 60% overlap.
 * Each pixel covered by up to 9 tiles; tiles vote on classification via confidence weighting.
 * Eliminates salt-and-pepper noise and chunk boundary artifacts.
 */
function applyTileConsensusToFeatures(
  features: GeoJSON.Feature[],
  bbox: [number, number, number, number]
): { refined: GeoJSON.Feature[]; tileCount: number; consensusImprovedCells: number } {
  if (features.length < 4) {
    return { refined: features, tileCount: 0, consensusImprovedCells: 0 };
  }

  const spacingKm = 0.015; // 15m grid
  const centerLat = (bbox[1] + bbox[3]) / 2;
  const kmPerDegLng = 111.32 * Math.cos((centerLat * Math.PI) / 180);
  const kmPerDegLat = 111.32;
  const spacingLng = spacingKm / kmPerDegLng;
  const spacingLat = spacingKm / kmPerDegLat;

  const minLng = bbox[0];
  const minLat = bbox[1];

  interface IndexedFeature {
    feature: GeoJSON.Feature;
    sample: SamplePoint;
    col: number;
    row: number;
    originalIdx: number;
  }

  // Extract sample points from feature properties
  const indexed: IndexedFeature[] = features.map((f, i) => {
    const props = f.properties ?? {};
    const geom = f.geometry as GeoJSON.Polygon;
    const coords = geom.coordinates[0];
    
    // Get cell center
    let sx = 0, sy = 0;
    const n = coords.length - 1;
    for (let j = 0; j < n; j++) {
      sx += coords[j][0];
      sy += coords[j][1];
    }
    const lng = sx / n;
    const lat = sy / n;

    return {
      feature: f,
      sample: {
        lng,
        lat,
        classification: props.classification as VegClass,
        confidence: props.confidence as number,
        bandVotes: props.bandVotes as number,
        ndvi: props.ndvi as number,
        gndvi: props.gndvi as number,
        savi: props.savi as number,
      },
      col: Math.round((lng - minLng) / spacingLng),
      row: Math.round((lat - minLat) / spacingLat),
      originalIdx: i,
    };
  });

  const gridMap = new Map<string, IndexedFeature>();
  let maxCol = 0;
  let maxRow = 0;
  for (const ir of indexed) {
    gridMap.set(`${ir.col},${ir.row}`, ir);
    if (ir.col > maxCol) maxCol = ir.col;
    if (ir.row > maxRow) maxRow = ir.row;
  }

  const tileRadius = 2; // 5×5 tile: center ± 2
  const stride = 2;     // 60% overlap

  const pixelVotes: Array<Array<{ classification: VegClass; weight: number }>> =
    features.map(() => []);

  let tileCount = 0;

  for (let tc = 0; tc <= maxCol; tc += stride) {
    for (let tr = 0; tr <= maxRow; tr += stride) {
      const tilePixels: IndexedFeature[] = [];
      for (let dc = -tileRadius; dc <= tileRadius; dc++) {
        for (let dr = -tileRadius; dr <= tileRadius; dr++) {
          const px = gridMap.get(`${tc + dc},${tr + dr}`);
          if (px) tilePixels.push(px);
        }
      }

      if (tilePixels.length < 2) continue;
      tileCount++;

      const classWeight: Record<VegClass, number> = {
        cedar: 0, oak: 0, mixed_brush: 0, grass: 0, bare: 0,
      };
      for (const px of tilePixels) {
        const s = px.sample;
        classWeight[s.classification] += s.confidence * (1 + s.bandVotes * 0.2);
      }

      let winner: VegClass = 'bare';
      let maxW = -1;
      for (const cls of Object.keys(classWeight) as VegClass[]) {
        if (classWeight[cls] > maxW) {
          maxW = classWeight[cls];
          winner = cls;
        }
      }

      const agreeing = tilePixels.filter((p) => p.sample.classification === winner).length;
      const agreement = agreeing / tilePixels.length;
      const agreeConf =
        tilePixels
          .filter((p) => p.sample.classification === winner)
          .reduce((s, p) => s + p.sample.confidence, 0) / agreeing;

      const voteWeight = agreeConf * agreement;
      for (const px of tilePixels) {
        pixelVotes[px.originalIdx].push({ classification: winner, weight: voteWeight });
      }
    }
  }

  let consensusImprovedCells = 0;
  const refined = features.map((original, idx) => {
    const votes = pixelVotes[idx];
    if (votes.length === 0) return original;

    const props = original.properties ?? {};
    const originalClass = props.classification as VegClass;
    const originalConf = props.confidence as number;

    const cw: Record<VegClass, number> = {
      cedar: 0, oak: 0, mixed_brush: 0, grass: 0, bare: 0,
    };
    for (const v of votes) {
      cw[v.classification] += v.weight;
    }

    let bestClass: VegClass = originalClass;
    let bestWeight = -1;
    for (const cls of Object.keys(cw) as VegClass[]) {
      if (cw[cls] > bestWeight) {
        bestWeight = cw[cls];
        bestClass = cls;
      }
    }

    const totalWeight = Object.values(cw).reduce((a, b) => a + b, 0);
    const winFraction = totalWeight > 0 ? bestWeight / totalWeight : 0;

    if (bestClass !== originalClass) {
      consensusImprovedCells++;
      const newConf = Math.min(0.95, originalConf * 0.3 + winFraction * 0.7);
      return {
        ...original,
        properties: {
          ...props,
          classification: bestClass,
          confidence: Math.round(newConf * 100) / 100,
        },
      };
    }

    const boostedConf = Math.min(0.95, originalConf + winFraction * 0.15);
    return {
      ...original,
      properties: {
        ...props,
        confidence: Math.round(boostedConf * 100) / 100,
      },
    };
  });

  return { refined, tileCount, consensusImprovedCells };
}

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

  // Always apply tile consensus, even for single chunks (ensures consistency)
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

  // Compute bbox for tile consensus
  const lngs = mergedFeatures.map(f => {
    const geom = f.geometry as GeoJSON.Polygon;
    const coords = geom.coordinates[0];
    return coords.reduce((sum, c) => sum + c[0], 0) / (coords.length - 1);
  });
  const lats = mergedFeatures.map(f => {
    const geom = f.geometry as GeoJSON.Polygon;
    const coords = geom.coordinates[0];
    return coords.reduce((sum, c) => sum + c[1], 0) / (coords.length - 1);
  });

  const bbox: [number, number, number, number] = [
    Math.min(...lngs),
    Math.min(...lats),
    Math.max(...lngs),
    Math.max(...lats),
  ];

  // Apply tile consensus with full spatial context (no chunk boundaries)
  const { refined: refinedFeatures, tileCount, consensusImprovedCells } =
    applyTileConsensusToFeatures(mergedFeatures, bbox);

  // Recompute summary from consensus-refined features
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

  for (const f of refinedFeatures) {
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
    tileConsensus: {
      tileCount,
      tileOverlapPct: 60,
      tileSizePixels: 5,
      tileSizeM: 75, // 5 pixels × 15m
      stridePixels: 2,
      strideM: 30, // 2 pixels × 15m
      consensusImprovedCells,
      consensusImprovedPct: total > 0 ? Math.round((consensusImprovedCells / total) * 100) : 0,
    },
    chunkedRun: parts.length > 1 ? {
      chunkCount: parts.length,
      maxSamplesPerChunk: CEDAR_MAX_SAMPLES_PER_CHUNK,
    } : undefined,
  };

  return {
    gridCells: { type: 'FeatureCollection', features: refinedFeatures },
    summary,
  };
}
