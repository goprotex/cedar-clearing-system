/**
 * Custom MapboxDraw polygon mode that prevents accidental double-tap
 * from auto-closing the polygon on touch/mobile devices.
 *
 * On desktop: behaves identically to draw_polygon (double-click to finish).
 * On touch devices: double-tap is ignored; the user must tap the "Finish"
 * button or tap on the first vertex to close the ring.
 */
import MapboxDraw from '@mapbox/mapbox-gl-draw';

const DrawPolygonBase = MapboxDraw.modes.draw_polygon;

// Simple touch-device detection (checked once at import time)
const isTouchDevice = (): boolean => {
  if (typeof window === 'undefined') return false;
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const base: any = DrawPolygonBase;
const DrawPolygonMobile: any = { ...DrawPolygonBase };

/**
 * Override onTap: on touch devices, always treat taps as single clicks
 * (never as a double-click that would close the polygon).
 * Users can still close by tapping the first vertex or pressing "Finish".
 */
DrawPolygonMobile.onTap = function (this: any, state: any, e: any) {
  if (isTouchDevice()) {
    // Check if tapping on the origin vertex (to intentionally close the polygon)
    const featureTarget = e?.featureTarget;
    if (
      featureTarget?.properties?.meta === 'vertex' &&
      featureTarget?.properties?.coord_path === '0.0' &&
      state.currentVertexPosition > 2
    ) {
      // User explicitly tapped the first vertex — close the polygon
      return base.clickOnVertex.call(this, state, e);
    }

    // Otherwise just add another vertex — never auto-close on double-tap
    return base.clickAnywhere.call(this, state, e);
  }

  // Desktop: use default behavior (double-click to finish)
  if (typeof base.onTap === 'function') {
    return base.onTap.call(this, state, e);
  }
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export default DrawPolygonMobile;

/** Minimum coordinates for a valid GeoJSON polygon (3 vertices + closing point) */
const MIN_POLYGON_COORDS = 4;

/**
 * Programmatically finish the currently drawn polygon.
 * Called by the "Finish Drawing" button.
 */
export function finishDrawing(draw: MapboxDraw): GeoJSON.Feature<GeoJSON.Polygon> | null {
  const all = draw.getAll();
  if (!all.features.length) return null;

  const feature = all.features[0] as GeoJSON.Feature<GeoJSON.Polygon>;
  if (!feature || feature.geometry.type !== 'Polygon') return null;

  const coords = feature.geometry.coordinates[0];
  if (coords.length < MIN_POLYGON_COORDS) return null;

  // Delete the in-progress drawing and switch back to simple_select
  draw.deleteAll();
  draw.changeMode('simple_select' as never);

  return feature;
}
