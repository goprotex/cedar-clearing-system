import * as turf from '@turf/turf';

/**
 * Calculate acreage from a GeoJSON polygon feature.
 */
export function calculateAcreage(polygon: GeoJSON.Feature<GeoJSON.Polygon>): number {
  const sqMeters = turf.area(polygon);
  if (sqMeters <= 0) return 0;
  return Math.round((sqMeters / 4046.8564224) * 100) / 100;
}

/**
 * Get the centroid of a polygon as [lng, lat].
 */
export function getCentroid(polygon: GeoJSON.Feature<GeoJSON.Polygon>): [number, number] {
  const c = turf.centroid(polygon);
  return c.geometry.coordinates as [number, number];
}

/**
 * Get the bounding box of a polygon.
 */
export function getBBox(polygon: GeoJSON.Feature<GeoJSON.Polygon>): [number, number, number, number] {
  return turf.bbox(polygon) as [number, number, number, number];
}
