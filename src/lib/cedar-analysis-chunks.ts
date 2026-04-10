import * as turf from '@turf/turf';
import type { Feature, Polygon, MultiPolygon, Position } from 'geojson';

/** Matches cedar-detect route: 15 m point grid → ~225 m² per sample cell */
const SAMPLE_SPACING_M = 15;
const SAMPLES_PER_CELL_EST = SAMPLE_SPACING_M * SAMPLE_SPACING_M;

/**
 * Target max samples per /api/cedar-detect invocation so each chunk finishes
 * comfortably within serverless limits (many sequential NAIP HTTP calls per chunk).
 */
export const TARGET_SAMPLES_PER_CHUNK = 520;

const MAX_SPLIT_DEPTH = 24;
const MIN_SPLIT_DEG = 1e-7;

function estimateSampleCount(areaM2: number): number {
  return Math.max(1, Math.ceil(areaM2 / SAMPLES_PER_CELL_EST));
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

export function getCedarAnalysisChunkPolygons(coords: Position[][]): Position[][][] {
  const poly = turf.polygon(coords);
  const areaM2 = turf.area(poly);
  const samples = estimateSampleCount(areaM2);
  if (samples <= TARGET_SAMPLES_PER_CHUNK) {
    return [coords];
  }

  const features = splitRecursive(poly, 0);
  const out: Position[][][] = [];
  for (const f of features) {
    const g = f.geometry;
    if (g.type === 'Polygon') out.push(g.coordinates);
    else {
      for (const rings of g.coordinates) out.push(rings);
    }
  }
  return out.length > 0 ? out : [coords];
}

function splitRecursive(poly: Feature<Polygon>, depth: number): Feature<Polygon | MultiPolygon>[] {
  const areaM2 = turf.area(poly);
  const samples = estimateSampleCount(areaM2);
  if (samples <= TARGET_SAMPLES_PER_CHUNK || depth >= MAX_SPLIT_DEPTH) {
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
      next.push(...splitRecursive(expanded, depth + 1));
    }
  }

  return next.length > 0 ? next : [poly];
}
