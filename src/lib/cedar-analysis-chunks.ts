import * as turf from '@turf/turf';
import type { Feature, Polygon, MultiPolygon, Position } from 'geojson';

/** Matches cedar-detect route: 15 m point grid → ~225 m² per sample cell */
export const CEDAR_GRID_SPACING_M = 15;
export const CEDAR_GRID_SPACING_KM = CEDAR_GRID_SPACING_M / 1000;
export const SMALL_PASTURE_CEDAR_GRID_SPACING_M = 10;
export const SMALL_PASTURE_ACREAGE_THRESHOLD = 100;

function acreageFromAreaM2(areaM2: number): number {
  return areaM2 / 4047;
}

export function getCedarGridSpacingMForAcreage(acreage: number): number {
  return acreage > 0 && acreage < SMALL_PASTURE_ACREAGE_THRESHOLD
    ? SMALL_PASTURE_CEDAR_GRID_SPACING_M
    : CEDAR_GRID_SPACING_M;
}

export function getCedarGridSpacingKmForAcreage(acreage: number): number {
  return getCedarGridSpacingMForAcreage(acreage) / 1000;
}

/**
 * Prefer a single whole-pasture staged run whenever the sample count is still
 * within a range the cedar-detect route can usually complete in one request.
 */
export const WHOLE_PASTURE_STAGE_SAMPLE_LIMIT = 4000;

/**
 * Target max samples per /api/cedar-detect invocation so each chunk finishes
 * comfortably within serverless limits while still running every refinement pass
 * on smaller regions when users prefer fidelity over total processing time.
 */
export const TARGET_SAMPLES_PER_CHUNK = 240;

const MAX_SPLIT_DEPTH = 24;
const MIN_SPLIT_DEG = 1e-7;

function estimateSampleCount(areaM2: number, spacingM: number): number {
  const samplesPerCellEst = spacingM * spacingM;
  return Math.max(1, Math.ceil(areaM2 / samplesPerCellEst));
}

export function estimateCedarSampleCount(areaM2: number): number {
  return estimateSampleCount(areaM2, getCedarGridSpacingMForAcreage(acreageFromAreaM2(areaM2)));
}

function expandToPolygonFeatures(feat: Feature<Polygon | MultiPolygon>): Feature<Polygon>[] {
  const g = feat.geometry;
  if (g.type === 'Polygon') {
    return [{ type: 'Feature', geometry: g, properties: feat.properties ?? {} }];
  }
  return g.coordinates.map((rings) => ({
    type: 'Feature' as const,
    geometry: { type: 'Polygon' as const, coordinates: rings },
    properties: feat.properties ?? {},
  }));
}

function intersectPair(a: Feature<Polygon>, b: Feature<Polygon>): Feature<Polygon | MultiPolygon> | null {
  return turf.intersect(turf.featureCollection([a, b]));
}

/**
 * Recursively splits a pasture polygon until each piece is small enough that the
 * 15 m grid in cedar-detect will stay under TARGET_SAMPLES_PER_CHUNK.
 */
/** Pasture area in acres (matches cedar-detect `turf.area / 4047`). */
export function polygonAcreage(coords: Position[][]): number {
  return turf.area(turf.polygon(coords)) / 4047;
}

/**
 * When a pasture fits in one TARGET_SAMPLES_PER_CHUNK but has >1 grid cell,
 * split once so we always have ≥2 regions (resume checkpoints after each chunk).
 */
