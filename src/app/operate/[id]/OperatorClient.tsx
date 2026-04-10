'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import Link from 'next/link';
import type { Bid } from '@/types';
import { extractTreesFromAnalysis, type TreePosition } from '@/lib/tree-layer';
import { jobIdFromBidId, mergeClearedCellIds } from '@/lib/jobs';

const CLEAR_RADIUS_M = 8;
const GPS_OPTIONS: PositionOptions = { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 };
const OPERATOR_STYLE_HIGH = 'mapbox://styles/mapbox/satellite-streets-v12';
const OPERATOR_STYLE_LOW = 'mapbox://styles/mapbox/satellite-v9';
const OPERATOR_PUBLISH_MS = 2500;
const OPERATOR_PREFS_PREFIX = 'ccc_operator_prefs_';

type OperatorBaseStyle = 'satellite-streets' | 'satellite' | 'outdoors';

type OperatorLayerPrefs = {
  baseStyle: OperatorBaseStyle;
  terrain3d: boolean;
  sky: boolean;
  ndvi: boolean;
  hillshade: boolean;
  topo: boolean;
  hydro: boolean;
  soils: boolean;
  naipTrueColor: boolean;
  naipCIR: boolean;
  wetlands: boolean;
  myData: boolean;
  hideLabels: boolean;
  hideRoads: boolean;
};

function prefsKey(bidId: string) {
  return `${OPERATOR_PREFS_PREFIX}${bidId}`;
}

function defaultPrefs(coarsePointer: boolean): OperatorLayerPrefs {
  return {
    baseStyle: coarsePointer ? 'satellite' : 'satellite-streets',
    terrain3d: !coarsePointer,
    sky: !coarsePointer,
    ndvi: false,
    hillshade: !coarsePointer,
    topo: false,
    hydro: false,
    soils: false,
    naipTrueColor: false,
    naipCIR: false,
    wetlands: false,
    myData: true,
    hideLabels: false,
    hideRoads: false,
  };
}

function loadPrefs(bidId: string, coarsePointer: boolean): OperatorLayerPrefs {
  try {
    const raw = localStorage.getItem(prefsKey(bidId));
    if (!raw) return defaultPrefs(coarsePointer);
    const parsed = JSON.parse(raw) as Partial<OperatorLayerPrefs> | null;
    const base = defaultPrefs(coarsePointer);
    if (!parsed || typeof parsed !== 'object') return base;
    return {
      baseStyle: parsed.baseStyle ?? base.baseStyle,
      terrain3d: typeof parsed.terrain3d === 'boolean' ? parsed.terrain3d : base.terrain3d,
      sky: typeof parsed.sky === 'boolean' ? parsed.sky : base.sky,
      ndvi: typeof parsed.ndvi === 'boolean' ? parsed.ndvi : base.ndvi,
      hillshade: typeof parsed.hillshade === 'boolean' ? parsed.hillshade : base.hillshade,
      topo: typeof parsed.topo === 'boolean' ? parsed.topo : base.topo,
      hydro: typeof parsed.hydro === 'boolean' ? parsed.hydro : base.hydro,
      soils: typeof parsed.soils === 'boolean' ? parsed.soils : base.soils,
      naipTrueColor: typeof parsed.naipTrueColor === 'boolean' ? parsed.naipTrueColor : base.naipTrueColor,
      naipCIR: typeof parsed.naipCIR === 'boolean' ? parsed.naipCIR : base.naipCIR,
      wetlands: typeof parsed.wetlands === 'boolean' ? parsed.wetlands : base.wetlands,
      myData: typeof parsed.myData === 'boolean' ? parsed.myData : base.myData,
      hideLabels: typeof parsed.hideLabels === 'boolean' ? parsed.hideLabels : base.hideLabels,
      hideRoads: typeof parsed.hideRoads === 'boolean' ? parsed.hideRoads : base.hideRoads,
    };
  } catch {
    return defaultPrefs(coarsePointer);
  }
}

function savePrefs(bidId: string, prefs: OperatorLayerPrefs) {
  localStorage.setItem(prefsKey(bidId), JSON.stringify(prefs));
}

const TILE_USGS_TOPO = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}';
const TILE_USGS_HYDRO = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSHydroCached/MapServer/tile/{z}/{y}/{x}';
const TILE_SSURGO_SOILS = 'https://tiles.arcgis.com/tiles/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Soils_Map_Units_Tiles_v6/MapServer/tile/{z}/{y}/{x}?cacheKey=81d68046345c13a6';
// NOTE: Wetlands overlay uses exportImage (not cached tiles) because the public cached endpoint is often slow/unavailable.
const TILE_NWI_WETLANDS_EXPORT =
  'https://fwsprimary.wim.usgs.gov/server/rest/services/Wetlands_Raster/ImageServer/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png&f=image';

function styleUrl(style: OperatorBaseStyle): string {
  if (style === 'satellite') return 'mapbox://styles/mapbox/satellite-v9';
  if (style === 'outdoors') return 'mapbox://styles/mapbox/outdoors-v12';
  return 'mapbox://styles/mapbox/satellite-streets-v12';
}

function setLayerVisibilitySafe(map: mapboxgl.Map, layerId: string, visible: boolean) {
  try {
    if (!map.getLayer(layerId)) return;
    map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
  } catch {
    // ignore
  }
}

function setStyleGroupVisibility(map: mapboxgl.Map, predicate: (layer: mapboxgl.Layer) => boolean, visible: boolean) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layers = (map.getStyle() as any)?.layers as mapboxgl.Layer[] | undefined;
    if (!layers) return;
    for (const l of layers) {
      if (!l?.id) continue;
      if (!predicate(l)) continue;
      setLayerVisibilitySafe(map, l.id, visible);
    }
  } catch {
    // ignore
  }
}

function setTerrainEnabledSafe(map: mapboxgl.Map, enabled: boolean) {
  try {
    if (!enabled) {
      map.setTerrain(null);
      return;
    }
    const srcId = 'mapbox-dem';
    if (!map.getSource(srcId)) {
      map.addSource(srcId, {
        type: 'raster-dem',
        url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
        tileSize: 512,
        maxzoom: 14,
      });
    }
    map.setTerrain({ source: srcId, exaggeration: 1.2 });
  } catch {
    // ignore
  }
}

function setSkyEnabledSafe(map: mapboxgl.Map, enabled: boolean) {
  try {
    const id = 'sky';
    if (!enabled) {
      if (map.getLayer(id)) map.removeLayer(id);
      return;
    }
    if (map.getLayer(id)) return;
    map.addLayer({
      id,
      type: 'sky',
      paint: {
        'sky-type': 'atmosphere',
        'sky-atmosphere-sun': [0.0, 90.0],
        'sky-atmosphere-sun-intensity': 15,
      },
    });
  } catch {
    // ignore
  }
}

