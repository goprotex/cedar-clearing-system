'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import Link from 'next/link';
import type { Bid } from '@/types';
import { extractTreesFromAnalysis, type TreePosition } from '@/lib/cedar-tree-data';

const CLEAR_RADIUS_M = 8;
const GPS_OPTIONS: PositionOptions = { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 };

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
  const [hudOpen, setHudOpen] = useState(true);
  const [confirmReset, setConfirmReset] = useState(false);

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

    const saved = loadOperatorSession(bidId);
    const clearedCellIds = new Set(saved?.clearedCellIds ?? []);
    const clearedCells = saved?.clearedCells ?? [];

    setState(prev => ({ ...prev, bid, trees, clearedCellIds, clearedCells }));
  }, [bidId]);

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

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current || !state.bid) return;
    const bid = state.bid;

    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center: bid.propertyCenter,
      zoom: bid.mapZoom,
      pitch: 45,
      antialias: true,
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    map.addControl(new mapboxgl.ScaleControl({ unit: 'imperial' }), 'bottom-right');

    map.on('load', () => {
      map.addSource('mapbox-dem', {
        type: 'raster-dem', url: 'mapbox://mapbox.mapbox-terrain-dem-v1', tileSize: 512, maxzoom: 14,
      });
      map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.2 });
      map.addLayer({ id: 'sky', type: 'sky', paint: { 'sky-type': 'atmosphere', 'sky-atmosphere-sun': [0.0, 90.0], 'sky-atmosphere-sun-intensity': 15 } });

      // NAIP NDVI overlay at 100% opacity for holographic base
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
        paint: { 'raster-opacity': 1.0 },
      });

      // Pasture polygon outlines with holographic green glow
      const pastureFeatures: GeoJSON.Feature[] = bid.pastures
        .filter(p => p.polygon.geometry.coordinates.length > 0)
        .map(p => ({
          type: 'Feature', geometry: p.polygon.geometry,
          properties: { name: p.name, color: '#00ff41' },
        }));

      map.addSource('pastures', { type: 'geojson', data: { type: 'FeatureCollection', features: pastureFeatures } });
      map.addLayer({ id: 'pastures-fill', type: 'fill', source: 'pastures', paint: { 'fill-color': '#00ff41', 'fill-opacity': 0.05 } });
      map.addLayer({ id: 'pastures-border', type: 'line', source: 'pastures', paint: { 'line-color': '#00ff41', 'line-width': 2, 'line-dasharray': [2, 1] } });
      map.addLayer({ id: 'pastures-label', type: 'symbol', source: 'pastures', layout: { 'text-field': ['get', 'name'], 'text-size': 14, 'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'] }, paint: { 'text-color': '#00ff41', 'text-halo-color': '#000', 'text-halo-width': 1.5 } });

      // Cedar grid cells — fill-extrusion with holographic coloring
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

      map.addLayer({
        id: 'cedar-cells-fill', type: 'fill-extrusion', source: 'cedar-cells',
        paint: {
          'fill-extrusion-color': ['case', ['==', ['get', 'cleared'], 1], '#333333', ['get', 'holoColor']],
          'fill-extrusion-opacity': 0.55,
          'fill-extrusion-height': ['case', ['==', ['get', 'cleared'], 1], 0.5, 3],
          'fill-extrusion-base': 0,
        },
      });

      map.addLayer({
        id: 'cedar-cells-border', type: 'line', source: 'cedar-cells',
        paint: {
          'line-color': ['case', ['==', ['get', 'cleared'], 1], '#555555', ['get', 'holoColor']],
          'line-width': 0.5,
          'line-opacity': 0.4,
        },
      });

      // Operator trail line
      map.addSource('trail', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} } });
      map.addLayer({ id: 'trail-line', type: 'line', source: 'trail', paint: { 'line-color': '#FF6B00', 'line-width': 3, 'line-opacity': 0.8 } });
    });

    mapRef.current = map;

    return () => { map.remove(); mapRef.current = null; };
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
      setState(prev => {
        const nextIds = new Set(prev.clearedCellIds);
        const nextCells = [...prev.clearedCells];
        for (const id of newlyCleared) {
          nextIds.add(id);
          const parts = id.split(':');
          nextCells.push({ cellIndex: parseInt(parts[1]), pastureId: parts[0], timestamp: Date.now() });
        }
        saveOperatorSession(bidId, Array.from(nextIds), nextCells);
        return { ...prev, clearedCellIds: nextIds, clearedCells: nextCells };
      });

      updateCedarSource();
    }

    trailCoordsRef.current.push([lng, lat]);
    const map = mapRef.current;
    if (map && map.isStyleLoaded()) {
      const trailSource = map.getSource('trail') as mapboxgl.GeoJSONSource | undefined;
      if (trailSource && trailCoordsRef.current.length >= 2) {
        trailSource.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: trailCoordsRef.current }, properties: {} });
      }
    }
  }, [bidId, updateCedarSource]);

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

  if (!state.bid) {
    return (
      <div className="h-screen w-screen bg-[#131313] flex items-center justify-center text-[#e5e2e1]">
        <div className="text-center space-y-4">
          <div className="text-6xl">📋</div>
          <h1 className="text-2xl font-black text-[#FF6B00]">NO_BID_DATA</h1>
          <p className="text-sm text-[#a98a7d]">Bid not found in local storage</p>
          <Link href="/bids" className="inline-block bg-[#FF6B00] text-black px-6 py-3 font-bold uppercase tracking-widest text-sm hover:bg-white transition-all">
            Back to Bids
          </Link>
        </div>
      </div>
    );
  }

  const elapsedMs = Date.now() - state.sessionStart;

  return (
    <div className="h-screen w-screen bg-[#131313] relative overflow-hidden hologram-mode">
      {/* Full-screen map */}
      <div ref={mapContainerRef} className="absolute inset-0" />
      {/* Holographic scan-line overlay */}
      <div className="holo-scanlines" />

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-3 py-2 bg-[#000a02]/80 backdrop-blur-sm border-b border-green-900/40">
        <div className="flex items-center gap-3">
          <Link href={`/bid/${bidId}`} className="text-[#00ff41] font-black text-sm tracking-widest hover:text-white transition-colors">
            ← CEDAR_HACK
          </Link>
          <span className="text-[10px] text-[#a98a7d] font-mono hidden sm:inline">
            OPERATOR_MODE // {state.bid.bidNumber}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${state.gpsActive ? 'bg-[#13ff43] animate-pulse' : 'bg-red-500'}`} />
          <span className="text-[10px] font-mono text-[#a98a7d]">
            {state.gpsActive ? 'GPS_LOCKED' : 'GPS_OFF'}
          </span>
        </div>
      </div>

      {/* HUD panel */}
      {hudOpen && (
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
          {state.bid.pastures.filter(p => p.cedarAnalysis).map(p => {
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
      {!hudOpen && (
        <button
          onClick={() => setHudOpen(true)}
          className="absolute top-14 left-3 z-10 holo-button backdrop-blur-sm rounded-lg px-3 py-2 text-[10px] font-bold uppercase tracking-widest"
        >
          HUD ({stats.pct}%)
        </button>
      )}

      {/* Bottom controls */}
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
    </div>
  );
}
