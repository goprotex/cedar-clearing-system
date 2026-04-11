'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import Link from 'next/link';
import type { Bid } from '@/types';
import { extractTreesFromAnalysis, type TreePosition } from '@/lib/tree-layer';
import { treeFeaturesForMapboxExtrusion } from '@/lib/operate-mapbox-trees';
import { jobIdFromBidId, mergeClearedCellIds } from '@/lib/jobs';
import { createClient as createSupabaseBrowser, isSupabaseConfigured } from '@/utils/supabase/client';
import { loadBidFromSupabase, getAuthUserId } from '@/lib/db';

const CLEAR_RADIUS_M = 8;
const GPS_OPTIONS: PositionOptions = { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 };
const OPERATOR_STYLE_HIGH = 'mapbox://styles/mapbox/satellite-streets-v12';
const OPERATOR_STYLE_LOW = 'mapbox://styles/mapbox/satellite-v9';
const OPERATOR_PUBLISH_MS = 2500;
const DEFAULT_CENTER: [number, number] = [-99.1403, 30.0469];

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
  const [mapReady, setMapReady] = useState(false);
  const [ndviEnabled, setNdviEnabled] = useState(false);
  const [hudOpen, setHudOpen] = useState(true);
  const [confirmReset, setConfirmReset] = useState(false);
  const [sharedEnabled, setSharedEnabled] = useState(false);
  const lastPublishRef = useRef<number>(0);
  const [, setSharedStatus] = useState<'idle' | 'syncing' | 'ready' | 'unauth' | 'error'>('idle');

  const [state, setState] = useState<OperatorState>({
    bid: null, trees: [], clearedCellIds: new Set(), clearedCells: [],
    gpsActive: false, operatorPos: null, accuracy: null, heading: null, speed: null,
    totalClearedAcres: 0, sessionStart: Date.now(),
  });

  const stateRef = useRef(state);
  stateRef.current = state;

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

  // Restore persisted trail from localStorage
  useEffect(() => {
    const jobId = jobIdFromBidId(bidId);
    try {
      const raw = localStorage.getItem(`ccc_operator_trail_${jobId}`);
      if (raw) {
        const coords = JSON.parse(raw) as [number, number][];
        if (Array.isArray(coords) && coords.length > 0) {
          trailCoordsRef.current = coords;
        }
      }
    } catch { /* ignore */ }
  }, [bidId]);

  // Try to enable shared progress (Supabase-backed) if this bid has a Job and the user is authenticated.
  useEffect(() => {
    if (!state.bid) return;
    let cancelled = false;
    (async () => {
      try {
        setSharedStatus('syncing');
        const jobId = jobIdFromBidId(bidId);
        const res = await fetch(`/api/jobs/${jobId}/cleared-cells`, {
          cache: 'no-store',
          credentials: 'same-origin',
        });
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
          pitch: coarsePointer ? 0 : 45,
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
        const isTileErr = /tile|source|sprite|glyph/i.test(String(msg));
        if (!isTileErr) {
          setMapError(String(msg));
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
          if (!coarsePointer) {
            try {
              map.addSource('mapbox-dem', {
                type: 'raster-dem', url: 'mapbox://mapbox.mapbox-terrain-dem-v1', tileSize: 512, maxzoom: 14,
              });
              map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.2 });
              map.addLayer({ id: 'sky', type: 'sky', paint: { 'sky-type': 'atmosphere', 'sky-atmosphere-sun': [0.0, 90.0], 'sky-atmosphere-sun-intensity': 15 } });
            } catch {
              // terrain optional
            }
          }

          if (!coarsePointer) {
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
                paint: { 'raster-opacity': 0.85 },
                layout: { visibility: 'none' },
              });
            } catch {
              // optional overlay
            }
          }

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

          map.addSource('cedar-cells', { type: 'geojson', data: { type: 'FeatureCollection', features: allCedarFeatures } });

          if (coarsePointer) {
            map.addLayer({
              id: 'cedar-cells-fill-2d',
              type: 'fill',
              source: 'cedar-cells',
              paint: {
                'fill-color': ['case', ['==', ['get', 'cleared'], 1], '#1f1f1f', ['get', 'holoColor']],
                'fill-opacity': ['case', ['==', ['get', 'cleared'], 1], 0.2, 0.55],
              },
            });
          } else {
            map.addLayer({
              id: 'cedar-cells-fill', type: 'fill-extrusion', source: 'cedar-cells',
              paint: {
                'fill-extrusion-color': ['case', ['==', ['get', 'cleared'], 1], '#333333', ['get', 'holoColor']],
                'fill-extrusion-opacity': 0.55,
                'fill-extrusion-height': ['case', ['==', ['get', 'cleared'], 1], 0.5, 3],
                'fill-extrusion-base': 0,
              },
            });

            // Mapbox-native 3D tree stand-ins (fill-extrusion cylinders) — sit on terrain DEM, above cell prisms
            if (map.getTerrain()) {
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
            }
          }

          map.addLayer({
            id: 'cedar-cells-border', type: 'line', source: 'cedar-cells',
            paint: {
              'line-color': ['case', ['==', ['get', 'cleared'], 1], '#555555', ['get', 'holoColor']],
              'line-width': 0.5,
              'line-opacity': 0.4,
            },
          });

          // Restore persisted trail if available
          const trailData = trailCoordsRef.current.length >= 2
            ? trailCoordsRef.current
            : [];
          map.addSource('trail', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: trailData }, properties: {} } });
          map.addLayer({ id: 'trail-line', type: 'line', source: 'trail', paint: { 'line-color': '#FF6B00', 'line-width': 3, 'line-opacity': 0.8 } });
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

  // Toggle NDVI overlay visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const layerId = 'naip-ndvi-overlay';
    if (!map.getLayer(layerId)) return;
    map.setLayoutProperty(layerId, 'visibility', ndviEnabled ? 'visible' : 'none');
  }, [ndviEnabled]);

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

    // Publish operator position for live monitor.
    const now = Date.now();
    if (now - lastPublishRef.current >= OPERATOR_PUBLISH_MS) {
      lastPublishRef.current = now;
      const jobId = jobIdFromBidId(bidId);
      const posData = {
        lng,
        lat,
        accuracy_m: stateRef.current.accuracy,
        heading_deg: stateRef.current.heading,
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

      // Also push to Supabase if authed
      if (sharedEnabled) {
        void fetch(`/api/jobs/${jobId}/operator-positions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(posData),
        }).catch(() => { /* best-effort */ });
      }
    }

    trailCoordsRef.current.push([lng, lat]);

    // Persist trail to localStorage so monitor can display it
    const jobId = jobIdFromBidId(bidId);
    try {
      localStorage.setItem(`ccc_operator_trail_${jobId}`, JSON.stringify(trailCoordsRef.current));
    } catch { /* storage full */ }

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

      {/* Map loading indicator — helps diagnose initialization failures */}
      {bid && !mapReady && !mapError && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-10 bg-[#000a02]/80 backdrop-blur-sm px-4 py-2 rounded-lg border border-green-900/40">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-[#00ff41] rounded-full animate-pulse" />
            <span className="text-[10px] font-mono text-[#a98a7d]">LOADING_MAP...</span>
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
              onClick={() => setNdviEnabled((v) => !v)}
              className="text-[10px] font-mono text-[#a98a7d] hover:text-white border border-green-900/40 px-2 py-1 rounded"
              title="Toggle NDVI overlay"
            >
              {ndviEnabled ? 'NDVI_ON' : 'NDVI_OFF'}
            </button>
            <span className={`w-2 h-2 rounded-full ${state.gpsActive ? 'bg-[#13ff43] animate-pulse' : 'bg-red-500'}`} />
            <span className="text-[10px] font-mono text-[#a98a7d]">
              {state.gpsActive ? 'GPS_LOCKED' : 'GPS_OFF'}
            </span>
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
