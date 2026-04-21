// Native Mapbox GL layers for hologram mode — rounded tree shells via fill-extrusions aligned to terrain.

import mapboxgl from 'mapbox-gl';
import type { MarkedTree } from '@/types';
import type { PastureWall, TreePosition } from '@/lib/cedar-tree-data';

export type { PastureWall, TreePosition };
export { extractTreesFromAnalysis } from '@/lib/cedar-tree-data';

type Species = 'cedar' | 'oak' | 'mixed';

const HOLO_COLORS: Record<Species, string> = {
  cedar: '#00ff66',
  oak: '#ffaa00',
  // Same as cedar — mixed stands use the cedar silhouette in 3D operate mode.
  mixed: '#00ff66',
};

const WALL_HEIGHT_M = 40;

const TREE_SOURCE = 'holo-trees';
const WALL_SOURCE = 'holo-walls';
const MARK_SOURCE = 'holo-marks';

function circleRingMeters(
  lng: number,
  lat: number,
  radiusM: number,
  segments = 14,
): GeoJSON.Position[] {
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos((lat * Math.PI) / 180);
  const points: GeoJSON.Position[] = [];

  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    const dx = (Math.cos(theta) * radiusM) / metersPerDegLng;
    const dy = (Math.sin(theta) * radiusM) / metersPerDegLat;
    points.push([lng + dx, lat + dy]);
  }

  return points;
}

