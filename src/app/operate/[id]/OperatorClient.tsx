'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import Link from 'next/link';
import type { Bid } from '@/types';
import { HologramMapboxLayers, extractTreesFromAnalysis, type TreePosition } from '@/lib/hologram-mapbox';
import type { PastureWall } from '@/lib/cedar-tree-data';
import { treeFeaturesForMapboxExtrusion } from '@/lib/operate-mapbox-trees';
import { jobIdFromBidId, mergeClearedCellIds } from '@/lib/jobs';
import type { Session } from '@supabase/supabase-js';
import { createClient as createSupabaseBrowser, isSupabaseConfigured } from '@/utils/supabase/client';
import { fetchApiAuthed } from '@/lib/auth-client';
import { loadBidFromSupabase, getAuthUserId } from '@/lib/db';
import {
  type OverlayLayerKey,
  defaultOverlayState,
  defaultOverlayOpacities,
  addOverlaySourcesToMap,
  syncOverlayVisibility,
} from '@/lib/map-layers';
import MapLayerPanel, {
  useOverlayActiveCount,
} from '@/components/map/MapLayerPanel';

const CLEAR_RADIUS_M = 8;
const GPS_OPTIONS: PositionOptions = { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 };
const OPERATOR_STYLE_HIGH = 'mapbox://styles/mapbox/satellite-streets-v12';
const OPERATOR_STYLE_LOW = 'mapbox://styles/mapbox/satellite-v9';
const OPERATOR_PUBLISH_MS = 2500;
/** Limit trail GeoJSON updates so GPS + setData doesn’t fight map gestures. */
const TRAIL_MAP_MIN_INTERVAL_MS = 200;
/** Avoid re-rendering the whole tree on every GPS tick (janks pinch/rotate). */
const HUD_GPS_STATE_MIN_INTERVAL_MS = 350;
/** Throttle auto-center easeTo so rapid GPS ticks don't interrupt in-progress animations. */
const CENTER_MAP_MIN_INTERVAL_MS = 800;
const CENTER_MAP_DURATION_MS = 600;
/** Top bar height used for positioning elements below it (must match the bar's rendered height). */
const TOP_BAR_HEIGHT = '3.5rem';
const DEFAULT_CENTER: [number, number] = [-99.1403, 30.0469];

const VEGETATION_COLORS: Record<string, string> = {
  cedar: '#22c55e',
  oak: '#92400e',
  mixed: '#f97316',
  brush: '#eab308',
  mesquite: '#a16207',
};

type OperateLayerKey = 'soil' | 'naip' | 'naipCIR' | 'naipNDVI' | 'hologram';

function isValidLngLat(pair: [number, number]): boolean {
  const [lng, lat] = pair;
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    Math.abs(lng) <= 180 &&
    Math.abs(lat) <= 90 &&
    !(lng === 0 && lat === 0)
  );
}

/** Some stored bids mistakenly used [lat, lng]; Mapbox expects [lng, lat]. */
function normalizePropertyCenter(pair: [number, number]): [number, number] {
  const [a, b] = pair;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return pair;
  if (Math.abs(a) <= 90 && Math.abs(b) <= 180 && a > -25 && a < 75 && b < -40 && b > -180) {
    return [b, a];
  }
  return pair;
}

