/**
 * Shared map overlay layer definitions.
 *
 * Each "overlay" layer is a raster tile source fetched from a public WMS /
 * ArcGIS REST MapServer.  The definitions are consumed by both the bid-page
 * scout map (MapContainer) and the operate map (OperatorClient).
 */

import type mapboxgl from 'mapbox-gl';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type OverlayLayerKey =
  | 'floodHazardZones'
  | 'forestRisk'
  | 'viirsHotspots'
  | 'gasPipelines'
  | 'transmissionLines'
  | 'substations';

export interface OverlayLayerDef {
  key: OverlayLayerKey;
  label: string;
  emoji: string;
  category: LayerCategory;
  sourceId: string;
  layerId: string;
  sourceType: 'raster' | 'dynamic-geojson';
  tileUrl?: string;
  serviceUrl?: string;
  geometryKind?: 'line' | 'point' | 'fill' | 'symbol';
  queryWhere?: string;
  defaultOpacity: number;
  /** Optional attribution shown in the map's attribution control. */
  attribution?: string;
}

export type LayerCategory =
  | 'boundaries'
  | 'hazards'
  | 'infrastructure'
  | 'environment';

export interface LayerCategoryDef {
  id: LayerCategory;
  label: string;
  emoji: string;
}

/* ------------------------------------------------------------------ */
/*  Category metadata (render order)                                   */
/* ------------------------------------------------------------------ */

export const LAYER_CATEGORIES: LayerCategoryDef[] = [
  { id: 'boundaries', label: 'Boundaries', emoji: '📍' },
  { id: 'hazards', label: 'Hazards', emoji: '⚠️' },
  { id: 'infrastructure', label: 'Infrastructure', emoji: '🏗️' },
  { id: 'environment', label: 'Environment', emoji: '🌿' },
];

/* ------------------------------------------------------------------ */
/*  Overlay layer definitions                                          */
/* ------------------------------------------------------------------ */

export const OVERLAY_LAYERS: OverlayLayerDef[] = [
  /* ── Hazards ──────────────────────────────────────────────────── */
  {
    key: 'floodHazardZones',
    label: 'Flood Hazard Zones',
    emoji: '💧',
    category: 'hazards',
    sourceId: 'overlay-flood-hazard-zones',
    layerId: 'overlay-flood-hazard-zones-fill',
    sourceType: 'dynamic-geojson',
    geometryKind: 'fill',
    serviceUrl:
      'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Flood_Hazard_Reduced_Set_gdb/FeatureServer/0',
    defaultOpacity: 0.45,
    attribution: 'FEMA / Esri Living Atlas',
  },
  {
    key: 'forestRisk',
    label: 'Forest Pest Risk',
    emoji: '🐞',
    category: 'environment',
    sourceId: 'overlay-forest-risk',
    layerId: 'overlay-forest-risk-raster',
    sourceType: 'raster',
    tileUrl:
      'https://imagery.geoplatform.gov/iipp/rest/services/Forest_Management/USFS_FHAAST_NIDRM_Map_Watershed_by_NF/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image&layers=show:0,3,4,7,8,11',
    defaultOpacity: 0.36,
    attribution: 'USFS FHAAST NIDRM',
  },
  {
    key: 'viirsHotspots',
    label: 'VIIRS Hotspots',
    emoji: '🛰️',
    category: 'hazards',
    sourceId: 'overlay-viirs-hotspots',
    layerId: 'overlay-viirs-hotspots-point',
    sourceType: 'dynamic-geojson',
    geometryKind: 'point',
    serviceUrl:
      'https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/Satellite_VIIRS_Thermal_Hotspots_and_Fire_Activity/FeatureServer/0',
    defaultOpacity: 0.75,
    attribution: 'NASA LANCE / Esri Live Feeds',
  },

  /* ── Infrastructure ───────────────────────────────────────────── */
  {
    key: 'gasPipelines',
    label: 'Gas Pipelines',
    emoji: '⛽',
    category: 'infrastructure',
    sourceId: 'overlay-gas-pipelines',
    layerId: 'overlay-gas-pipelines-line',
    sourceType: 'dynamic-geojson',
    geometryKind: 'line',
    serviceUrl:
      'https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/Natural_Gas_Interstate_and_Intrastate_Pipelines_1/FeatureServer/0',
    defaultOpacity: 0.7,
    attribution: 'EIA / HIFLD',
  },
  {
    key: 'transmissionLines',
    label: 'Transmission Lines',
    emoji: '⚡',
    category: 'infrastructure',
    sourceId: 'overlay-transmission-lines',
    layerId: 'overlay-transmission-lines-line',
    sourceType: 'dynamic-geojson',
    geometryKind: 'line',
    serviceUrl:
      'https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/US_Electric_Power_Transmission_Lines/FeatureServer/0',
    defaultOpacity: 0.7,
    attribution: 'HIFLD',
  },
  {
    key: 'substations',
    label: 'Substations',
    emoji: '⚡',
    category: 'infrastructure',
    sourceId: 'overlay-substations',
    layerId: 'overlay-substations-point',
    sourceType: 'dynamic-geojson',
    geometryKind: 'symbol',
    serviceUrl:
      'https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/Electric_Substations/FeatureServer/0',
    defaultOpacity: 0.7,
    attribution: 'HIFLD',
  },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Build the default overlayLayers state (all off). */
export function defaultOverlayState(): Record<OverlayLayerKey, boolean> {
  const state = {} as Record<OverlayLayerKey, boolean>;
  for (const l of OVERLAY_LAYERS) state[l.key] = false;
  return state;
}

/** Build the default overlayOpacities state. */
export function defaultOverlayOpacities(): Record<OverlayLayerKey, number> {
  const ops = {} as Record<OverlayLayerKey, number>;
  for (const l of OVERLAY_LAYERS) ops[l.key] = l.defaultOpacity;
  return ops;
}

/**
 * Add all overlay raster sources and layers to a Mapbox map instance.
 * Call this inside the `map.on('load', …)` handler.
 */
export function addOverlaySourcesToMap(map: mapboxgl.Map): void {
  for (const def of OVERLAY_LAYERS) {
    try {
      if (!map.getSource(def.sourceId)) {
        if (def.sourceType === 'raster') {
          map.addSource(def.sourceId, {
            type: 'raster',
            tiles: [def.tileUrl as string],
            tileSize: 256,
          });
        } else {
          map.addSource(def.sourceId, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          });
        }
      }
      if (!map.getLayer(def.layerId)) {
        if (def.sourceType === 'raster') {
          map.addLayer({
            id: def.layerId,
            type: 'raster',
            source: def.sourceId,
            paint: { 'raster-opacity': def.defaultOpacity },
            layout: { visibility: 'none' },
          });
        } else if (def.geometryKind === 'line') {
          map.addLayer({
            id: def.layerId,
            type: 'line',
            source: def.sourceId,
            paint: getOverlayLinePaint(def),
            layout: { visibility: 'none' },
          });
        } else if (def.geometryKind === 'point') {
          map.addLayer({
            id: def.layerId,
            type: 'circle',
            source: def.sourceId,
            paint: getOverlayCirclePaint(def),
            layout: { visibility: 'none' },
          });
        } else if (def.geometryKind === 'symbol') {
          map.addLayer({
            id: def.layerId,
            type: 'symbol',
            source: def.sourceId,
            layout: getOverlaySymbolLayout(def),
            paint: getOverlaySymbolPaint(def),
          });
        } else {
          map.addLayer({
            id: def.layerId,
            type: 'fill',
            source: def.sourceId,
            paint: getOverlayFillPaint(def),
            layout: { visibility: 'none' },
          });
        }
      }
    } catch {
      // Graceful degradation – source/layer unavailable at runtime
    }
  }
}