function treesToFeatureCollection(trees: TreePosition[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const t of trees) {
    const canopyRadius = Math.max(t.canopyDiameter / 2, 1.8);
    const trunkRadius = Math.max(canopyRadius * 0.16, 0.45);
    const totalHeight = Math.max(t.height, 2.5);
    const trunkHeight = Math.max(totalHeight * 0.22, 1.2);
    const shellColor = HOLO_COLORS[t.species];
    const trunkColor = t.species === 'oak' ? '#7c4a18' : '#5a3312';

    features.push({
      type: 'Feature',
      properties: {
        species: t.species,
        color: trunkColor,
        base: 0,
        top: trunkHeight,
      },
      geometry: { type: 'Polygon', coordinates: [circleRingMeters(t.lng, t.lat, trunkRadius, 10)] },
    });

    const shellProfile =
      t.species === 'cedar'
        ? [
            { base: 0.16, top: 0.42, radius: 0.58 },
            { base: 0.34, top: 0.7, radius: 0.92 },
            { base: 0.6, top: 0.92, radius: 0.74 },
            { base: 0.82, top: 1.06, radius: 0.42 },
          ]
        : [
            { base: 0.18, top: 0.4, radius: 0.52 },
            { base: 0.34, top: 0.68, radius: 0.86 },
            { base: 0.56, top: 0.9, radius: 1.0 },
            { base: 0.76, top: 1.04, radius: 0.7 },
          ];

    for (const shell of shellProfile) {
      const base = trunkHeight + totalHeight * shell.base;
      const top = trunkHeight + totalHeight * shell.top;
      features.push({
        type: 'Feature',
        properties: {
          species: t.species,
          color: shellColor,
          base,
          top,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [circleRingMeters(t.lng, t.lat, canopyRadius * shell.radius)],
        },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

function wallsToFeatureCollection(walls: PastureWall[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const w of walls) {
    if (w.coordinates.length < 3) continue;
    const ring = [...w.coordinates];
    if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
      ring.push(ring[0]);
    }
    features.push({
      type: 'Feature',
      properties: { color: w.color },
      geometry: { type: 'Polygon', coordinates: [ring] },
    });
  }
  return { type: 'FeatureCollection', features };
}

function marksToFeatureCollection(marked: MarkedTree[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const t of marked) {
    features.push({
      type: 'Feature',
      properties: {
        action: t.action,
        canopy: Math.max(t.canopyDiameter, 4),
      },
      geometry: { type: 'Point', coordinates: [t.lng, t.lat] },
    });
  }
  return { type: 'FeatureCollection', features };
}

function haversineM(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Mapbox-native hologram: fill-extrusion trees + walls aligned to terrain; circles for save/remove marks.
 */
export class HologramMapboxLayers {
  private map: mapboxgl.Map;
  private trees: TreePosition[] = [];
  private speciesVisible: Record<Species, boolean> = { cedar: true, oak: true, mixed: true };
  private layersReady = false;

  constructor(map: mapboxgl.Map) {
    this.map = map;
  }

  private ensureLayers() {
    if (this.layersReady) return;
    const map = this.map;
    if (!map.getSource(TREE_SOURCE)) {
      map.addSource(TREE_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'holo-trees-extrusion',
        type: 'fill-extrusion',
        source: TREE_SOURCE,
        paint: {
          'fill-extrusion-height': ['get', 'top'],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-color': ['get', 'color'],
          'fill-extrusion-opacity': 0.92,
          'fill-extrusion-height-alignment': 'terrain',
          'fill-extrusion-base-alignment': 'terrain',
        },
      });
    }

    if (!map.getSource(WALL_SOURCE)) {
      map.addSource(WALL_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'holo-walls-extrusion',
        type: 'fill-extrusion',
        source: WALL_SOURCE,
        paint: {
          'fill-extrusion-height': WALL_HEIGHT_M,
          'fill-extrusion-base': 0,
          'fill-extrusion-color': ['coalesce', ['get', 'color'], '#00ff41'],
          'fill-extrusion-opacity': 0.35,
          'fill-extrusion-height-alignment': 'terrain',
          'fill-extrusion-base-alignment': 'terrain',
        },
      });
    }

    if (!map.getSource(MARK_SOURCE)) {
      map.addSource(MARK_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'holo-mark-circles',
        type: 'circle',
        source: MARK_SOURCE,
        paint: {
          'circle-radius': ['*', ['get', 'canopy'], 0.35],
          'circle-color': ['match', ['get', 'action'], 'save', '#00ff44', '#ff2244'],
          'circle-opacity': 0.85,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });
    }

    this.layersReady = true;
  }

  updateTrees(trees: TreePosition[]) {
    this.trees = trees;
    this.ensureLayers();
    const src = this.map.getSource(TREE_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    if (src) {
      src.setData(treesToFeatureCollection(trees));
    }
    this.applySpeciesFilters();
  }

  setSpeciesVisible(species: Species, visible: boolean) {
    this.speciesVisible[species] = visible;
    this.applySpeciesFilters();
  }

  getSpeciesVisible(): Record<Species, boolean> {
    return { ...this.speciesVisible };
  }

  private applySpeciesFilters() {
    if (!this.map.getLayer('holo-trees-extrusion')) return;
    const active = (['cedar', 'oak', 'mixed'] as Species[]).filter((sp) => this.speciesVisible[sp]);
    if (active.length === 3) {
      this.map.setFilter('holo-trees-extrusion', null);
      return;
    }
    if (active.length === 0) {
      this.map.setFilter('holo-trees-extrusion', ['==', ['get', 'species'], ''] as mapboxgl.Expression);
      return;
    }
    const parts: unknown[] = ['any'];
    for (const sp of active) {
      parts.push(['==', ['get', 'species'], sp]);
    }
    this.map.setFilter('holo-trees-extrusion', parts as mapboxgl.Expression);
  }

  updatePolygonWalls(walls: PastureWall[]) {
    this.ensureLayers();
    const src = this.map.getSource(WALL_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    if (src) src.setData(wallsToFeatureCollection(walls));
  }

  updateMarkedTrees(marked: MarkedTree[]) {
    this.ensureLayers();
    const src = this.map.getSource(MARK_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    if (src) src.setData(marksToFeatureCollection(marked));
  }

  findNearestTree(lng: number, lat: number, radiusM = 20): TreePosition | null {
    if (this.trees.length === 0) return null;
    let best: TreePosition | null = null;
    let bestD = Infinity;
    for (const t of this.trees) {
      const d = haversineM(lng, lat, t.lng, t.lat);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return bestD <= radiusM ? best : null;
  }

  remove() {
    const map = this.map;
    for (const id of ['holo-mark-circles', 'holo-walls-extrusion', 'holo-trees-extrusion']) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    for (const id of [MARK_SOURCE, WALL_SOURCE, TREE_SOURCE]) {
      if (map.getSource(id)) map.removeSource(id);
    }
    this.layersReady = false;
    this.trees = [];
  }
}