function ensureRasterTileLayer(map: mapboxgl.Map, opts: { id: string; tiles: string[]; opacity: number; zIndex?: 'bottom' | 'top' }) {
  try {
    const srcId = `${opts.id}-src`;
    if (!map.getSource(srcId)) {
      map.addSource(srcId, { type: 'raster', tiles: opts.tiles, tileSize: 256 });
    }
    if (!map.getLayer(opts.id)) {
      map.addLayer({
        id: opts.id,
        type: 'raster',
        source: srcId,
        paint: { 'raster-opacity': opts.opacity },
        layout: { visibility: 'none' },
      });
    }
  } catch {
    // ignore
  }
}

function ensureHillshadeLayer(map: mapboxgl.Map) {
  try {
    const srcId = 'mapbox-dem';
    if (!map.getSource(srcId)) {
      map.addSource(srcId, {
        type: 'raster-dem',
        url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
        tileSize: 512,
        maxzoom: 14,
      });
    }
    const id = 'hillshade';
    if (!map.getLayer(id)) {
      map.addLayer({
        id,
        type: 'hillshade',
        source: srcId,
        paint: {
          'hillshade-exaggeration': 0.4,
          'hillshade-shadow-color': '#0b120d',
          'hillshade-highlight-color': '#d6ffe1',
          'hillshade-accent-color': '#5aff8a',
        },
        layout: { visibility: 'none' },
      });
    }
  } catch {
    // ignore
  }
}

async function tryLoadGeoJson(url: string): Promise<GeoJSON.FeatureCollection | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    if (!data || typeof data !== 'object') return null;
    const fc = data as GeoJSON.FeatureCollection;
    if (fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) return null;
    return fc;
  } catch {
    return null;
  }
}

interface ClearedCell {
  cellIndex: number;
  pastureId: string;
  timestamp: number;
}

interface OperatorState {
  bid: Bid | null;
  trees: TreePosition[];
  clearedCellIds: Set<string>;
  clearedCells: ClearedCell[];
  gpsActive: boolean;
  operatorPos: [number, number] | null;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  totalClearedAcres: number;
  sessionStart: number;
}

function storageKey(bidId: string) {
  return `ccc_operator_${bidId}`;
}

