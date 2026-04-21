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
  tileUrl: string;
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
    layerId: 'overlay-gas-pipelines-raster',
    // HIFLD tile cache — more reliable than MapServer/export for ArcGIS Online hosted services
    tileUrl:
      'https://tiles.arcgis.com/tiles/Hp6G80Pky0om6HgA/arcgis/rest/services/Pipelines_Hazardous_Liquids/MapServer/tile/{z}/{y}/{x}',
    defaultOpacity: 0.7,
    attribution: 'HIFLD / EIA',
  },
  {
    key: 'transmissionLines',
    label: 'Transmission Lines',
    emoji: '⚡',
    category: 'infrastructure',
    sourceId: 'overlay-transmission-lines',
    layerId: 'overlay-transmission-lines-raster',
    tileUrl:
      'https://tiles.arcgis.com/tiles/Hp6G80Pky0om6HgA/arcgis/rest/services/Electric_Power_Transmission_Lines/MapServer/tile/{z}/{y}/{x}',
    defaultOpacity: 0.7,
    attribution: 'HIFLD',
  },
  {
    key: 'substations',
    label: 'Substations',
    emoji: '🔌',
    category: 'infrastructure',
    sourceId: 'overlay-substations',
    layerId: 'overlay-substations-raster',
    tileUrl:
      'https://tiles.arcgis.com/tiles/Hp6G80Pky0om6HgA/arcgis/rest/services/Electric_Substations/MapServer/tile/{z}/{y}/{x}',
    defaultOpacity: 0.7,
    attribution: 'HIFLD',
  },
  {
    key: 'cellCoverage',
    label: 'Cell Coverage',
    emoji: '📶',
    category: 'infrastructure',
    sourceId: 'overlay-cell-coverage',
    layerId: 'overlay-cell-coverage-raster',
    tileUrl:
      'https://tiles.arcgis.com/tiles/Hp6G80Pky0om6HgA/arcgis/rest/services/Cellular_Towers/MapServer/tile/{z}/{y}/{x}',
    defaultOpacity: 0.7,
    attribution: 'HIFLD / FCC',
  },

  /* ── Environment ──────────────────────────────────────────────── */
  {
    key: 'treeCanopy',
    label: 'Tree Canopy',
    emoji: '🌳',
    category: 'environment',
    sourceId: 'overlay-tree-canopy',
    layerId: 'overlay-tree-canopy-raster',
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
        map.addSource(def.sourceId, {
          type: 'raster',
          tiles: [def.tileUrl],
          tileSize: 256,
        });
      }
      if (!map.getLayer(def.layerId)) {
        map.addLayer({
          id: def.layerId,
          type: 'raster',
          source: def.sourceId,
          paint: { 'raster-opacity': def.defaultOpacity },
          layout: { visibility: 'none' },
        });
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
      map.setPaintProperty(
        def.layerId,
        'raster-opacity',
        overlayOpacities[def.key],
      );
    } catch {
      // ignore – layer may not be fully loaded yet
    }
  }
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