/**
 * Sync overlay layer visibility and opacity on the map.
 * Call inside the effect that watches layer state changes.
 */
export function syncOverlayVisibility(
  map: mapboxgl.Map,
  overlayLayers: Record<OverlayLayerKey, boolean>,
  overlayOpacities: Record<OverlayLayerKey, number>,
): void {
  for (const def of OVERLAY_LAYERS) {
    const layer = map.getLayer(def.layerId);
    if (!layer) continue;
    try {
      map.setLayoutProperty(
        def.layerId,
        'visibility',
        overlayLayers[def.key] ? 'visible' : 'none',
      );
      if (def.sourceType === 'raster') {
        map.setPaintProperty(def.layerId, 'raster-opacity', overlayOpacities[def.key]);
      } else if (def.geometryKind === 'line') {
        map.setPaintProperty(def.layerId, 'line-opacity', overlayOpacities[def.key]);
      } else if (def.geometryKind === 'point') {
        map.setPaintProperty(def.layerId, 'circle-opacity', overlayOpacities[def.key]);
        map.setPaintProperty(def.layerId, 'circle-stroke-opacity', Math.min(1, overlayOpacities[def.key] + 0.15));
      } else if (def.geometryKind === 'symbol') {
        map.setPaintProperty(def.layerId, 'text-opacity', overlayOpacities[def.key]);
      } else {
        map.setPaintProperty(def.layerId, 'fill-opacity', overlayOpacities[def.key]);
      }
    } catch {
      // ignore – layer may not be fully loaded yet
    }
  }
}

const overlayViewportCache = new WeakMap<mapboxgl.Map, Map<OverlayLayerKey, string>>();

function getOverlayLinePaint(def: OverlayLayerDef): mapboxgl.LinePaint {
  if (def.key === 'gasPipelines') {
    return {
      'line-color': '#dc2626',
      'line-width': 2,
      'line-opacity': def.defaultOpacity,
    };
  }

  return {
    'line-color': '#f59e0b',
    'line-width': 1.6,
    'line-opacity': def.defaultOpacity,
  };
}