function centerFromPastures(bid: Bid): [number, number] {
  for (const p of bid.pastures) {
    const ring = p.polygon?.geometry?.coordinates?.[0];
    if (!ring || ring.length < 3) continue;
    let minLng = Infinity;
    let maxLng = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const c of ring) {
      if (!Array.isArray(c) || c.length < 2) continue;
      const [lng, lat] = c;
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
    if (minLng !== Infinity) {
      return [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
    }
  }
  return DEFAULT_CENTER;
}

function resolveOperatorView(bid: Bid): { center: [number, number]; zoom: number } {
  let center = normalizePropertyCenter(bid.propertyCenter);
  if (!isValidLngLat(center)) center = centerFromPastures(bid);
  if (!isValidLngLat(center)) center = DEFAULT_CENTER;
  let zoom = bid.mapZoom;
  if (!Number.isFinite(zoom) || zoom < 1 || zoom > 22) zoom = 14;
  return { center, zoom };
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

function operatorTrailStorageKey(jobId: string) {
  return `ccc_operator_trail_${jobId}`;
}

/** Load and validate GPS trail points from localStorage (survives refresh / tab close). */
function loadOperatorTrailFromStorage(jobId: string): [number, number][] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(operatorTrailStorageKey(jobId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: [number, number][] = [];
    for (const item of parsed) {
      if (!Array.isArray(item) || item.length < 2) continue;
      const lng = Number(item[0]);
      const lat = Number(item[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      if (Math.abs(lng) > 180 || Math.abs(lat) > 90) continue;
      out.push([lng, lat]);
    }
    return out;
  } catch {
    return [];
  }
}

function saveOperatorTrailToStorage(jobId: string, coords: [number, number][]) {
  try {
    localStorage.setItem(operatorTrailStorageKey(jobId), JSON.stringify(coords));
  } catch {
    /* quota / private mode */
  }
}

/** Ray-casting point-in-polygon: returns true if (lng, lat) is inside the ring. */
function pointInPolygon(lng: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
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

/** Build a GeoJSON FeatureCollection from all vegetation cells in the bid pastures,
 *  tagging each cell with whether it has been cleared. */
function buildClearedCellsGeoJSON(
  pastures: Bid['pastures'],
  clearedCellIds: Set<string>,
): GeoJSON.FeatureCollection {
  const classColor: Record<string, string> = {
    cedar: '#ef4444',
    oak: '#92400e',
    mixed_brush: '#f97316',
  };
  const features: GeoJSON.Feature[] = [];
  for (const p of pastures) {
    if (!p.cedarAnalysis?.gridCells?.features) continue;
    p.cedarAnalysis.gridCells.features.forEach((f, idx) => {
      const cls = f.properties?.classification as string | undefined;
      if (!cls || !(cls in classColor)) return;
      const cellId = `${p.id}:${idx}`;
      features.push({
        type: 'Feature',
        geometry: f.geometry,
        properties: {
          ...f.properties,
          cellId,
          cleared: clearedCellIds.has(cellId),
          color: classColor[cls],
        },
      });
    });
  }
  return { type: 'FeatureCollection', features };
}

export default function OperatorClient({ bidId }: { bidId: string }) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const trailCoordsRef = useRef<[number, number][]>([]);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [layers, setLayers] = useState<Record<OperateLayerKey, boolean>>({
    soil: false,
    naip: false,
    naipCIR: false,
    naipNDVI: false,
    hologram: false,
  });
  const [overlayLayers, setOverlayLayers] = useState<Record<OverlayLayerKey, boolean>>(defaultOverlayState);
  const [overlayOpacities, setOverlayOpacities] = useState<Record<OverlayLayerKey, number>>(defaultOverlayOpacities);
  const overlayActiveCount = useOverlayActiveCount(overlayLayers);
  const [layersPanelOpen, setLayersPanelOpen] = useState(false);
  const preHoloLayersRef = useRef<Pick<Record<OperateLayerKey, boolean>, 'naip' | 'naipCIR' | 'naipNDVI'> | null>(null);
  const treeLayerRef = useRef<HologramMapboxLayers | null>(null);
  const holoRotationRef = useRef<number | null>(null);
  const [autoRotate, setAutoRotate] = useState(false);
  const autoRotateRef = useRef(autoRotate);
  autoRotateRef.current = autoRotate;
  const [hudOpen, setHudOpen] = useState(true);
  const [confirmReset, setConfirmReset] = useState(false);
  const [sharedEnabled, setSharedEnabled] = useState(false);
  const sharedEnabledRef = useRef(sharedEnabled);
  sharedEnabledRef.current = sharedEnabled;
  const lastPublishRef = useRef<number>(0);
  const lastTrailMapDrawRef = useRef<number>(0);
  const lastHudGpsEmitRef = useRef<number>(0);
  const lastCenterMapRef = useRef<number>(0);
  const supabaseSessionRef = useRef(false);
  const [, setSharedStatus] = useState<'idle' | 'syncing' | 'ready' | 'unauth' | 'error'>('idle');

  const [state, setState] = useState<OperatorState>({
    bid: null, trees: [], clearedCellIds: new Set(), clearedCells: [],
    gpsActive: false, operatorPos: null, accuracy: null, heading: null, speed: null,
    totalClearedAcres: 0, sessionStart: Date.now(),
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const layersRef = useRef(layers);
  layersRef.current = layers;

  // Load bid from Supabase (preferred) or localStorage (fallback)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let bid: Bid | null = null;

      if (isSupabaseConfigured) {
        try {
          const sb = createSupabaseBrowser();
          const userId = await getAuthUserId(sb);
          if (userId) {
            const result = await loadBidFromSupabase(sb, bidId);
            if (!result.error && result.bid) bid = result.bid;
          }
        } catch { /* fall through */ }
      }

      if (!bid) {
        const raw = localStorage.getItem(`ccc_bid_${bidId}`);
        if (raw) bid = JSON.parse(raw) as Bid;
      }

      if (cancelled || !bid) return;
      const trees = extractTreesFromAnalysis(bid.pastures);
      const saved = loadOperatorSession(bidId);
      const clearedCellIds = new Set(saved?.clearedCellIds ?? []);
      const clearedCells = saved?.clearedCells ?? [];

      setState(prev => ({ ...prev, bid, trees, clearedCellIds, clearedCells }));
    })();
    return () => { cancelled = true; };
  }, [bidId]);

  // Track Supabase session so we can publish GPS to job_operator_positions whenever the user is signed in
  // (not only when shared cleared-cell sync succeeded).
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const sb = createSupabaseBrowser();
    void sb.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      supabaseSessionRef.current = !!data.session;
    });
    const { data: sub } = sb.auth.onAuthStateChange((_e: string, session: Session | null) => {
      supabaseSessionRef.current = !!session;
    });
    return () => { sub.subscription.unsubscribe(); };
  }, []);

  // Restore persisted GPS trail from localStorage
  useEffect(() => {
    const jobId = jobIdFromBidId(bidId);
    const coords = loadOperatorTrailFromStorage(jobId);
    if (coords.length > 0) trailCoordsRef.current = coords;
  }, [bidId]);

  // Try to enable shared progress (Supabase-backed) if this bid has a Job and the user is authenticated.
  useEffect(() => {
    if (!state.bid) return;
    let cancelled = false;
    (async () => {
      try {
        setSharedStatus('syncing');
        const jobId = jobIdFromBidId(bidId);
        const res = await fetchApiAuthed(`/api/jobs/${jobId}/cleared-cells`);
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
        const data = (await res.json()) as { cells: Array<{ cell_id: string }> };
        if (cancelled) return;
        setSharedEnabled(true);
        setSharedStatus('ready');
        setState((prev) => {
          const cellIds = (data.cells ?? []).map((c) => c.cell_id);
          const merged = mergeClearedCellIds(prev.clearedCellIds, cellIds);
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

  const toggleLayer = useCallback((key: OperateLayerKey) => {
    setLayers((prev) => {
      const next = { ...prev };
      if (key === 'naip' || key === 'naipCIR' || key === 'naipNDVI') {
        if (!prev[key]) {
          next.naip = false;
          next.naipCIR = false;
          next.naipNDVI = false;
        }
      }
      if (key === 'hologram' && !prev.hologram) {
        preHoloLayersRef.current = { naip: prev.naip, naipCIR: prev.naipCIR, naipNDVI: prev.naipNDVI };
        next.naip = false;
        next.naipCIR = false;
        next.naipNDVI = true;
        const map = mapRef.current;
        if (map?.isStyleLoaded()) {
          map.easeTo({ pitch: 60, bearing: map.getBearing() || -20, duration: 1200 });
        }
      }
      if (key === 'hologram' && prev.hologram) {
        const saved = preHoloLayersRef.current;
        if (saved) {
          next.naip = saved.naip;
          next.naipCIR = saved.naipCIR;
          next.naipNDVI = saved.naipNDVI;
          preHoloLayersRef.current = null;
        }
        const map = mapRef.current;
        if (map?.isStyleLoaded()) {
          map.easeTo({ pitch: 0, bearing: 0, duration: 800 });
        }
      }
      next[key] = !prev[key];
      return next;
    });
  }, []);

  const toggleOverlay = useCallback((key: OverlayLayerKey) => {
    setOverlayLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const setOverlayOpacity = useCallback((key: OverlayLayerKey, value: number) => {
    setOverlayOpacities((prev) => ({ ...prev, [key]: value }));
  }, []);

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

  // Initialize map.  Wrapped in requestAnimationFrame so the container always
  // has real layout dimensions when Mapbox reads them.
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current || !state.bid) return;
    const bid = state.bid;
    const container = mapContainerRef.current;

    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

    if (!mapboxgl.supported({ failIfMajorPerformanceCaveat: false })) {
      setMapError('WebGL is not supported on this device/browser.');
      return;
    }

    const { center, zoom } = resolveOperatorView(bid);

    const coarsePointer =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches;

    // Delay creation by one frame so layout is settled and the container
    // has non-zero dimensions.  This avoids 0×0-canvas bugs on iPad Safari.
    let cancelled = false;
    const initTimer = setTimeout(() => {
      if (cancelled || mapRef.current) return;

      let map: mapboxgl.Map;
      try {
        map = new mapboxgl.Map({
          container,
          style: coarsePointer ? OPERATOR_STYLE_LOW : OPERATOR_STYLE_HIGH,
          center,
          zoom,
          pitch: 45,
          antialias: true,
          preserveDrawingBuffer: true,
          failIfMajorPerformanceCaveat: false,
        });
      } catch (e) {
        setMapError(e instanceof Error ? e.message : 'Map failed to initialize.');
        return;
      }

      const bumpResize = () => {
        try { map.resize(); } catch { /* ignore */ }
      };
      requestAnimationFrame(bumpResize);
      setTimeout(bumpResize, 100);
      setTimeout(bumpResize, 500);
      setTimeout(bumpResize, 1500);

      let loadWatch: number | null = window.setTimeout(() => {
        if (!map.isStyleLoaded()) {
          setMapError(
            'Map style is taking too long to load. Check NEXT_PUBLIC_MAPBOX_TOKEN on the server, network, or ad blockers blocking api.mapbox.com.',
          );
        }
      }, 15000);

      map.on('error', (e) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const err = (e as any)?.error;
        const msg = err?.message || err?.toString?.() || 'Mapbox failed to load.';
        const s = String(msg);
        // Tile/network glitches and GPU noise should not brick the whole view.
        const isRecoverable =
          /tile|source|sprite|glyph|webgl|context|lost|decode|network|fetch|image/i.test(s);
        if (!isRecoverable) {
          setMapError(s);
        }
      });

      map.addControl(new mapboxgl.NavigationControl(), 'top-right');
      map.addControl(new mapboxgl.ScaleControl({ unit: 'imperial' }), 'bottom-right');

      map.once('idle', () => {
        bumpResize();
        setMapReady(true);
      });

      map.on('load', () => {
        if (loadWatch != null) {
          window.clearTimeout(loadWatch);
          loadWatch = null;
        }
        try {
          // DEM on phones too so tree extrusions sit on terrain (no grid “chunk” prisms).
          try {
            map.addSource('mapbox-dem', {
              type: 'raster-dem', url: 'mapbox://mapbox.mapbox-terrain-dem-v1', tileSize: 512, maxzoom: 14,
            });
            map.setTerrain({ source: 'mapbox-dem', exaggeration: coarsePointer ? 1.0 : 1.2 });
            map.addLayer({ id: 'sky', type: 'sky', paint: { 'sky-type': 'atmosphere', 'sky-atmosphere-sun': [0.0, 90.0], 'sky-atmosphere-sun-intensity': 15 } });
          } catch {
            /* terrain optional */
          }

          try {
            map.addSource('soil-wms', {
              type: 'raster',
              tiles: [
                'https://SDMDataAccess.sc.egov.usda.gov/Spatial/SDM.wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=mapunitpoly&STYLES=&SRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=TRUE',
              ],
              tileSize: 256,
            });
            map.addLayer({
              id: 'soil-overlay',
              type: 'raster',
              source: 'soil-wms',
              paint: { 'raster-opacity': 0.45 },
              layout: { visibility: 'none' },
            });
          } catch {
            /* optional */
          }
          try {
            map.addSource('naip-rgb', {
              type: 'raster',
              tiles: [
                'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png&f=image',
              ],
              tileSize: 256,
            });
            map.addLayer({
              id: 'naip-overlay',
              type: 'raster',
              source: 'naip-rgb',
              paint: { 'raster-opacity': 0.85 },
              layout: { visibility: 'none' },
            });
          } catch {
            /* optional */
          }
          try {
            map.addSource('naip-cir', {
              type: 'raster',
              tiles: [
                'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png&bandIds=3,0,1&f=image',
              ],
              tileSize: 256,
            });
            map.addLayer({
              id: 'naip-cir-overlay',
              type: 'raster',
              source: 'naip-cir',
              paint: { 'raster-opacity': 0.85 },
              layout: { visibility: 'none' },
            });
          } catch {
            /* optional */
          }
          try {
            map.addSource('naip-ndvi', {
              type: 'raster',
              tiles: [
                'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png&renderingRule=%7B%22rasterFunction%22%3A%22NDVI%22%2C%22rasterFunctionArguments%22%3A%7B%22VisibleBandID%22%3A0%2C%22InfraredBandID%22%3A3%7D%7D&f=image',
              ],
              tileSize: 256,
            });
            map.addLayer({
              id: 'naip-ndvi-overlay',
              type: 'raster',
              source: 'naip-ndvi',
              paint: { 'raster-opacity': 0.75 },
              layout: { visibility: 'none' },
            });
          } catch {
            /* optional */
          }

          const worldRing: [number, number][] = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
          const holoHoles: [number, number][][] = bid.pastures
            .filter((p) => (p.polygon?.geometry?.coordinates?.length ?? 0) > 0)
            .map((p) => p.polygon.geometry.coordinates[0] as [number, number][]);
          map.addSource('holo-mask', {
            type: 'geojson',
            data:
              holoHoles.length > 0
                ? {
                    type: 'FeatureCollection',
                    features: [
                      {
                        type: 'Feature',
                        geometry: { type: 'Polygon', coordinates: [worldRing, ...holoHoles] },
                        properties: {},
                      },
                    ],
                  }
                : { type: 'FeatureCollection', features: [] },
          });
          map.addLayer({
            id: 'holo-mask-fill',
            type: 'fill',
            source: 'holo-mask',
            paint: { 'fill-color': '#000000', 'fill-opacity': 0.92 },
            layout: { visibility: 'none' },
          });

          const pastureFeatures: GeoJSON.Feature[] = bid.pastures
            .filter((p) => (p.polygon?.geometry?.coordinates?.length ?? 0) > 0)
            .map(p => ({
              type: 'Feature', geometry: p.polygon.geometry,
              properties: { name: p.name, color: '#00ff41' },
            }));

          map.addSource('pastures', { type: 'geojson', data: { type: 'FeatureCollection', features: pastureFeatures } });
          map.addLayer({ id: 'pastures-fill', type: 'fill', source: 'pastures', paint: { 'fill-color': '#00ff41', 'fill-opacity': 0.05 } });
          map.addLayer({ id: 'pastures-border', type: 'line', source: 'pastures', paint: { 'line-color': '#00ff41', 'line-width': 2, 'line-dasharray': [2, 1] } });
          map.addLayer({ id: 'pastures-label', type: 'symbol', source: 'pastures', layout: { 'text-field': ['get', 'name'], 'text-size': 14, 'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'] }, paint: { 'text-color': '#00ff41', 'text-halo-color': '#000', 'text-halo-width': 1.5 } });

          // Cedar analysis grid cells — uncleared shown as semi-transparent fill, cleared shown green.
          try {
            const initialCedarData = buildClearedCellsGeoJSON(bid.pastures, stateRef.current.clearedCellIds);
            map.addSource('cedar-cells', { type: 'geojson', data: initialCedarData });
            map.addLayer({
              id: 'cedar-cells-uncleared',
              type: 'fill',
              source: 'cedar-cells',
              filter: ['==', ['get', 'cleared'], false],
              paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.3 },
            });
            map.addLayer({
              id: 'cedar-cells-cleared',
              type: 'fill',
              source: 'cedar-cells',
              filter: ['==', ['get', 'cleared'], true],
              paint: { 'fill-color': '#13ff43', 'fill-opacity': 0.5 },
            });
          } catch {
            /* optional — only present if cedar analysis has been run */
          }

          // Mapbox-native 3D trees only (no grid cell blocks — clearing still uses analysis grid in memory).
          try {
            const treeList = extractTreesFromAnalysis(bid.pastures);
            const treeFc = treeFeaturesForMapboxExtrusion(treeList, { maxTrees: 2400, circleSteps: 12 });
            map.addSource('operate-trees-3d', { type: 'geojson', data: treeFc });
            map.addLayer({
              id: 'operate-trees-3d',
              type: 'fill-extrusion',
              source: 'operate-trees-3d',
              paint: {
                'fill-extrusion-color': ['get', 'color'],
                'fill-extrusion-height': ['get', 'height_m'],
                'fill-extrusion-base': ['get', 'base_m'],
                'fill-extrusion-opacity': 0.92,
              },
            });
          } catch {
            /* optional */
          }

          // Restore persisted trail if available
          const trailData = trailCoordsRef.current.length >= 2
            ? trailCoordsRef.current
            : [];
          map.addSource('trail', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: trailData }, properties: {} } });
          map.addLayer({ id: 'trail-line', type: 'line', source: 'trail', paint: { 'line-color': '#FF6B00', 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 14, 2, 17, 4, 18, 7, 19, 14, 22, 80], 'line-opacity': 0.8 } });

          // ── Add all overlay raster sources & layers ──
          addOverlaySourcesToMap(map);
        } catch (err) {
          setMapError(err instanceof Error ? err.message : 'Failed to build map layers.');
          return;
        }

        // Auto-center on pasture polygons so the operator sees their work area
        const bounds = new mapboxgl.LngLatBounds();
        let hasBounds = false;
        for (const p of bid.pastures) {
          const ring = p.polygon?.geometry?.coordinates?.[0];
          if (!ring || ring.length < 3) continue;
          for (const c of ring) {
            if (Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1])) {
              bounds.extend(c as [number, number]);
              hasBounds = true;
            }
          }
        }
        if (hasBounds) {
          map.fitBounds(bounds, {
            padding: { top: 60, bottom: 80, left: 20, right: 20 },
            maxZoom: 17,
            duration: 1200,
          });
        }

        bumpResize();
        setTimeout(bumpResize, 100);
      });

      mapRef.current = map;
    }, 50);

    return () => {
      cancelled = true;
      clearTimeout(initTimer);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [state.bid]);

  // If trail was restored from storage before the map finished loading, paint it once ready
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.isStyleLoaded()) return;
    const c = trailCoordsRef.current;
    if (c.length < 2) return;
    const trailSource = map.getSource('trail') as mapboxgl.GeoJSONSource | undefined;
    if (!trailSource) return;
    trailSource.setData({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: c },
      properties: {},
    });
  }, [mapReady, state.bid]);

  // Layer toggles (soil, NAIP variants, hologram) — aligned with bid / scout maps
  useEffect(() => {
    const map = mapRef.current;
    const bid = state.bid;
    if (!map || !mapReady || !map.isStyleLoaded() || !bid) return;

    const coarsePointer =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches;

    const rasterKeys: { key: OperateLayerKey; id: string }[] = [
      { key: 'naip', id: 'naip-overlay' },
      { key: 'naipCIR', id: 'naip-cir-overlay' },
      { key: 'naipNDVI', id: 'naip-ndvi-overlay' },
    ];
    for (const { key, id } of rasterKeys) {
      if (!map.getLayer(id)) continue;
      const on = layers[key];
      map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
      const op = key === 'naipNDVI' ? 0.75 : 0.85;
      map.setPaintProperty(id, 'raster-opacity', layers.hologram && key === 'naipNDVI' && on ? 1.0 : op);
    }

    if (map.getLayer('soil-overlay')) {
      map.setLayoutProperty('soil-overlay', 'visibility', layers.soil ? 'visible' : 'none');
      map.setPaintProperty('soil-overlay', 'raster-opacity', 1.0);
      if (layers.soil) {
        try {
          map.moveLayer('soil-overlay');
        } catch {
          /* ignore */
        }
      }
    }

    if (layers.hologram) {
      if (map.getLayer('holo-mask-fill')) map.setLayoutProperty('holo-mask-fill', 'visibility', 'visible');

      for (const bl of map.getStyle().layers ?? []) {
        if (bl.id.startsWith('satellite') || bl.id.includes('mapbox-satellite')) {
          try {
            map.setPaintProperty(bl.id, 'raster-saturation', -0.8);
            map.setPaintProperty(bl.id, 'raster-brightness-max', 0.35);
          } catch {
            /* not raster */
          }
        }
      }
      for (const bl of map.getStyle().layers ?? []) {
        if (
          bl.id.includes('road') ||
          bl.id.includes('label') ||
          bl.id.includes('poi') ||
          bl.id.includes('building') ||
          bl.id.includes('transit') ||
          bl.id.includes('admin') ||
          bl.id.includes('place') ||
          bl.id.includes('water-') ||
          bl.id.includes('waterway') ||
          bl.id.includes('land-structure') ||
          bl.id.includes('aeroway')
        ) {
          try {
            map.setLayoutProperty(bl.id, 'visibility', 'none');
          } catch {
            /* ignore */
          }
        }
      }

      if (map.getLayer('pastures-border')) {
        map.setPaintProperty('pastures-border', 'line-color', '#00ff41');
        map.setPaintProperty('pastures-border', 'line-width', 3);
      }
      if (map.getLayer('pastures-fill')) {
        map.setPaintProperty('pastures-fill', 'fill-color', '#00ff41');
        map.setPaintProperty('pastures-fill', 'fill-opacity', 0.05);
      }
      if (map.getLayer('pastures-label')) {
        map.setPaintProperty('pastures-label', 'text-color', '#00ff41');
      }

      if (map.getLayer('operate-trees-3d')) {
        map.setLayoutProperty('operate-trees-3d', 'visibility', 'none');
      }

      if (coarsePointer && treeLayerRef.current) {
        try {
          treeLayerRef.current.remove();
        } catch {
          /* ignore */
        }
        treeLayerRef.current = null;
      } else if (!coarsePointer && !treeLayerRef.current) {
        try {
          const tl = new HologramMapboxLayers(map);
          treeLayerRef.current = tl;
          const trees = extractTreesFromAnalysis(bid.pastures);
          if (trees.length > 0) tl.updateTrees(trees);
          const walls: PastureWall[] = bid.pastures
            .filter((p) => p.polygon.geometry.coordinates.length > 0)
            .map((p) => ({
              id: p.id,
              coordinates: p.polygon.geometry.coordinates[0] as [number, number][],
              color: VEGETATION_COLORS[p.vegetationType] || '#22c55e',
            }));
          tl.updatePolygonWalls(walls);
        } catch {
          /* optional */
        }
      }

      if (treeLayerRef.current && map.getLayer('holo-trees-extrusion')) {
        const tl = treeLayerRef.current;
        const trees = extractTreesFromAnalysis(bid.pastures);
        if (trees.length > 0) tl.updateTrees(trees);
        for (const sp of ['cedar', 'oak', 'mixed'] as const) {
          tl.setSpeciesVisible(sp, true);
        }
      }

      for (const layerId of [
        'holo-mask-fill',
        'pastures-fill',
        'pastures-border',
        'pastures-label',
      ]) {
        if (map.getLayer(layerId)) {
          try {
            map.moveLayer(layerId);
          } catch {
            /* ignore */
          }
        }
      }
    } else {
      // Do not cancel holoRotationRef here — that ref drives global slow rotation and
      // must only be managed by the rotation / pause effects (cancelling here broke the map).

      if (map.getLayer('holo-mask-fill')) map.setLayoutProperty('holo-mask-fill', 'visibility', 'none');

      for (const bl of map.getStyle().layers ?? []) {
        if (bl.id.startsWith('satellite') || bl.id.includes('mapbox-satellite')) {
          try {
            map.setPaintProperty(bl.id, 'raster-saturation', 0);
            map.setPaintProperty(bl.id, 'raster-brightness-max', 1);
          } catch {
            /* ignore */
          }
        }
      }
      for (const bl of map.getStyle().layers ?? []) {
        if (
          bl.id.includes('road') ||
          bl.id.includes('label') ||
          bl.id.includes('poi') ||
          bl.id.includes('building') ||
          bl.id.includes('transit') ||
          bl.id.includes('admin') ||
          bl.id.includes('place') ||
          bl.id.includes('water-') ||
          bl.id.includes('waterway') ||
          bl.id.includes('land-structure') ||
          bl.id.includes('aeroway')
        ) {
          try {
            map.setLayoutProperty(bl.id, 'visibility', 'visible');
          } catch {
            /* ignore */
          }
        }
      }

      if (map.getLayer('pastures-border')) {
        map.setPaintProperty('pastures-border', 'line-color', '#00ff41');
        map.setPaintProperty('pastures-border', 'line-width', 2);
      }
      if (map.getLayer('pastures-fill')) {
        map.setPaintProperty('pastures-fill', 'fill-color', '#00ff41');
        map.setPaintProperty('pastures-fill', 'fill-opacity', 0.05);
      }
      if (map.getLayer('pastures-label')) {
        map.setPaintProperty('pastures-label', 'text-color', '#00ff41');
      }

      if (map.getLayer('operate-trees-3d')) {
        map.setLayoutProperty('operate-trees-3d', 'visibility', 'visible');
      }

      if (treeLayerRef.current) {
        try {
          treeLayerRef.current.remove();
        } catch {
          /* ignore */
        }
        treeLayerRef.current = null;
      }
    }
  }, [layers, mapReady, state.bid]);

  // ── Sync overlay layers visibility + opacity ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    try {
      syncOverlayVisibility(map, overlayLayers, overlayOpacities);
    } catch {
      /* ignore */
    }
  }, [overlayLayers, overlayOpacities, mapReady]);

  // Auto-rotation: only spin when autoRotate is enabled. Disables zoom/pan when active.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (!autoRotate) {
      if (holoRotationRef.current) {
        cancelAnimationFrame(holoRotationRef.current);
        holoRotationRef.current = null;
      }
      // Re-enable interactions when rotation is off
      try { map.scrollZoom.enable(); } catch { /* ignore */ }
      try { map.dragPan.enable(); } catch { /* ignore */ }
      try { map.touchZoomRotate.enable(); } catch { /* ignore */ }
      return;
    }

    // Disable pan/zoom while auto-rotating
    try { map.scrollZoom.disable(); } catch { /* ignore */ }
    try { map.dragPan.disable(); } catch { /* ignore */ }
    try { map.touchZoomRotate.disable(); } catch { /* ignore */ }

    const startSpin = () => {
      if (!autoRotateRef.current || holoRotationRef.current) return;
      const spin = () => {
        if (!mapRef.current || !autoRotateRef.current) return;
        mapRef.current.setBearing(mapRef.current.getBearing() + 0.0375);
        holoRotationRef.current = requestAnimationFrame(spin);
      };
      holoRotationRef.current = requestAnimationFrame(spin);
    };

    startSpin();

    return () => {
      if (holoRotationRef.current) {
        cancelAnimationFrame(holoRotationRef.current);
        holoRotationRef.current = null;
      }
    };
  }, [autoRotate, mapReady]);

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

  // Process GPS position — check cedar cells for clearing and update map overlay.
  /** Cedar cells are tracked in memory and visualized via the 'cedar-cells' Mapbox source. */
  const updateCedarSource = useCallback(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const bid = stateRef.current.bid;
    if (!bid) return;
    const source = map.getSource('cedar-cells') as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;
    source.setData(buildClearedCellsGeoJSON(bid.pastures, stateRef.current.clearedCellIds));
  }, []);

  /** Rebuild 3D tree layer excluding cleared cells so trees disappear after mulching. */
  const updateTreeLayer3d = useCallback(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const bid = stateRef.current.bid;
    if (!bid) return;
    const clearedCellIds = stateRef.current.clearedCellIds;

    const filteredPastures = bid.pastures.map(p => {
      const features = p.cedarAnalysis?.gridCells?.features ?? [];
      const kept = features.filter((_, idx) => !clearedCellIds.has(`${p.id}:${idx}`));
      return {
        ...p,
        cedarAnalysis: p.cedarAnalysis
          ? { ...p.cedarAnalysis, gridCells: { ...p.cedarAnalysis.gridCells, features: kept } }
          : null,
      };
    });

    const treeList = extractTreesFromAnalysis(filteredPastures as Parameters<typeof extractTreesFromAnalysis>[0]);

    const src3d = map.getSource('operate-trees-3d') as mapboxgl.GeoJSONSource | undefined;
    if (src3d) {
      const treeFc = treeFeaturesForMapboxExtrusion(treeList, { maxTrees: 2400, circleSteps: 12 });
      src3d.setData(treeFc);
    }

    if (treeLayerRef.current) {
      treeLayerRef.current.updateTrees(treeList);
    }
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
      updateTreeLayer3d();

      // Best-effort: if shared progress is enabled, append events so other users/devices see progress.
      if (sharedEnabled) {
        const jobId = jobIdFromBidId(bidId);
        void Promise.allSettled(
          newlyCleared.map((cellId) =>
            fetchApiAuthed(`/api/jobs/${jobId}/events`, {
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

    // Publish operator position for live monitor.
    const now = Date.now();
    if (now - lastPublishRef.current >= OPERATOR_PUBLISH_MS) {
      lastPublishRef.current = now;
      const jobId = jobIdFromBidId(bidId);
      const headingVal = stateRef.current.heading;
      const posData = {
        lng,
        lat,
        accuracy_m: stateRef.current.accuracy,
        heading: headingVal,
        heading_deg: headingVal,
        speed_mps: stateRef.current.speed,
        timestamp: now,
      };

      // Always write to localStorage for same-device monitor
      try {
        localStorage.setItem(`ccc_operator_pos_${jobId}`, JSON.stringify(posData));
      } catch { /* storage full */ }

      // Always publish to server-side store for cross-device monitor
      void fetch('/api/local-operator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...posData, jobId, trailPoint: [lng, lat] }),
      }).catch(() => { /* best-effort */ });

      // Push to Supabase when signed in so live monitor realtime works (shared progress is separate).
      if (supabaseSessionRef.current) {
        void fetchApiAuthed(`/api/jobs/${jobId}/operator-positions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(posData),
        }).catch(() => { /* best-effort */ });
      }
    }

    // Only append trail point when the operator is inside a pasture polygon
    const bid = stateRef.current.bid;
    const inPasture = bid?.pastures.some(p => {
      const ring = p.polygon?.geometry?.coordinates?.[0];
      if (!ring || ring.length < 3) return false;
      return pointInPolygon(lng, lat, ring as [number, number][]);
    }) ?? false;

    if (inPasture) {
      trailCoordsRef.current.push([lng, lat]);
    }

    const jobId = jobIdFromBidId(bidId);
    saveOperatorTrailToStorage(jobId, trailCoordsRef.current);

    const map = mapRef.current;
    const t = Date.now();
    if (
      map &&
      map.isStyleLoaded() &&
      trailCoordsRef.current.length >= 2 &&
      t - lastTrailMapDrawRef.current >= TRAIL_MAP_MIN_INTERVAL_MS
    ) {
      lastTrailMapDrawRef.current = t;
      const trailSource = map.getSource('trail') as mapboxgl.GeoJSONSource | undefined;
      if (trailSource) {
        trailSource.setData({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: trailCoordsRef.current },
          properties: {},
        });
      }
    }
  }, [bidId, updateCedarSource, updateTreeLayer3d, sharedEnabled]);

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
        const now = Date.now();
        const acc = pos.coords.accuracy;
        const heading = pos.coords.heading;
        const speed = pos.coords.speed;

        // Throttle React state: full tree re-renders steal the main thread from Mapbox gestures.
        const lastHud = lastHudGpsEmitRef.current;
        const shouldEmitHud =
          now - lastHud >= HUD_GPS_STATE_MIN_INTERVAL_MS ||
          !stateRef.current.operatorPos ||
          haversineDistM(lng, lat, stateRef.current.operatorPos[0], stateRef.current.operatorPos[1]) > 3;
        if (shouldEmitHud) {
          lastHudGpsEmitRef.current = now;
          setState(prev => ({
            ...prev,
            gpsActive: true,
            operatorPos: [lng, lat],
            accuracy: acc,
            heading,
            speed,
          }));
        }

        // Move marker every tick (no React) so position feels live without re-renders.
        if (markerRef.current) {
          markerRef.current.setLngLat([lng, lat]);
        } else if (mapRef.current) {
          const el = document.createElement('div');
          el.className = 'operator-marker';
          el.innerHTML = `<div style="width:20px;height:20px;background:#FF6B00;border:3px solid #fff;border-radius:50%;box-shadow:0 0 12px rgba(255,107,0,0.7);"></div>`;
          markerRef.current = new mapboxgl.Marker({ element: el }).setLngLat([lng, lat]).addTo(mapRef.current);
        }

        // Auto-center map on operator position (throttled to avoid interrupting in-progress animations)
        const centerNow = Date.now();
        if (
          mapRef.current &&
          mapRef.current.isStyleLoaded() &&
          centerNow - lastCenterMapRef.current >= CENTER_MAP_MIN_INTERVAL_MS
        ) {
          lastCenterMapRef.current = centerNow;
          mapRef.current.easeTo({
            center: [lng, lat],
            duration: CENTER_MAP_DURATION_MS,
          });
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
    try {
      localStorage.removeItem(operatorTrailStorageKey(jobIdFromBidId(bidId)));
    } catch {
      /* ignore */
    }
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

  // Keep the cedar-cells map source in sync whenever cleared cells change.
  useEffect(() => {
    updateCedarSource();
  }, [state.clearedCellIds, updateCedarSource]);

  // Keep 3D tree layer in sync whenever cleared cells change (trees disappear after mulching).
  useEffect(() => {
    updateTreeLayer3d();
  }, [state.clearedCellIds, updateTreeLayer3d]);

  // Tap-to-clear: operator can tap an uncleared cedar cell on the map to mark it cleared.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const handleCellClick = (e: mapboxgl.MapLayerMouseEvent) => {
      const props = e.features?.[0]?.properties;
      if (!props?.cellId) return;
      const cellId = props.cellId as string;
      if (stateRef.current.clearedCellIds.has(cellId)) return;
      const ts = Date.now();
      setState(prev => {
        const nextIds = new Set(prev.clearedCellIds);
        nextIds.add(cellId);
        const colonIdx = cellId.indexOf(':');
        if (colonIdx < 0) return prev; // malformed cellId, skip
        const pastureId = cellId.slice(0, colonIdx);
        const cellIndex = parseInt(cellId.slice(colonIdx + 1), 10);
        if (!pastureId || Number.isNaN(cellIndex)) return prev; // guard against bad data
        const nextCells = [
          ...prev.clearedCells,
          { cellIndex, pastureId, timestamp: ts },
        ];
        saveOperatorSession(bidId, Array.from(nextIds), nextCells);
        return { ...prev, clearedCellIds: nextIds, clearedCells: nextCells };
      });

      updateCedarSource();
      updateTreeLayer3d();

      // Best-effort: push clearing event so live monitor / other devices see progress.
      // Failures are intentionally ignored — field connections are unreliable.
      if (sharedEnabledRef.current) {
        const jobId = jobIdFromBidId(bidId);
        void fetchApiAuthed(`/api/jobs/${jobId}/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'operator_cell_cleared', data: { cellId, timestamp: ts } }),
        }).then((res) => {
          if (res.status === 401) {
            setSharedEnabled(false);
            setSharedStatus('unauth');
          }
        }).catch(() => { /* best-effort — ignore network failures */ });
      }
    };

    const handleMouseEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const handleMouseLeave = () => { map.getCanvas().style.cursor = ''; };

    try {
      map.on('click', 'cedar-cells-uncleared', handleCellClick);
      map.on('mouseenter', 'cedar-cells-uncleared', handleMouseEnter);
      map.on('mouseleave', 'cedar-cells-uncleared', handleMouseLeave);
    } catch { /* ignore */ }

    return () => {
      try {
        map.off('click', 'cedar-cells-uncleared', handleCellClick);
        map.off('mouseenter', 'cedar-cells-uncleared', handleMouseEnter);
        map.off('mouseleave', 'cedar-cells-uncleared', handleMouseLeave);
      } catch { /* ignore */ }
    };
  }, [mapReady, bidId, updateCedarSource, updateTreeLayer3d]);

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
    <div
      className="bg-[#131313] relative overflow-hidden operate-mode-root"
      style={{ position: 'fixed', inset: 0, width: '100vw', height: '100dvh' }}
    >
      {/* Map container — uses fixed dimensions so Mapbox always gets a real size.
          No CSS transforms (they cause Mapbox to miscompute the viewport).
          No stacking-context tricks (isolate, will-change) that interfere with
          WebGL compositing on iPad/Safari. */}
      <div
        ref={mapContainerRef}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
      />

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

      {/* Map error banner — does not cover the header or block the whole map */}
      {bid && mapError && (
        <div className="absolute left-2 right-2 z-30 max-h-[40vh] overflow-y-auto rounded-lg border border-[#353534] bg-[#0e0e0e]/95 backdrop-blur-sm p-3 shadow-lg text-[#e5e2e1]" style={{ top: `calc(${TOP_BAR_HEIGHT} + env(safe-area-inset-top, 0px))` }}>
          <div className="text-[#FF6B00] text-sm font-black uppercase tracking-widest">MAP_ISSUE</div>
          <div className="text-[10px] font-mono text-[#a98a7d] break-words mt-1">{mapError}</div>
          <div className="text-[10px] text-[#a98a7d] mt-2">
            Check <code className="bg-[#353534] px-1 text-[#FF6B00]">NEXT_PUBLIC_MAPBOX_TOKEN</code>, network, or ad blockers. Dismiss by fixing and refreshing.
          </div>
          <button
            type="button"
            onClick={() => setMapError(null)}
            className="mt-2 text-[10px] font-mono text-[#13ff43] border border-green-900/50 px-2 py-1 rounded hover:bg-[#001a06]"
          >
            DISMISS_BANNER
          </button>
        </div>
      )}

      {/* Map loading indicator — helps diagnose initialization failures */}
      {bid && !mapReady && !mapError && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-10 pointer-events-none bg-[#000a02]/80 backdrop-blur-sm px-4 py-2 rounded-lg border border-green-900/40">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-[#00ff41] rounded-full animate-pulse" />
            <span className="text-[10px] font-mono text-[#a98a7d]">LOADING_MAP...</span>
          </div>
        </div>
      )}

      {/* Top bar — pointer-events-none on strip so the map receives pan/pinch in the gaps; controls opt in */}
      <div
        className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between px-2 sm:px-3 pb-2 pointer-events-none bg-[#000a02]/95 backdrop-blur-sm border-b border-green-900/40"
        style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top, 0px))', paddingLeft: 'max(0.5rem, env(safe-area-inset-left, 0px))', paddingRight: 'max(0.5rem, env(safe-area-inset-right, 0px))' }}
      >
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 pointer-events-auto">
          <Link href={bid ? `/bid/${bidId}` : '/bids'} className="text-[#00ff41] font-black text-xs sm:text-sm tracking-widest hover:text-white transition-colors shrink-0">
            ← CEDAR_HACK
          </Link>
          <span className="text-[9px] sm:text-[10px] text-[#a98a7d] font-mono truncate">
            {bid ? `OPERATOR // ${bid.bidNumber}` : 'LOADING_BID...'}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1 max-w-[min(100%,56rem)] pointer-events-auto">
          <button
            type="button"
            disabled={!bid || !mapReady}
            onClick={() => setLayersPanelOpen(v => !v)}
            className={`text-[8px] sm:text-[9px] font-mono px-1 sm:px-1.5 py-0.5 rounded border shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${
              layersPanelOpen
                ? 'text-[#13ff43] border-[#13ff43] bg-[#001a06]/90'
                : 'text-[#a98a7d] border-green-900/40 hover:text-white'
            }`}
            title="Open layer panel"
          >
            LAYERS{overlayActiveCount > 0 ? `_${overlayActiveCount}` : ''}
          </button>
          <span className={`w-2 h-2 rounded-full shrink-0 ${state.gpsActive ? 'bg-[#13ff43] animate-pulse' : 'bg-red-500'}`} />
          <span className="text-[9px] sm:text-[10px] font-mono text-[#a98a7d] hidden sm:inline">
            {state.gpsActive ? 'GPS' : 'NO_GPS'}
          </span>
          <button
            type="button"
            disabled={!mapReady}
            onClick={() => setAutoRotate(v => !v)}
            className={`text-[8px] sm:text-[9px] font-mono px-1 sm:px-1.5 py-0.5 rounded border shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${
              autoRotate
                ? 'text-[#FF6B00] border-[#FF6B00] bg-[#1a0800]/90'
                : 'text-[#a98a7d] border-green-900/40 hover:text-white'
            }`}
            title={autoRotate ? 'Auto-rotation ON (zoom/pan disabled) — click to stop' : 'Start auto-rotation (disables zoom/pan)'}
          >
            {autoRotate ? '🔄 ROT_ON' : '🔄 ROT_OFF'}
          </button>
        </div>
      </div>


      {/* Layer control panel */}
      {layersPanelOpen && (
        <div className="absolute right-3 z-40" style={{ top: `calc(${TOP_BAR_HEIGHT} + env(safe-area-inset-top, 0px) + 0.5rem)` }}>
          <MapLayerPanel
            open={layersPanelOpen}
            onClose={() => setLayersPanelOpen(false)}
            overlayLayers={overlayLayers}
            overlayOpacities={overlayOpacities}
            onToggleOverlay={toggleOverlay}
            onOverlayOpacity={setOverlayOpacity}
            holoMode={layers.hologram}
            legacyGroups={[
              {
                category: 'imagery',
                label: 'Imagery',
                emoji: '📡',
                // Opacity is fixed for operator legacy layers (toggle-only)
                layers: [
                  { key: 'soil', label: 'Soil Map', emoji: '🟫', active: layers.soil, opacity: 1.0, onToggle: () => toggleLayer('soil'), onOpacity: () => {} },
                  { key: 'naip', label: 'RGB (NAIP)', emoji: '🛰️', active: layers.naip, opacity: 0.85, onToggle: () => toggleLayer('naip'), onOpacity: () => {} },
                  { key: 'naipCIR', label: 'CIR', emoji: '🔴', active: layers.naipCIR, opacity: 0.85, onToggle: () => toggleLayer('naipCIR'), onOpacity: () => {} },
                  { key: 'naipNDVI', label: 'NDVI', emoji: '🌿', active: layers.naipNDVI, opacity: 0.75, onToggle: () => toggleLayer('naipNDVI'), onOpacity: () => {} },
                ],
              },
              {
                category: 'analysis',
                label: 'Analysis',
                emoji: '🔬',
                layers: [
                  { key: 'hologram', label: 'Hologram', emoji: '🔮', active: layers.hologram, opacity: 1.0, onToggle: () => toggleLayer('hologram'), onOpacity: () => {} },
                ],
              },
            ]}
          />
        </div>
      )}
      {/* HUD panel — pass-through outside the card so the map isn’t blocked on phones */}
      {bid && hudOpen && (
        <div className="absolute left-3 z-10 pointer-events-none" style={{ top: `calc(${TOP_BAR_HEIGHT} + env(safe-area-inset-top, 0px))` }}>
          <div className="holo-panel backdrop-blur-sm rounded-lg p-3 min-w-[220px] space-y-3 pointer-events-auto">
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
        </div>
      )}

      {/* Collapsed HUD button */}
      {bid && !hudOpen && (
        <button
          onClick={() => setHudOpen(true)}
          className="absolute left-3 z-10 holo-button backdrop-blur-sm rounded-lg px-3 py-2 text-[10px] font-bold uppercase tracking-widest"
          style={{ top: `calc(${TOP_BAR_HEIGHT} + env(safe-area-inset-top, 0px))` }}
        >
          HUD ({stats.pct}%)
        </button>
      )}

      {/* Bottom controls */}
      {bid && (
        <div className="absolute left-1/2 -translate-x-1/2 z-10 flex items-center gap-2" style={{ bottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}>
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