function splitPastureOnceForResume(poly: Feature<Polygon>): Position[][][] {
  const bbox = turf.bbox(poly);
  const [minX, minY, maxX, maxY] = bbox;
  const w = maxX - minX;
  const h = maxY - minY;
  if (w < MIN_SPLIT_DEG && h < MIN_SPLIT_DEG) return [];

  const splitVertical = w >= h;
  let leftBox: Feature<Polygon>;
  let rightBox: Feature<Polygon>;
  if (splitVertical) {
    const mid = (minX + maxX) / 2;
    leftBox = turf.bboxPolygon([minX, minY, mid, maxY]);
    rightBox = turf.bboxPolygon([mid, minY, maxX, maxY]);
  } else {
    const mid = (minY + maxY) / 2;
    leftBox = turf.bboxPolygon([minX, minY, maxX, mid]);
    rightBox = turf.bboxPolygon([minX, mid, maxX, maxY]);
  }

  const leftI = intersectPair(poly, leftBox);
  const rightI = intersectPair(poly, rightBox);
  const out: Position[][][] = [];
  for (const piece of [leftI, rightI]) {
    if (!piece) continue;
    for (const expanded of expandToPolygonFeatures(piece)) {
      out.push(expanded.geometry.coordinates);
    }
  }
  return out.length >= 2 ? out : [];
}

export function getCedarAnalysisChunkPolygons(coords: Position[][]): Position[][][] {
  const poly = turf.polygon(coords);
  const areaM2 = turf.area(poly);
  const spacingM = getCedarGridSpacingMForAcreage(acreageFromAreaM2(areaM2));
  const samples = estimateSampleCount(areaM2, spacingM);

  // Run stage-by-stage across the whole pasture whenever feasible instead of
  // finishing the full pipeline chunk-by-chunk.
  if (samples <= WHOLE_PASTURE_STAGE_SAMPLE_LIMIT) {
    return [coords];
  }

  // ~One 15 m cell — second chunk would be empty
  if (samples <= 1) {
    return [coords];
  }

  const targetMax = Math.min(TARGET_SAMPLES_PER_CHUNK, Math.max(1, Math.floor(samples / 2)));

  let chunks: Position[][][];
  if (samples <= targetMax) {
    const forced = splitPastureOnceForResume(poly);
    chunks = forced.length >= 2 ? forced : [coords];
  } else {
    const features = splitRecursiveWithBudget(poly, 0, targetMax, spacingM);
    const out: Position[][][] = [];
    for (const f of features) {
      for (const expanded of expandToPolygonFeatures(f)) {
        out.push(expanded.geometry.coordinates);
      }
    }
    chunks = out.length > 0 ? out : [coords];
  }

  return chunks.length > 0 ? chunks : [coords];
}

function splitRecursiveWithBudget(
  poly: Feature<Polygon>,
  depth: number,
  maxSamplesPerLeaf: number,
  spacingM: number,
): Feature<Polygon | MultiPolygon>[] {
  const areaM2 = turf.area(poly);
  const samples = estimateSampleCount(areaM2, spacingM);
  if (samples <= maxSamplesPerLeaf || depth >= MAX_SPLIT_DEPTH) {
    return [poly];
  }

  const bbox = turf.bbox(poly);
  const [minX, minY, maxX, maxY] = bbox;
  const w = maxX - minX;
  const h = maxY - minY;
  if (w < MIN_SPLIT_DEG && h < MIN_SPLIT_DEG) {
    return [poly];
  }

  const splitVertical = w >= h;
  let leftBox: Feature<Polygon>;
  let rightBox: Feature<Polygon>;

  if (splitVertical) {
    const mid = (minX + maxX) / 2;
    leftBox = turf.bboxPolygon([minX, minY, mid, maxY]);
    rightBox = turf.bboxPolygon([mid, minY, maxX, maxY]);
  } else {
    const mid = (minY + maxY) / 2;
    leftBox = turf.bboxPolygon([minX, minY, maxX, mid]);
    rightBox = turf.bboxPolygon([minX, mid, maxX, maxY]);
  }

  const leftI = intersectPair(poly, leftBox);
  const rightI = intersectPair(poly, rightBox);

  const next: Feature<Polygon | MultiPolygon>[] = [];
  for (const piece of [leftI, rightI]) {
    if (!piece) continue;
    for (const expanded of expandToPolygonFeatures(piece)) {
      next.push(...splitRecursiveWithBudget(expanded, depth + 1, maxSamplesPerLeaf, spacingM));
    }
  }

  return next.length > 0 ? next : [poly];
}