function loadOperatorSession(bidId: string): { clearedCellIds: string[]; clearedCells: ClearedCell[] } | null {
  try {
    const raw = localStorage.getItem(storageKey(bidId));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function saveOperatorSession(bidId: string, clearedCellIds: string[], clearedCells: ClearedCell[]) {
  localStorage.setItem(storageKey(bidId), JSON.stringify({ clearedCellIds, clearedCells }));
}

function haversineDistM(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export default function OperatorClient({ bidId }: { bidId: string }) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const trailCoordsRef = useRef<[number, number][]>([]);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapLoading, setMapLoading] = useState(false);
  const [hudOpen, setHudOpen] = useState(true);
  const [layersOpen, setLayersOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [sharedEnabled, setSharedEnabled] = useState(false);
  const lastPublishRef = useRef<number>(0);
  const [, setSharedStatus] = useState<'idle' | 'syncing' | 'ready' | 'unauth' | 'error'>('idle');
  const coarsePointerRef = useRef(false);

  const [layerPrefs, setLayerPrefs] = useState<OperatorLayerPrefs>(() => defaultPrefs(false));
  const layerPrefsRef = useRef(layerPrefs);
  layerPrefsRef.current = layerPrefs;

  const [state, setState] = useState<OperatorState>({
    bid: null, trees: [], clearedCellIds: new Set(), clearedCells: [],
    gpsActive: false, operatorPos: null, accuracy: null, heading: null, speed: null,
    totalClearedAcres: 0, sessionStart: Date.now(),
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  // Load bid from localStorage
  useEffect(() => {
    const raw = localStorage.getItem(`ccc_bid_${bidId}`);
    if (!raw) return;
    const bid: Bid = JSON.parse(raw);
    const trees = extractTreesFromAnalysis(bid.pastures);

    const coarsePointer =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches;
    coarsePointerRef.current = coarsePointer;
    const prefs = loadPrefs(bidId, coarsePointer);
    setLayerPrefs(prefs);

    const saved = loadOperatorSession(bidId);
    const clearedCellIds = new Set(saved?.clearedCellIds ?? []);
    const clearedCells = saved?.clearedCells ?? [];

    setState(prev => ({ ...prev, bid, trees, clearedCellIds, clearedCells }));
  }, [bidId]);

  useEffect(() => {
    try {
      savePrefs(bidId, layerPrefs);
    } catch {
      // ignore
    }
  }, [bidId, layerPrefs]);

  // Try to enable shared progress (Supabase-backed) if this bid has a Job and the user is authenticated.
  useEffect(() => {
    if (!state.bid) return;
    let cancelled = false;
    (async () => {
      try {
        setSharedStatus('syncing');
        const jobId = jobIdFromBidId(bidId);
        const res = await fetch(`/api/jobs/${jobId}/cleared-cells`, { cache: 'no-store' });
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            if (!cancelled) {
              setSharedEnabled(false);
              setSharedStatus('unauth');
            }
            return;
          }
          throw new Error(await res.text().catch(() => 'Failed to load shared progress.'));
        }
        const data = (await res.json()) as { cellIds: string[] };
        if (cancelled) return;
        setSharedEnabled(true);
        setSharedStatus('ready');
        setState((prev) => {
          const merged = mergeClearedCellIds(prev.clearedCellIds, data.cellIds ?? []);
          if (merged.size === prev.clearedCellIds.size) return prev;
          saveOperatorSession(bidId, Array.from(merged), prev.clearedCells);
          return { ...prev, clearedCellIds: merged };
        });
      } catch (e) {
        if (!cancelled) {
          setSharedEnabled(false);
          setSharedStatus('error');
          console.error('Shared progress sync failed:', e);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [bidId, state.bid]);

  // Compute cedar stats
  const cedarStats = useCallback(() => {
    const bid = stateRef.current.bid;
    if (!bid) return { total: 0, cleared: 0, remaining: 0, pct: 0 };
    let total = 0;
    for (const p of bid.pastures) {
      if (!p.cedarAnalysis?.gridCells?.features) continue;
      for (const f of p.cedarAnalysis.gridCells.features) {
        const cls = f.properties?.classification;
        if (cls === 'cedar' || cls === 'oak' || cls === 'mixed_brush') total++;
      }
    }
    const cleared = stateRef.current.clearedCellIds.size;
    return { total, cleared, remaining: Math.max(0, total - cleared), pct: total > 0 ? Math.round((cleared / total) * 100) : 0 };
  }, []);

  const [stats, setStats] = useState({ total: 0, cleared: 0, remaining: 0, pct: 0 });

  useEffect(() => {
    setStats(cedarStats());
  }, [state.clearedCellIds, state.bid, cedarStats]);

  // Build a flattened list of cedar cells with centroids for proximity checks
  const cedarCellsRef = useRef<Array<{ id: string; lng: number; lat: number; pastureId: string; cellIndex: number }>>([]);

  useEffect(() => {
    if (!state.bid) return;
    const cells: typeof cedarCellsRef.current = [];
    for (const p of state.bid.pastures) {
      if (!p.cedarAnalysis?.gridCells?.features) continue;
      p.cedarAnalysis.gridCells.features.forEach((f, idx) => {
        const cls = f.properties?.classification;
        if (cls !== 'cedar' && cls !== 'oak' && cls !== 'mixed_brush') return;
        const coords = (f.geometry as GeoJSON.Polygon).coordinates[0];
        const lngs = coords.map(c => c[0]);
        const lats = coords.map(c => c[1]);
        const centLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
        const centLat = (Math.min(...lats) + Math.max(...lats)) / 2;
        cells.push({ id: `${p.id}:${idx}`, lng: centLng, lat: centLat, pastureId: p.id, cellIndex: idx });
      });
    }
    cedarCellsRef.current = cells;
  }, [state.bid]);

  // Load optional custom operator data (property lines, fences, entrances) from public/ folder.
  const myDataRef = useRef<{ property: GeoJSON.FeatureCollection | null; fences: GeoJSON.FeatureCollection | null; entrances: GeoJSON.FeatureCollection | null }>({
    property: null,
    fences: null,
    entrances: null,
  });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const base = `/operator-data/${encodeURIComponent(bidId)}`;
      const [property, fencesA, fencesB, entrances] = await Promise.all([
        tryLoadGeoJson(`${base}/property-lines.geojson`),
        tryLoadGeoJson(`${base}/fences.geojson`),
        tryLoadGeoJson(`${base}/fence-lines.geojson`),
        tryLoadGeoJson(`${base}/entrances.geojson`),
      ]);
      const fences = fencesA ?? fencesB;
      if (cancelled) return;
      myDataRef.current = { property, fences, entrances };
      // If map is already loaded, update sources immediately.
      const map = mapRef.current;
      if (map && map.isStyleLoaded()) {
        try {
          if (property) {
            if (!map.getSource('my-property')) map.addSource('my-property', { type: 'geojson', data: property });
            else (map.getSource('my-property') as mapboxgl.GeoJSONSource).setData(property);
          }
          if (fences) {
            if (!map.getSource('my-fences')) map.addSource('my-fences', { type: 'geojson', data: fences });
            else (map.getSource('my-fences') as mapboxgl.GeoJSONSource).setData(fences);
          }
          if (entrances) {
            if (!map.getSource('my-entrances')) map.addSource('my-entrances', { type: 'geojson', data: entrances });
            else (map.getSource('my-entrances') as mapboxgl.GeoJSONSource).setData(entrances);
          }
        } catch {
          // ignore
        }
      }
    })();
    return () => { cancelled = true; };
  }, [bidId]);

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current || !state.bid) return;
    const bid = state.bid;
    const container = mapContainerRef.current;

    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

    if (!mapboxgl.supported({ failIfMajorPerformanceCaveat: false })) {
      setMapError('WebGL is not supported on this device/browser.');
      return;
    }

    const coarsePointer = coarsePointerRef.current;

    const addCustomLayers = () => {
      const map = mapRef.current;
      if (!map || !map.isStyleLoaded()) return;

      // Optional raster overlays
      ensureRasterTileLayer(map, { id: 'usgs-topo', tiles: [TILE_USGS_TOPO], opacity: 0.55 });
      ensureRasterTileLayer(map, { id: 'usgs-hydro', tiles: [TILE_USGS_HYDRO], opacity: 0.75 });
      ensureRasterTileLayer(map, { id: 'ssurgo-soils', tiles: [TILE_SSURGO_SOILS], opacity: 0.55 });
      ensureRasterTileLayer(map, { id: 'nwi-wetlands', tiles: [TILE_NWI_WETLANDS_EXPORT], opacity: 0.6 });
      ensureHillshadeLayer(map);

      // NAIP imagery cached tiles (truecolor/CIR). CIR is approximated via bandIds on tile requests if supported.
      // (If the service ignores bandIds in tile mode, the layer will still load as default imagery.)
      ensureRasterTileLayer(map, {
        id: 'naip-truecolor',
        tiles: ['https://gis.apfo.usda.gov/arcgis/rest/services/NAIP/USDA_CONUS_PRIME/ImageServer/tile/{z}/{y}/{x}'],
        opacity: 0.8,
      });
      ensureRasterTileLayer(map, {
        id: 'naip-cir',
        tiles: ['https://gis.apfo.usda.gov/arcgis/rest/services/NAIP/USDA_CONUS_PRIME/ImageServer/tile/{z}/{y}/{x}?bandIds=3,0,1'],
        opacity: 0.8,
      });

      // NAIP NDVI overlay (optional; can appear dark/black depending on server response)
      // Keep as optional even on iPad, but default it off.
      try {
        if (!map.getSource('naip-ndvi')) {
          map.addSource('naip-ndvi', {
            type: 'raster',
            tiles: [
              'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png&renderingRule=%7B%22rasterFunction%22%3A%22NDVI%22%2C%22rasterFunctionArguments%22%3A%7B%22VisibleBandID%22%3A0%2C%22InfraredBandID%22%3A3%7D%7D&f=image',
            ],
            tileSize: 256,
          });
        }
        if (!map.getLayer('naip-ndvi-overlay')) {
          map.addLayer({
            id: 'naip-ndvi-overlay',
            type: 'raster',
            source: 'naip-ndvi',
            paint: { 'raster-opacity': 0.85 },
            layout: { visibility: 'none' },
          });
        }
      } catch {
        // Optional overlay; ignore if it fails.
      }

      // Pasture polygon outlines with holographic green glow
      try {
        const pastureFeatures: GeoJSON.Feature[] = bid.pastures
          .filter(p => p.polygon.geometry.coordinates.length > 0)
          .map(p => ({
            type: 'Feature',
            geometry: p.polygon.geometry,
            properties: { name: p.name, color: '#00ff41' },
          }));

        if (!map.getSource('pastures')) {
          map.addSource('pastures', { type: 'geojson', data: { type: 'FeatureCollection', features: pastureFeatures } });
        } else {
          const src = map.getSource('pastures') as mapboxgl.GeoJSONSource;
          src.setData({ type: 'FeatureCollection', features: pastureFeatures });
        }

        if (!map.getLayer('pastures-fill')) {
          map.addLayer({ id: 'pastures-fill', type: 'fill', source: 'pastures', paint: { 'fill-color': '#00ff41', 'fill-opacity': 0.05 } });
        }
        if (!map.getLayer('pastures-border')) {
          map.addLayer({ id: 'pastures-border', type: 'line', source: 'pastures', paint: { 'line-color': '#00ff41', 'line-width': 2, 'line-dasharray': [2, 1] } });
        }
        if (!map.getLayer('pastures-label')) {
          map.addLayer({
            id: 'pastures-label',
            type: 'symbol',
            source: 'pastures',
            layout: { 'text-field': ['get', 'name'], 'text-size': 14, 'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'] },
            paint: { 'text-color': '#00ff41', 'text-halo-color': '#000', 'text-halo-width': 1.5 },
          });
        }
      } catch {
        // ignore
      }

      // Cedar grid cells — fill-extrusion with holographic coloring
      try {
        const allCedarFeatures: GeoJSON.Feature[] = [];
        for (const p of bid.pastures) {
          if (!p.cedarAnalysis?.gridCells?.features) continue;
          p.cedarAnalysis.gridCells.features.forEach((f, idx) => {
            const cls = f.properties?.classification;
            if (cls !== 'cedar' && cls !== 'oak' && cls !== 'mixed_brush') return;
            const cellId = `${p.id}:${idx}`;
            const holoColor = cls === 'cedar' ? '#00ff41' : cls === 'oak' ? '#ffaa00' : '#22dd44';
            allCedarFeatures.push({
              ...f,
              properties: { ...f.properties, cellId, holoColor, cleared: stateRef.current.clearedCellIds.has(cellId) ? 1 : 0 },
            });
          });
        }

        if (!map.getSource('cedar-cells')) {
          map.addSource('cedar-cells', { type: 'geojson', data: { type: 'FeatureCollection', features: allCedarFeatures } });
        } else {
          const src = map.getSource('cedar-cells') as mapboxgl.GeoJSONSource;
          src.setData({ type: 'FeatureCollection', features: allCedarFeatures });
        }

        if (coarsePointer) {
          if (!map.getLayer('cedar-cells-fill-2d')) {
            map.addLayer({
              id: 'cedar-cells-fill-2d',
              type: 'fill',
              source: 'cedar-cells',
              paint: {
                'fill-color': ['case', ['==', ['get', 'cleared'], 1], '#1f1f1f', ['get', 'holoColor']],
                'fill-opacity': ['case', ['==', ['get', 'cleared'], 1], 0.2, 0.55],
              },
            });
          }
          if (map.getLayer('cedar-cells-fill')) {
            try { map.removeLayer('cedar-cells-fill'); } catch { /* ignore */ }
          }
        } else {
          if (!map.getLayer('cedar-cells-fill')) {
            map.addLayer({
              id: 'cedar-cells-fill',
              type: 'fill-extrusion',
              source: 'cedar-cells',
              paint: {
                'fill-extrusion-color': ['case', ['==', ['get', 'cleared'], 1], '#333333', ['get', 'holoColor']],
                'fill-extrusion-opacity': 0.55,
                'fill-extrusion-height': ['case', ['==', ['get', 'cleared'], 1], 0.5, 3],
                'fill-extrusion-base': 0,
              },
            });
          }
          if (map.getLayer('cedar-cells-fill-2d')) {
            try { map.removeLayer('cedar-cells-fill-2d'); } catch { /* ignore */ }
          }
        }

        if (!map.getLayer('cedar-cells-border')) {
          map.addLayer({
            id: 'cedar-cells-border',
            type: 'line',
            source: 'cedar-cells',
            paint: {
              'line-color': ['case', ['==', ['get', 'cleared'], 1], '#555555', ['get', 'holoColor']],
              'line-width': 0.5,
              'line-opacity': 0.4,
            },
          });
        }
      } catch {
        // ignore
      }

      // Operator trail line
      try {
        if (!map.getSource('trail')) {
          map.addSource('trail', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} } });
        }
        if (!map.getLayer('trail-line')) {
          map.addLayer({ id: 'trail-line', type: 'line', source: 'trail', paint: { 'line-color': '#FF6B00', 'line-width': 3, 'line-opacity': 0.8 } });
        }
      } catch {
        // ignore
      }

      // My Data (property/fence/entrance) layers
      try {
        const { property, fences, entrances } = myDataRef.current;
        if (property) {
          if (!map.getSource('my-property')) map.addSource('my-property', { type: 'geojson', data: property });
          if (!map.getLayer('my-property-line')) {
            map.addLayer({
              id: 'my-property-line',
              type: 'line',
              source: 'my-property',
              paint: { 'line-color': '#ffffff', 'line-width': 3, 'line-opacity': 0.9 },
              layout: { visibility: 'none' },
            });
          }
        }
        if (fences) {
          if (!map.getSource('my-fences')) map.addSource('my-fences', { type: 'geojson', data: fences });
          if (!map.getLayer('my-fences-line')) {
            map.addLayer({
              id: 'my-fences-line',
              type: 'line',
              source: 'my-fences',
              paint: { 'line-color': '#FF6B00', 'line-width': 2, 'line-opacity': 0.9, 'line-dasharray': [2, 1] },
              layout: { visibility: 'none' },
            });
          }
        }
        if (entrances) {
          if (!map.getSource('my-entrances')) map.addSource('my-entrances', { type: 'geojson', data: entrances });
          if (!map.getLayer('my-entrances-point')) {
            map.addLayer({
              id: 'my-entrances-point',
              type: 'circle',
              source: 'my-entrances',
              paint: { 'circle-color': '#13ff43', 'circle-radius': 6, 'circle-stroke-color': '#000', 'circle-stroke-width': 2 },
              layout: { visibility: 'none' },
            });
          }
        }
      } catch {
        // ignore
      }
    };

    const applyPrefsToMap = () => {
      const map = mapRef.current;
      if (!map || !map.isStyleLoaded()) return;
      const prefs = layerPrefsRef.current;

      setTerrainEnabledSafe(map, prefs.terrain3d);
      setSkyEnabledSafe(map, prefs.sky);
      setLayerVisibilitySafe(map, 'hillshade', prefs.hillshade);
      setLayerVisibilitySafe(map, 'usgs-topo', prefs.topo);
      setLayerVisibilitySafe(map, 'usgs-hydro', prefs.hydro);
      setLayerVisibilitySafe(map, 'ssurgo-soils', prefs.soils);
      setLayerVisibilitySafe(map, 'naip-truecolor', prefs.naipTrueColor);
      setLayerVisibilitySafe(map, 'naip-cir', prefs.naipCIR);
      setLayerVisibilitySafe(map, 'naip-ndvi-overlay', prefs.ndvi);
      setLayerVisibilitySafe(map, 'my-property-line', prefs.myData);
      setLayerVisibilitySafe(map, 'my-fences-line', prefs.myData);
      setLayerVisibilitySafe(map, 'my-entrances-point', prefs.myData);

      // Hide/show labels and roads by toggling relevant style layers.
      setStyleGroupVisibility(
        map,
        (l) =>
          (l.type === 'symbol' &&
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            typeof (l as any)?.layout?.['text-field'] !== 'undefined') ||
          l.id.includes('label'),
        !prefs.hideLabels,
      );
      setStyleGroupVisibility(
        map,
        (l) =>
          l.id.includes('road') ||
          l.id.includes('bridge') ||
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          typeof (l as any)?.['source-layer'] === 'string' && String((l as any)['source-layer']).includes('road'),
        !prefs.hideRoads,
      );
    };

    let map: mapboxgl.Map;
    try {
      setMapLoading(true);
      map = new mapboxgl.Map({
        container,
        style: styleUrl(layerPrefsRef.current.baseStyle ?? (coarsePointer ? 'satellite' : 'satellite-streets')),
        center: bid.propertyCenter,
        zoom: bid.mapZoom,
        pitch: coarsePointer ? 0 : 45,
        antialias: true,
        preserveDrawingBuffer: true,
        failIfMajorPerformanceCaveat: false,
      });
    } catch (e) {
      setMapError(e instanceof Error ? e.message : 'Map failed to initialize.');
      setMapLoading(false);
      return;
    }

    map.on('error', (e) => {
      const msg =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (e as any)?.error?.message ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (e as any)?.error?.toString?.() ||
        'Mapbox failed to load.';
      setMapError(String(msg));
      setMapLoading(false);
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    map.addControl(new mapboxgl.ScaleControl({ unit: 'imperial' }), 'bottom-right');

    map.once('idle', () => {
      map.resize();
    });

    map.on('style.load', () => {
      setMapLoading(false);
      addCustomLayers();
      applyPrefsToMap();
    });

    // Watchdog: if the style never loads, surface a useful error instead of a blank map.
    const watchdog = window.setTimeout(() => {
      try {
        if (!mapRef.current) return;
        if (mapRef.current.isStyleLoaded()) return;
        const tokenSet = !!(process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '');
        setMapError(
          `Map style did not load. ${
            tokenSet
              ? 'This is usually a token restriction / invalid token / blocked tile request.'
              : 'NEXT_PUBLIC_MAPBOX_TOKEN is missing.'
          }`
        );
      } catch {
        setMapError('Map style did not load.');
      } finally {
        setMapLoading(false);
      }
    }, 9000);

    mapRef.current = map;

    return () => {
      window.clearTimeout(watchdog);
      map.remove();
      mapRef.current = null;
    };
  }, [state.bid]);

  // Apply prefs on change (and when style reloads)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      if (!map.isStyleLoaded()) return;
      const prefs = layerPrefsRef.current;
      setTerrainEnabledSafe(map, prefs.terrain3d);
      setSkyEnabledSafe(map, prefs.sky);
      setLayerVisibilitySafe(map, 'hillshade', prefs.hillshade);
      setLayerVisibilitySafe(map, 'usgs-topo', prefs.topo);
      setLayerVisibilitySafe(map, 'usgs-hydro', prefs.hydro);
      setLayerVisibilitySafe(map, 'ssurgo-soils', prefs.soils);
      setLayerVisibilitySafe(map, 'naip-truecolor', prefs.naipTrueColor);
      setLayerVisibilitySafe(map, 'naip-cir', prefs.naipCIR);
      setLayerVisibilitySafe(map, 'naip-ndvi-overlay', prefs.ndvi);
      setLayerVisibilitySafe(map, 'my-property-line', prefs.myData);
      setLayerVisibilitySafe(map, 'my-fences-line', prefs.myData);
      setLayerVisibilitySafe(map, 'my-entrances-point', prefs.myData);
      setStyleGroupVisibility(
        map,
        (l) =>
          (l.type === 'symbol' &&
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            typeof (l as any)?.layout?.['text-field'] !== 'undefined') ||
          l.id.includes('label'),
        !prefs.hideLabels,
      );
      setStyleGroupVisibility(
        map,
        (l) =>
          l.id.includes('road') ||
          l.id.includes('bridge') ||
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          typeof (l as any)?.['source-layer'] === 'string' && String((l as any)['source-layer']).includes('road'),
        !prefs.hideRoads,
      );
    };
    apply();
    map.on('styledata', apply);
    return () => {
      try { map.off('styledata', apply); } catch { /* ignore */ }
    };
  }, [layerPrefs]);

  // Resize on orientation change / viewport changes (iPad/Safari)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onResize = () => {
      try { map.resize(); } catch { /* ignore */ }
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [state.bid]);

  // Process GPS position — check cedar cells for clearing
  const updateCedarSource = useCallback(() => {
    const map = mapRef.current;
    const bid = stateRef.current.bid;
    if (!map || !map.isStyleLoaded() || !bid) return;

    const source = map.getSource('cedar-cells') as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;

    const features: GeoJSON.Feature[] = [];
    for (const p of bid.pastures) {
      if (!p.cedarAnalysis?.gridCells?.features) continue;
      p.cedarAnalysis.gridCells.features.forEach((f, idx) => {
        const cls = f.properties?.classification;
        if (cls !== 'cedar' && cls !== 'oak' && cls !== 'mixed_brush') return;
        const cellId = `${p.id}:${idx}`;
        const holoColor = cls === 'cedar' ? '#00ff41' : cls === 'oak' ? '#ffaa00' : '#22dd44';
        features.push({
          ...f,
          properties: { ...f.properties, cellId, holoColor, cleared: stateRef.current.clearedCellIds.has(cellId) ? 1 : 0 },
        });
      });
    }
    source.setData({ type: 'FeatureCollection', features });
  }, []);

  const processPosition = useCallback((lng: number, lat: number) => {
    const cells = cedarCellsRef.current;
    const currentState = stateRef.current;
    const newlyCleared: string[] = [];

    for (const cell of cells) {
      if (currentState.clearedCellIds.has(cell.id)) continue;
      const dist = haversineDistM(lng, lat, cell.lng, cell.lat);
      if (dist <= CLEAR_RADIUS_M) {
        newlyCleared.push(cell.id);
      }
    }

    if (newlyCleared.length > 0) {
      const ts = Date.now();
      setState(prev => {
        const nextIds = new Set(prev.clearedCellIds);
        const nextCells = [...prev.clearedCells];
        for (const id of newlyCleared) {
          nextIds.add(id);
          const parts = id.split(':');
          nextCells.push({ cellIndex: parseInt(parts[1]), pastureId: parts[0], timestamp: ts });
        }
        saveOperatorSession(bidId, Array.from(nextIds), nextCells);
        return { ...prev, clearedCellIds: nextIds, clearedCells: nextCells };
      });

      updateCedarSource();

      // Best-effort: if shared progress is enabled, append events so other users/devices see progress.
      if (sharedEnabled) {
        const jobId = jobIdFromBidId(bidId);
        void Promise.allSettled(
          newlyCleared.map((cellId) =>
            fetch(`/api/jobs/${jobId}/events`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: 'operator_cell_cleared', data: { cellId, timestamp: ts } }),
            })
          )
        ).then((results) => {
          const anyAuth = results.some((r) => r.status === 'fulfilled' && 'value' in r && (r.value as Response).status === 401);
          if (anyAuth) {
            setSharedEnabled(false);
            setSharedStatus('unauth');
          }
        }).catch(() => {
          // ignore (best-effort)
        });
      }
    }

    // Best-effort: publish operator position periodically for live monitor.
    if (sharedEnabled) {
      const now = Date.now();
      if (now - lastPublishRef.current >= OPERATOR_PUBLISH_MS) {
        lastPublishRef.current = now;
        const jobId = jobIdFromBidId(bidId);
        void fetch(`/api/jobs/${jobId}/operator-positions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lng,
            lat,
            accuracy_m: stateRef.current.accuracy,
            heading_deg: stateRef.current.heading,
            speed_mps: stateRef.current.speed,
            timestamp: now,
          }),
        }).catch(() => {
          // best-effort
        });
      }
    }

    trailCoordsRef.current.push([lng, lat]);
    const map = mapRef.current;
    if (map && map.isStyleLoaded()) {
      const trailSource = map.getSource('trail') as mapboxgl.GeoJSONSource | undefined;
      if (trailSource && trailCoordsRef.current.length >= 2) {
        trailSource.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: trailCoordsRef.current }, properties: {} });
      }
    }
  }, [bidId, updateCedarSource, sharedEnabled]);

  // Start/stop GPS
  const toggleGPS = useCallback(() => {
    if (stateRef.current.gpsActive) {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      setState(prev => ({ ...prev, gpsActive: false }));
      return;
    }

    if (!navigator.geolocation) {
      alert('Geolocation is not supported by this device.');
      return;
    }

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const lng = pos.coords.longitude;
        const lat = pos.coords.latitude;
        setState(prev => ({
          ...prev, gpsActive: true,
          operatorPos: [lng, lat],
          accuracy: pos.coords.accuracy,
          heading: pos.coords.heading,
          speed: pos.coords.speed,
        }));

        // Move marker
        if (markerRef.current) {
          markerRef.current.setLngLat([lng, lat]);
        } else if (mapRef.current) {
          const el = document.createElement('div');
          el.className = 'operator-marker';
          el.innerHTML = `<div style="width:20px;height:20px;background:#FF6B00;border:3px solid #fff;border-radius:50%;box-shadow:0 0 12px rgba(255,107,0,0.7);"></div>`;
          markerRef.current = new mapboxgl.Marker({ element: el }).setLngLat([lng, lat]).addTo(mapRef.current);
        }

        processPosition(lng, lat);
      },
      (err) => {
        console.error('GPS error:', err);
        setState(prev => ({ ...prev, gpsActive: false }));
      },
      GPS_OPTIONS,
    );

    watchIdRef.current = id;
    setState(prev => ({ ...prev, gpsActive: true, sessionStart: prev.clearedCells.length === 0 ? Date.now() : prev.sessionStart }));
  }, [processPosition]);

  // Recenter on operator
  const recenter = useCallback(() => {
    const pos = stateRef.current.operatorPos;
    if (pos && mapRef.current) {
      mapRef.current.flyTo({ center: pos, zoom: 17, pitch: 60, duration: 800 });
    }
  }, []);

  // Reset session
  const resetSession = useCallback(() => {
    localStorage.removeItem(storageKey(bidId));
    setState(prev => ({ ...prev, clearedCellIds: new Set(), clearedCells: [], totalClearedAcres: 0, sessionStart: Date.now() }));
    trailCoordsRef.current = [];
    setConfirmReset(false);
    updateCedarSource();
    // Also clear trail
    const map = mapRef.current;
    if (map && map.isStyleLoaded()) {
      const trailSource = map.getSource('trail') as mapboxgl.GeoJSONSource | undefined;
      if (trailSource) trailSource.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} });
    }
  }, [bidId, updateCedarSource]);

  // Cleanup GPS on unmount
  useEffect(() => {
    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';
  const elapsedMs = Date.now() - state.sessionStart;
  const bid = state.bid;

  if (!mapboxToken) {
    return (
      <div className="h-screen w-screen bg-[#131313] flex items-center justify-center text-[#e5e2e1]">
        <div className="text-center space-y-4">
          <div className="text-6xl">🛰️</div>
          <h1 className="text-2xl font-black text-[#FF6B00]">SIGNAL_LOST</h1>
          <p className="text-sm text-[#a98a7d]">
            Add <code className="bg-[#353534] px-1.5 py-0.5 text-[#FF6B00]">NEXT_PUBLIC_MAPBOX_TOKEN</code> to your <code className="bg-[#353534] px-1.5 py-0.5 text-[#FF6B00]">.env.local</code> file
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-[#131313] relative overflow-hidden hologram-mode">
      {/* Map container — always in DOM so ref is available when bid loads */}
      <div ref={mapContainerRef} className="absolute inset-0" />

      {/* No-bid overlay */}
      {!bid && (
        <div className="absolute inset-0 z-30 bg-[#131313] flex items-center justify-center text-[#e5e2e1]">
          <div className="text-center space-y-4">
            <div className="text-6xl">📋</div>
            <h1 className="text-2xl font-black text-[#FF6B00]">NO_BID_DATA</h1>
            <p className="text-sm text-[#a98a7d]">Bid not found in local storage</p>
            <Link href="/bids" className="inline-block bg-[#FF6B00] text-black px-6 py-3 font-bold uppercase tracking-widest text-sm hover:bg-white transition-all">
              Back to Bids
            </Link>
          </div>
        </div>
      )}

      {/* Holographic scan-line overlay */}
      {bid && <div className="holo-scanlines" />}

      {/* Map error overlay */}
      {bid && mapError && (
        <div className="absolute inset-0 z-40 bg-[#131313]/90 backdrop-blur-sm flex items-center justify-center text-[#e5e2e1]">
          <div className="max-w-md w-[92vw] border border-[#353534] bg-[#0e0e0e]/90 p-6 space-y-3">
            <div className="text-[#FF6B00] text-xl font-black uppercase tracking-widest">MAP_OFFLINE</div>
            <div className="text-xs font-mono text-[#a98a7d] break-words">{mapError}</div>
            <div className="text-[11px] text-[#a98a7d]">
              If this is a token/style error, verify <code className="bg-[#353534] px-1.5 py-0.5 text-[#FF6B00]">NEXT_PUBLIC_MAPBOX_TOKEN</code> and refresh.
            </div>
          </div>
        </div>
      )}

      {/* Top bar */}
      {bid && (
        <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-3 py-2 bg-[#000a02]/80 backdrop-blur-sm border-b border-green-900/40">
          <div className="flex items-center gap-3">
            <Link href={`/bid/${bidId}`} className="text-[#00ff41] font-black text-sm tracking-widest hover:text-white transition-colors">
              ← CEDAR_HACK
            </Link>
            <span className="text-[10px] text-[#a98a7d] font-mono hidden sm:inline">
              OPERATOR_MODE // {bid.bidNumber}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setLayersOpen((v) => !v)}
              className="text-[10px] font-mono text-[#a98a7d] hover:text-white border border-green-900/40 px-2 py-1 rounded"
              title="Map layers and filters"
            >
              {layersOpen ? 'LAYERS_CLOSE' : 'LAYERS'}
            </button>
            <span className={`w-2 h-2 rounded-full ${state.gpsActive ? 'bg-[#13ff43] animate-pulse' : 'bg-red-500'}`} />
            <span className="text-[10px] font-mono text-[#a98a7d]">
              {state.gpsActive ? 'GPS_LOCKED' : 'GPS_OFF'}
            </span>
          </div>
        </div>
      )}

      {/* Layers panel */}
      {bid && layersOpen && (
        <div className="absolute top-12 right-3 z-20 w-[92vw] max-w-sm border border-green-900/40 bg-[#0b120d]/90 backdrop-blur-md rounded-lg p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-[10px] text-[#00ff41] font-bold uppercase tracking-widest">Layers</div>
            <button onClick={() => setLayersOpen(false)} className="text-[#a98a7d] hover:text-white text-xs">✕</button>
          </div>

          <div className="space-y-2">
            <div className="text-[10px] text-[#a98a7d] uppercase tracking-widest">Base map</div>
            <div className="grid grid-cols-3 gap-2">
              {([
                { id: 'satellite-streets', label: 'SAT+LABELS' },
                { id: 'satellite', label: 'SAT_ONLY' },
                { id: 'outdoors', label: 'OUTDOORS' },
              ] as Array<{ id: OperatorBaseStyle; label: string }>).map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => {
                    setLayerPrefs((p) => {
                      const next = { ...p, baseStyle: opt.id };
                      const map = mapRef.current;
                      if (map) {
                        try { map.setStyle(styleUrl(opt.id)); } catch { /* ignore */ }
                      }
                      return next;
                    });
                  }}
                  className={`px-2 py-2 rounded border text-[10px] font-mono ${
                    layerPrefs.baseStyle === opt.id
                      ? 'border-[#13ff43] text-[#13ff43] bg-[#061f10]'
                      : 'border-green-900/40 text-[#a98a7d] hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setLayerPrefs((p) => ({ ...p, terrain3d: !p.terrain3d }))}
              className={`px-3 py-2 rounded border text-[10px] font-mono ${
                layerPrefs.terrain3d ? 'border-[#13ff43] text-[#13ff43] bg-[#061f10]' : 'border-green-900/40 text-[#a98a7d] hover:text-white'
              }`}
              title="3D terrain (best with map pitch)"
            >
              {layerPrefs.terrain3d ? 'TERRAIN_3D_ON' : 'TERRAIN_3D_OFF'}
            </button>
            <button
              onClick={() => setLayerPrefs((p) => ({ ...p, sky: !p.sky }))}
              className={`px-3 py-2 rounded border text-[10px] font-mono ${
                layerPrefs.sky ? 'border-[#13ff43] text-[#13ff43] bg-[#061f10]' : 'border-green-900/40 text-[#a98a7d] hover:text-white'
              }`}
            >
              {layerPrefs.sky ? 'SKY_ON' : 'SKY_OFF'}
            </button>
            <button
              onClick={() => setLayerPrefs((p) => ({ ...p, hillshade: !p.hillshade }))}
              className={`px-3 py-2 rounded border text-[10px] font-mono ${
                layerPrefs.hillshade ? 'border-[#13ff43] text-[#13ff43] bg-[#061f10]' : 'border-green-900/40 text-[#a98a7d] hover:text-white'
              }`}
              title="Hillshade (terrain shading)"
            >
              {layerPrefs.hillshade ? 'HILLSHADE_ON' : 'HILLSHADE_OFF'}
            </button>
            <button
              onClick={() => setLayerPrefs((p) => ({ ...p, topo: !p.topo }))}
              className={`px-3 py-2 rounded border text-[10px] font-mono ${
                layerPrefs.topo ? 'border-[#13ff43] text-[#13ff43] bg-[#061f10]' : 'border-green-900/40 text-[#a98a7d] hover:text-white'
              }`}
              title="USGS topo overlay"
            >
              {layerPrefs.topo ? 'TOPO_ON' : 'TOPO_OFF'}
            </button>
            <button
              onClick={() => setLayerPrefs((p) => ({ ...p, hydro: !p.hydro }))}
              className={`px-3 py-2 rounded border text-[10px] font-mono ${
                layerPrefs.hydro ? 'border-[#13ff43] text-[#13ff43] bg-[#061f10]' : 'border-green-900/40 text-[#a98a7d] hover:text-white'
              }`}
              title="Streams/rivers/lakes overlay"
            >
              {layerPrefs.hydro ? 'HYDRO_ON' : 'HYDRO_OFF'}
            </button>
            <button
              onClick={() => setLayerPrefs((p) => ({ ...p, soils: !p.soils }))}
              className={`px-3 py-2 rounded border text-[10px] font-mono ${
                layerPrefs.soils ? 'border-[#13ff43] text-[#13ff43] bg-[#061f10]' : 'border-green-900/40 text-[#a98a7d] hover:text-white'
              }`}
              title="SSURGO-derived soils (small-scale)"
            >
              {layerPrefs.soils ? 'SOILS_ON' : 'SOILS_OFF'}
            </button>
            <button
              onClick={() => setLayerPrefs((p) => ({ ...p, wetlands: !p.wetlands }))}
              className={`px-3 py-2 rounded border text-[10px] font-mono ${
                layerPrefs.wetlands ? 'border-[#13ff43] text-[#13ff43] bg-[#061f10]' : 'border-green-900/40 text-[#a98a7d] hover:text-white'
              }`}
              title="Wetlands raster overlay"
            >
              {layerPrefs.wetlands ? 'WETLANDS_ON' : 'WETLANDS_OFF'}
            </button>
            <button
              onClick={() => setLayerPrefs((p) => ({ ...p, naipTrueColor: !p.naipTrueColor, naipCIR: p.naipCIR && !p.naipTrueColor ? p.naipCIR : false }))}
              className={`px-3 py-2 rounded border text-[10px] font-mono ${
                layerPrefs.naipTrueColor ? 'border-[#13ff43] text-[#13ff43] bg-[#061f10]' : 'border-green-900/40 text-[#a98a7d] hover:text-white'
              }`}
              title="NAIP aerial imagery (true color)"
            >
              {layerPrefs.naipTrueColor ? 'NAIP_TC_ON' : 'NAIP_TC_OFF'}
            </button>
            <button
              onClick={() => setLayerPrefs((p) => ({ ...p, naipCIR: !p.naipCIR, naipTrueColor: p.naipTrueColor && !p.naipCIR ? p.naipTrueColor : false }))}
              className={`px-3 py-2 rounded border text-[10px] font-mono ${
                layerPrefs.naipCIR ? 'border-[#FF6B00] text-[#FF6B00] bg-[#1b0f06]' : 'border-green-900/40 text-[#a98a7d] hover:text-white'
              }`}
              title="NAIP aerial imagery (color infrared)"
            >
              {layerPrefs.naipCIR ? 'NAIP_CIR_ON' : 'NAIP_CIR_OFF'}
            </button>
            <button
              onClick={() => setLayerPrefs((p) => ({ ...p, ndvi: !p.ndvi }))}
              className={`px-3 py-2 rounded border text-[10px] font-mono ${
                layerPrefs.ndvi ? 'border-[#FF6B00] text-[#FF6B00] bg-[#1b0f06]' : 'border-green-900/40 text-[#a98a7d] hover:text-white'
              }`}
              title="Vegetation index overlay (may appear dark depending on imagery)"
            >
              {layerPrefs.ndvi ? 'NDVI_ON' : 'NDVI_OFF'}
            </button>
            <button
              onClick={() => setLayerPrefs((p) => ({ ...p, myData: !p.myData }))}
              className={`px-3 py-2 rounded border text-[10px] font-mono ${
                layerPrefs.myData ? 'border-[#13ff43] text-[#13ff43] bg-[#061f10]' : 'border-green-900/40 text-[#a98a7d] hover:text-white'
              }`}
              title="Your property lines / fences / entrances from public/operator-data"
            >
              {layerPrefs.myData ? 'MY_DATA_ON' : 'MY_DATA_OFF'}
            </button>
            <button
              onClick={() => setLayerPrefs((p) => ({ ...p, hideLabels: !p.hideLabels }))}
              className={`px-3 py-2 rounded border text-[10px] font-mono ${
                layerPrefs.hideLabels ? 'border-[#13ff43] text-[#13ff43] bg-[#061f10]' : 'border-green-900/40 text-[#a98a7d] hover:text-white'
              }`}
              title="Hide map labels"
            >
              {layerPrefs.hideLabels ? 'LABELS_HIDDEN' : 'LABELS_VISIBLE'}
            </button>
            <button
              onClick={() => setLayerPrefs((p) => ({ ...p, hideRoads: !p.hideRoads }))}
              className={`px-3 py-2 rounded border text-[10px] font-mono ${
                layerPrefs.hideRoads ? 'border-[#13ff43] text-[#13ff43] bg-[#061f10]' : 'border-green-900/40 text-[#a98a7d] hover:text-white'
              }`}
              title="Hide road/bridge layers"
            >
              {layerPrefs.hideRoads ? 'ROADS_HIDDEN' : 'ROADS_VISIBLE'}
            </button>
            <button
              onClick={() => {
                const coarse = coarsePointerRef.current;
                setLayerPrefs(defaultPrefs(coarse));
              }}
              className="px-3 py-2 rounded border border-green-900/40 text-[10px] font-mono text-[#a98a7d] hover:text-white"
              title="Reset layers to defaults for this device"
            >
              RESET_DEFAULTS
            </button>
          </div>
        </div>
      )}

      {/* HUD panel */}
      {bid && hudOpen && (
        <div className="absolute top-14 left-3 z-10 holo-panel backdrop-blur-sm rounded-lg p-3 min-w-[220px] space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-[#00ff41] font-bold uppercase tracking-widest">Field HUD</span>
            <button onClick={() => setHudOpen(false)} className="text-[#a98a7d] hover:text-white text-xs">✕</button>
          </div>

          {/* Progress bar */}
          <div>
            <div className="flex justify-between text-[10px] mb-1">
              <span className="text-[#a98a7d]">CLEARING_PROGRESS</span>
              <span className="text-[#13ff43] font-bold">{stats.pct}%</span>
            </div>
            <div className="w-full h-2 bg-[#353534] rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#13ff43] to-[#00cc33] rounded-full transition-all duration-500"
                style={{ width: `${stats.pct}%` }}
              />
            </div>
            <div className="flex justify-between text-[9px] text-[#a98a7d] mt-0.5">
              <span>{stats.cleared} cleared</span>
              <span>{stats.remaining} remaining</span>
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-[#1a1a1a] border border-[#353534] p-2 rounded">
              <div className="text-[9px] text-[#a98a7d] uppercase">Cells</div>
              <div className="text-sm font-bold text-[#13ff43]">{stats.cleared}/{stats.total}</div>
            </div>
            <div className="bg-[#1a1a1a] border border-[#353534] p-2 rounded">
              <div className="text-[9px] text-[#a98a7d] uppercase">Session</div>
              <div className="text-sm font-bold text-[#FF6B00]">{formatDuration(elapsedMs)}</div>
            </div>
            {state.accuracy != null && (
              <div className="bg-[#1a1a1a] border border-[#353534] p-2 rounded">
                <div className="text-[9px] text-[#a98a7d] uppercase">GPS Acc</div>
                <div className="text-sm font-bold text-[#e5e2e1]">{Math.round(state.accuracy)}m</div>
              </div>
            )}
            {state.speed != null && state.speed > 0 && (
              <div className="bg-[#1a1a1a] border border-[#353534] p-2 rounded">
                <div className="text-[9px] text-[#a98a7d] uppercase">Speed</div>
                <div className="text-sm font-bold text-[#e5e2e1]">{(state.speed * 2.237).toFixed(1)} mph</div>
              </div>
            )}
          </div>

          {state.operatorPos && (
            <div className="text-[9px] text-[#a98a7d] font-mono">
              {state.operatorPos[1].toFixed(6)}°N, {Math.abs(state.operatorPos[0]).toFixed(6)}°W
            </div>
          )}

          {/* Pasture breakdown */}
          {bid.pastures.filter(p => p.cedarAnalysis).map(p => {
            const totalCells = (p.cedarAnalysis?.gridCells?.features ?? []).filter(
              f => ['cedar', 'oak', 'mixed_brush'].includes(f.properties?.classification)
            ).length;
            let clearedCount = 0;
            (p.cedarAnalysis?.gridCells?.features ?? []).forEach((f, idx) => {
              if (!['cedar', 'oak', 'mixed_brush'].includes(f.properties?.classification)) return;
              if (state.clearedCellIds.has(`${p.id}:${idx}`)) clearedCount++;
            });
            const pPct = totalCells > 0 ? Math.round((clearedCount / totalCells) * 100) : 0;
            return (
              <div key={p.id} className="flex items-center justify-between text-[10px]">
                <span className="text-[#e5e2e1] font-bold truncate max-w-[120px]">{p.name}</span>
                <span className={`font-mono ${pPct === 100 ? 'text-[#13ff43]' : 'text-[#a98a7d]'}`}>{pPct}%</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Collapsed HUD button */}
      {bid && !hudOpen && (
        <button
          onClick={() => setHudOpen(true)}
          className="absolute top-14 left-3 z-10 holo-button backdrop-blur-sm rounded-lg px-3 py-2 text-[10px] font-bold uppercase tracking-widest"
        >
          HUD ({stats.pct}%)
        </button>
      )}

      {/* Bottom controls */}
      {bid && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2">
          <button
            onClick={toggleGPS}
            className={`px-5 py-3 rounded-lg font-bold text-sm uppercase tracking-widest transition-all ${
              state.gpsActive
                ? 'bg-red-600 text-white hover:bg-red-700 shadow-[0_0_20px_rgba(255,0,0,0.3)]'
                : 'bg-[#13ff43] text-black hover:bg-[#00cc33] shadow-[0_0_20px_rgba(19,255,67,0.3)]'
            }`}
          >
            {state.gpsActive ? '⏹ Stop GPS' : '▶ Start GPS'}
          </button>

          {state.gpsActive && (
            <button
              onClick={recenter}
              className="px-4 py-3 rounded-lg bg-[#FF6B00] text-black font-bold text-sm uppercase tracking-widest hover:bg-white transition-all"
            >
              📍 Recenter
            </button>
          )}

          {stats.cleared > 0 && !state.gpsActive && (
            <>
              {confirmReset ? (
                <div className="flex items-center gap-1 bg-red-900/80 backdrop-blur-sm px-3 py-2 rounded-lg border border-red-500">
                  <span className="text-red-300 text-xs font-bold">Reset all progress?</span>
                  <button onClick={resetSession} className="px-2 py-1 bg-red-600 text-white text-xs font-bold rounded hover:bg-red-700">YES</button>
                  <button onClick={() => setConfirmReset(false)} className="px-2 py-1 bg-[#353534] text-white text-xs font-bold rounded hover:bg-[#555]">NO</button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmReset(true)}
                  className="px-4 py-3 rounded-lg bg-[#353534] text-[#a98a7d] font-bold text-sm uppercase tracking-widest hover:bg-red-900 hover:text-red-300 transition-all"
                >
                  Reset
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
