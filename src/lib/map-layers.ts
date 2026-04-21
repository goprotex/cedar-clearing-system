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
  | 'county'
  | 'parcels'
  | 'femaFlood'
  | 'wildfireRisk'
  | 'burnHistory'
  | 'burnBan'
  | 'gasPipelines'
  | 'transmissionLines'
  | 'substations'
  | 'cellCoverage'
  | 'treeCanopy'
  | 'vegetationType';

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
  geometryKind?: 'line' | 'point' | 'fill';
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
  /* ── Boundaries ───────────────────────────────────────────────── */
  {
    key: 'county',
    label: 'County Lines',
    emoji: '🗺️',
    category: 'boundaries',
    sourceId: 'overlay-county',
    layerId: 'overlay-county-raster',
    sourceType: 'raster',
    tileUrl:
      'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2022/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png&transparent=true&f=image&layers=show:84',
    defaultOpacity: 0.7,
    attribution: 'US Census Bureau TIGER',
  },
  {
    key: 'parcels',
    label: 'Parcel Boundaries',
    emoji: '📐',
    category: 'boundaries',
    sourceId: 'overlay-parcels',
    layerId: 'overlay-parcels-raster',
    sourceType: 'raster',
    // Census block-level land divisions (free/public). For precise TX parcel lines,
    // replace with your county CAD ArcGIS service URL (e.g. Kerr CAD GIS server).
    tileUrl:
      'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2022/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png&transparent=true&f=image&layers=show:18,22',
    defaultOpacity: 0.6,
    attribution: 'US Census Bureau TIGER',
  },

  /* ── Hazards ──────────────────────────────────────────────────── */
  {
    key: 'femaFlood',
    label: 'FEMA Flood Zones',
    emoji: '🌊',
    category: 'hazards',
    sourceId: 'overlay-fema-flood',
    layerId: 'overlay-fema-flood-raster',
    sourceType: 'raster',
    tileUrl:
      'https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png&transparent=true&dpi=96&f=image&layers=show:28',
    defaultOpacity: 0.55,
    attribution: 'FEMA NFHL',
  },
  {
    key: 'wildfireRisk',
    label: 'Wildfire Risk',
    emoji: '🔥',
    category: 'hazards',
    sourceId: 'overlay-wildfire-risk',
    layerId: 'overlay-wildfire-risk-raster',
    sourceType: 'raster',
    tileUrl:
      'https://apps.fs.usda.gov/arcgis/rest/services/RDW_Wildfire/ProbabilisticWildfireRisk/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png&transparent=true&dpi=96&f=image&layers=show:0',
    defaultOpacity: 0.55,
    attribution: 'USFS',
  },
  {
    key: 'burnHistory',
    label: 'Burn History',
    emoji: '🪵',
    category: 'hazards',
    sourceId: 'overlay-burn-history',
    layerId: 'overlay-burn-history-raster',
    sourceType: 'raster',
    tileUrl:
      'https://apps.fs.usda.gov/arcgis/rest/services/RDW_Wildfire/MTBS_BurnSeverity/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png&transparent=true&dpi=96&f=image&layers=show:0',
    defaultOpacity: 0.55,
    attribution: 'USFS MTBS',
  },
  {
    key: 'burnBan',
    label: 'Burn Ban Status',
    emoji: '🚫',
    category: 'hazards',
    sourceId: 'overlay-burn-ban',
    layerId: 'overlay-burn-ban-raster',
    sourceType: 'raster',
    // NIFC (National Interagency Fire Center) active fire perimeters — replaces
    // retired USGS GeoMAC service (shut down 2020)
    tileUrl:
      'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/Current_WildlandFire_Perimeters/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png&transparent=true&dpi=96&f=image',
    defaultOpacity: 0.5,
    attribution: 'NIFC',
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
    emoji: '🔌',
    category: 'infrastructure',
    sourceId: 'overlay-substations',
    layerId: 'overlay-substations-point',
    sourceType: 'dynamic-geojson',
    geometryKind: 'point',
    serviceUrl:
      'https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/Electric_Substations/FeatureServer/0',
    defaultOpacity: 0.7,
    attribution: 'HIFLD',
  },
  {
    key: 'cellCoverage',
    label: 'Cell Coverage',
    emoji: '📶',
    category: 'infrastructure',
    sourceId: 'overlay-cell-coverage',
    layerId: 'overlay-cell-coverage-fill',
    sourceType: 'dynamic-geojson',
    geometryKind: 'fill',
    serviceUrl:
      'https://services3.arcgis.com/HVjI8GKrRtjcQ4Ry/arcgis/rest/services/Cell_towers_by_state_MB/FeatureServer/0',
    defaultOpacity: 0.35,
    attribution: 'Public cell coverage dataset',
  },

  /* ── Environment ──────────────────────────────────────────────── */
  {
    key: 'treeCanopy',
    label: 'Tree Canopy',
    emoji: '🌳',
    category: 'environment',
    sourceId: 'overlay-tree-canopy',
    layerId: 'overlay-tree-canopy-raster',
    sourceType: 'raster',
    tileUrl:
      'https://www.mrlc.gov/geoserver/mrlc_display/NLCD_2021_Tree_Canopy_L48/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=NLCD_2021_Tree_Canopy_L48&STYLES=&SRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=TRUE',
    defaultOpacity: 0.6,
    attribution: 'USGS NLCD',
  },
  {
    key: 'vegetationType',
    label: 'Vegetation Type',
    emoji: '🌾',
    category: 'environment',
    sourceId: 'overlay-vegetation-type',
    layerId: 'overlay-vegetation-type-raster',
    sourceType: 'raster',
    tileUrl:
      'https://landfire.cr.usgs.gov/arcgis/rest/services/Landfire/US_230/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png&transparent=true&dpi=96&f=image&layers=show:2',
    defaultOpacity: 0.55,
    attribution: 'USGS LANDFIRE',
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
            paint: {
              'line-color': def.key === 'gasPipelines' ? '#38bdf8' : '#f59e0b',
              'line-width': def.key === 'gasPipelines' ? 2 : 1.6,
              'line-opacity': def.defaultOpacity,
            },
            layout: { visibility: 'none' },
          });
        } else if (def.geometryKind === 'point') {
          map.addLayer({
            id: def.layerId,
            type: 'circle',
            source: def.sourceId,
            paint: {
              'circle-color': '#f97316',
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2, 9, 3.5, 12, 5],
              'circle-opacity': def.defaultOpacity,
              'circle-stroke-color': '#fff7ed',
              'circle-stroke-width': 0.8,
              'circle-stroke-opacity': Math.min(1, def.defaultOpacity + 0.15),
            },
            layout: { visibility: 'none' },
          });
        } else {
          map.addLayer({
            id: def.layerId,
            type: 'fill',
            source: def.sourceId,
            paint: {
              'fill-color': '#22c55e',
              'fill-opacity': def.defaultOpacity,
              'fill-outline-color': '#166534',
            },
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
      } else {
        map.setPaintProperty(def.layerId, 'fill-opacity', overlayOpacities[def.key]);
      }
    } catch {
      // ignore – layer may not be fully loaded yet
    }
  }
}

const overlayViewportCache = new WeakMap<mapboxgl.Map, Map<OverlayLayerKey, string>>();

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