function getOverlayCirclePaint(def: OverlayLayerDef): mapboxgl.CirclePaint {
  if (def.key === 'viirsHotspots') {
    return {
      'circle-color': '#ef4444',
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 2, 8, 3.5, 11, 5.5, 14, 7],
      'circle-opacity': def.defaultOpacity,
      'circle-stroke-color': '#fff7ed',
      'circle-stroke-width': 1,
      'circle-stroke-opacity': Math.min(1, def.defaultOpacity + 0.2),
    };
  }

  return {
    'circle-color': '#f97316',
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2, 9, 3.5, 12, 5],
    'circle-opacity': def.defaultOpacity,
    'circle-stroke-color': '#fff7ed',
    'circle-stroke-width': 0.8,
    'circle-stroke-opacity': Math.min(1, def.defaultOpacity + 0.15),
  };
}

function getOverlaySymbolLayout(def: OverlayLayerDef): mapboxgl.SymbolLayout {
  if (def.key === 'substations') {
    return {
      'text-field': '⚡',
      'text-size': ['interpolate', ['linear'], ['zoom'], 5, 12, 9, 15, 12, 18],
      'text-allow-overlap': true,
      visibility: 'none',
    };
  }

  return {
    'text-field': '•',
    'text-size': 12,
    'text-allow-overlap': true,
    visibility: 'none',
  };
}

function getOverlaySymbolPaint(def: OverlayLayerDef): mapboxgl.SymbolPaint {
  if (def.key === 'substations') {
    return {
      'text-color': '#facc15',
      'text-halo-color': '#1f2937',
      'text-halo-width': 1.2,
      'text-opacity': def.defaultOpacity,
    };
  }

  return {
    'text-color': '#f8fafc',
    'text-opacity': def.defaultOpacity,
  };
}

function getOverlayFillPaint(def: OverlayLayerDef): mapboxgl.FillPaint {
  if (def.key === 'floodHazardZones') {
    return {
      'fill-color': '#2563eb',
      'fill-opacity': def.defaultOpacity,
      'fill-outline-color': '#1d4ed8',
    };
  }

  return {
    'fill-color': '#22c55e',
    'fill-opacity': def.defaultOpacity,
    'fill-outline-color': '#166534',
  };
}

function bboxKey(map: mapboxgl.Map): string {
  const bounds = map.getBounds();
  if (!bounds) return 'no-bounds';
  return [
    bounds.getWest().toFixed(3),
    bounds.getSouth().toFixed(3),
    bounds.getEast().toFixed(3),
    bounds.getNorth().toFixed(3),
  ].join(',');
}

function buildInfrastructureOverlayUrl(def: OverlayLayerDef, map: mapboxgl.Map): string {
  const bounds = map.getBounds();
  if (!bounds) {
    const params = new URLSearchParams({
      layer: def.key,
      bbox: '-180,-90,180,90',
    });
    return `/api/map-overlays/infrastructure?${params.toString()}`;
  }

  const params = new URLSearchParams({
    layer: def.key,
    bbox: `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`,
  });

  return `/api/map-overlays/infrastructure?${params.toString()}`;
}

export async function refreshDynamicOverlaySources(
  map: mapboxgl.Map,
  overlayLayers: Record<OverlayLayerKey, boolean>,
): Promise<void> {
  let mapCache = overlayViewportCache.get(map);
  if (!mapCache) {
    mapCache = new Map<OverlayLayerKey, string>();
    overlayViewportCache.set(map, mapCache);
  }

  const currentBboxKey = bboxKey(map);
  const dynamicDefs = OVERLAY_LAYERS.filter((def) => def.sourceType === 'dynamic-geojson');

  await Promise.all(
    dynamicDefs.map(async (def) => {
      const source = map.getSource(def.sourceId) as mapboxgl.GeoJSONSource | undefined;
      if (!source || !overlayLayers[def.key]) return;
      if (mapCache?.get(def.key) === currentBboxKey) return;

      try {
        const res = await fetch(buildInfrastructureOverlayUrl(def, map), {
          credentials: 'same-origin',
        });
        if (!res.ok) throw new Error(`overlay fetch failed: ${res.status}`);
        const geojson = (await res.json()) as GeoJSON.FeatureCollection;
        source.setData(geojson);
        mapCache?.set(def.key, currentBboxKey);
      } catch {
        source.setData({ type: 'FeatureCollection', features: [] });
      }
    }),
  );
}

/** Group overlay definitions by category for UI rendering. */
export function overlaysByCategory(): Map<LayerCategory, OverlayLayerDef[]> {
  const grouped = new Map<LayerCategory, OverlayLayerDef[]>();
  for (const cat of LAYER_CATEGORIES) {
    grouped.set(cat.id, []);
  }
  for (const l of OVERLAY_LAYERS) {
    const arr = grouped.get(l.category);
    if (arr) arr.push(l);
  }
  return grouped;
}
