/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import type { Bid } from '@/types';
import { extractTreesFromAnalysis } from '@/lib/tree-layer';

type JobLike = {
  id: string;
  bid_snapshot: Bid;
  title?: string;
  status?: string;
  cedar_total_cells?: number;
  cedar_cleared_cells?: number;
};

export type LayerKey = 'soil' | 'naip' | 'naipCIR' | 'naipNDVI' | 'terrain3d' | 'cedarAI' | 'radar' | 'pastures' | 'hologram';

type Props = {
  accessToken: string;
  jobs: JobLike[];
  clearedByJob: Record<string, Set<string>>;
  operatorsByJob: Record<string, Array<{ user_id: string; lng: number; lat: number; heading: number | null; speed_mps: number | null; accuracy_m: number | null; updated_at: string }>>;
  trailsByJob: Record<string, [number, number][]>;
  cedarOn: boolean;
  radarOn: boolean;
  layers: Record<LayerKey, boolean>;
  flyToJobId?: string | null;
  onMapReady?: () => void;
};

function fc(features: GeoJSON.Feature[]): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features };
}

export default function MonitorMap({ accessToken, jobs, clearedByJob, operatorsByJob, trailsByJob, layers, flyToJobId, onMapReady }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const operatorMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const rotationRef = useRef<number | null>(null);

  // ── Create map once ──
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    mapboxgl.accessToken = accessToken;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center: [-99.1403, 30.0469],
      zoom: 11,
      preserveDrawingBuffer: true,
      antialias: true,
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    map.addControl(new mapboxgl.ScaleControl({ unit: 'imperial' }), 'bottom-right');

    map.on('load', () => {
      // DEM
      map.addSource('mapbox-dem', { type: 'raster-dem', url: 'mapbox://mapbox.mapbox-terrain-dem-v1', tileSize: 512, maxzoom: 14 });

      // Soil WMS
      map.addSource('soil-wms', { type: 'raster', tiles: ['https://SDMDataAccess.sc.egov.usda.gov/Spatial/SDM.wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=mapunitpoly&STYLES=&SRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=TRUE'], tileSize: 256 });
      map.addLayer({ id: 'soil-overlay', type: 'raster', source: 'soil-wms', paint: { 'raster-opacity': 0.45 }, layout: { visibility: 'none' } });

      // NAIP RGB
      map.addSource('naip-rgb', { type: 'raster', tiles: ['https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png&f=image'], tileSize: 256 });
      map.addLayer({ id: 'naip-overlay', type: 'raster', source: 'naip-rgb', paint: { 'raster-opacity': 0.85 }, layout: { visibility: 'none' } });

      // NAIP CIR
      map.addSource('naip-cir', { type: 'raster', tiles: ['https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png&bandIds=3,0,1&f=image'], tileSize: 256 });
      map.addLayer({ id: 'naip-cir-overlay', type: 'raster', source: 'naip-cir', paint: { 'raster-opacity': 0.85 }, layout: { visibility: 'none' } });

      // NAIP NDVI
      map.addSource('naip-ndvi', { type: 'raster', tiles: ['https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png&renderingRule=%7B%22rasterFunction%22%3A%22NDVI%22%2C%22rasterFunctionArguments%22%3A%7B%22VisibleBandID%22%3A0%2C%22InfraredBandID%22%3A3%7D%7D&f=image'], tileSize: 256 });
      map.addLayer({ id: 'naip-ndvi-overlay', type: 'raster', source: 'naip-ndvi', paint: { 'raster-opacity': 0.75 }, layout: { visibility: 'none' } });

      // Radar — fetch live timestamp
      (async () => {
        let radarUrl = 'https://tilecache.rainviewer.com/v2/radar/nowcast_1/{z}/{x}/{y}/2/1_1.png';
        try {
          const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
          if (res.ok) {
            const data = await res.json();
            const frames = data?.radar?.past ?? [];
            const latest = frames[frames.length - 1];
            if (latest?.path) radarUrl = `https://tilecache.rainviewer.com${latest.path}/256/{z}/{x}/{y}/2/1_1.png`;
          }
        } catch { /* fallback URL */ }
        if (!map.getSource('radar')) {
          map.addSource('radar', { type: 'raster', tiles: [radarUrl], tileSize: 256 });
          map.addLayer({ id: 'radar-layer', type: 'raster', source: 'radar', paint: { 'raster-opacity': 0.65 }, layout: { visibility: 'none' } });
        }
      })();

      // Hologram mask (inverted polygon — black outside pastures)
      map.addSource('holo-mask', { type: 'geojson', data: fc([]) });
      map.addLayer({ id: 'holo-mask-fill', type: 'fill', source: 'holo-mask', paint: { 'fill-color': '#000000', 'fill-opacity': 0.92 }, layout: { visibility: 'none' } });

      // Cedar cells
      map.addSource('monitor-cedar-cells', { type: 'geojson', data: fc([]) });
      map.addLayer({ id: 'monitor-cedar-fill', type: 'fill', source: 'monitor-cedar-cells', paint: { 'fill-color': ['case', ['==', ['get', 'cleared'], 1], '#2a2a2a', ['get', 'holoColor']], 'fill-opacity': ['case', ['==', ['get', 'cleared'], 1], 0.25, 0.55] }, layout: { visibility: 'none' } });
      map.addLayer({ id: 'monitor-cedar-border', type: 'line', source: 'monitor-cedar-cells', paint: { 'line-color': ['case', ['==', ['get', 'cleared'], 1], '#555555', ['get', 'holoColor']], 'line-width': 0.5, 'line-opacity': 0.55 }, layout: { visibility: 'none' } });

      // Pasture polygons
      map.addSource('monitor-pastures', { type: 'geojson', data: fc([]) });
      map.addLayer({ id: 'monitor-pastures-fill', type: 'fill', source: 'monitor-pastures', paint: { 'fill-color': '#00ff41', 'fill-opacity': 0.08 } });
      map.addLayer({ id: 'monitor-pastures-border', type: 'line', source: 'monitor-pastures', paint: { 'line-color': '#00ff41', 'line-width': 2, 'line-opacity': 0.8, 'line-dasharray': [2, 1] } });
      map.addLayer({ id: 'monitor-pastures-label', type: 'symbol', source: 'monitor-pastures', layout: { 'text-field': ['concat', ['get', 'jobTitle'], '\n', ['get', 'name'], ' — ', ['get', 'acreLabel']], 'text-size': 13, 'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'], 'text-anchor': 'center' }, paint: { 'text-color': '#00ff41', 'text-halo-color': '#000', 'text-halo-width': 1.5 } });

      // Operator trails
      map.addSource('operator-trails', { type: 'geojson', data: fc([]) });
      map.addLayer({ id: 'operator-trails-line', type: 'line', source: 'operator-trails', paint: { 'line-color': '#FF6B00', 'line-width': 3, 'line-opacity': 0.7 } });

      // Click handlers
      map.on('click', 'monitor-pastures-fill', (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const props = f.properties as any;
        if (!popupRef.current) popupRef.current = new mapboxgl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '360px' });
        popupRef.current.setLngLat(e.lngLat).setHTML(`
          <div style="font-family:ui-monospace,monospace;font-size:12px;color:#e5e2e1;">
            <div style="font-weight:900;letter-spacing:0.08em;color:#13ff43;">${props?.name ?? 'Pasture'}</div>
            <div style="margin-top:4px;opacity:0.85;">${props?.acreLabel ?? ''}</div>
            <div style="margin-top:6px;opacity:0.85;">Cedar: ${props?.cedarCleared ?? 0}/${props?.cedarTotal ?? 0} cleared</div>
          </div>
        `).addTo(map);
      });
      map.on('mouseenter', 'monitor-pastures-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'monitor-pastures-fill', () => { map.getCanvas().style.cursor = ''; });

      setMapLoaded(true);
      onMapReady?.();
    });

    mapRef.current = map;
    return () => {
      if (rotationRef.current) cancelAnimationFrame(rotationRef.current);
      popupRef.current?.remove();
      for (const m of operatorMarkersRef.current.values()) m.remove();
      operatorMarkersRef.current.clear();
      map.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  // ── Push data to map whenever jobs/cleared change AND map is loaded ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const cedarSrc = map.getSource('monitor-cedar-cells') as mapboxgl.GeoJSONSource | undefined;
    const pastureSrc = map.getSource('monitor-pastures') as mapboxgl.GeoJSONSource | undefined;
    const maskSrc = map.getSource('holo-mask') as mapboxgl.GeoJSONSource | undefined;
    if (!cedarSrc || !pastureSrc) return;

    const cedarFeats: GeoJSON.Feature[] = [];
    const pastureFeats: GeoJSON.Feature[] = [];
    const bounds = new mapboxgl.LngLatBounds();
    let hasBounds = false;

    for (const job of jobs) {
      const bid = job.bid_snapshot;
      if (!bid?.pastures) continue;
      const cleared = clearedByJob[job.id] ?? new Set<string>();

      for (const p of bid.pastures) {
        // Cedar cells
        const gridFeats = p.cedarAnalysis?.gridCells?.features ?? [];
        let cedarTotal = 0, cedarCleared = 0;
        gridFeats.forEach((f: any, idx: number) => {
          const cls = f?.properties?.classification;
          if (cls !== 'cedar' && cls !== 'oak' && cls !== 'mixed_brush') return;
          cedarTotal++;
          const cellId = `${p.id}:${idx}`;
          if (cleared.has(cellId)) cedarCleared++;
          cedarFeats.push({ ...(f as GeoJSON.Feature), properties: { ...(f as any).properties, jobId: job.id, cellId, holoColor: cls === 'cedar' ? '#00ff41' : cls === 'oak' ? '#ffaa00' : '#22dd44', cleared: cleared.has(cellId) ? 1 : 0 } });
        });

        // Pasture polygon
        const ring = p.polygon?.geometry?.coordinates?.[0];
        if (ring && ring.length >= 3) {
          pastureFeats.push({ type: 'Feature', geometry: p.polygon.geometry, properties: { jobId: job.id, jobTitle: job.title ?? '', pastureId: p.id, name: p.name, acreLabel: `${p.acreage ?? 0} ac`, cedarTotal, cedarCleared } } as GeoJSON.Feature);
          for (const c of ring) {
            if (Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1])) {
              bounds.extend(c as [number, number]);
              hasBounds = true;
            }
          }
        }
      }
    }

    cedarSrc.setData(fc(cedarFeats));
    pastureSrc.setData(fc(pastureFeats));

    // Build hologram mask (world minus pasture holes)
    if (maskSrc) {
      const worldRing: [number, number][] = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
      const holes: [number, number][][] = [];
      for (const feat of pastureFeats) {
        const ring = (feat.geometry as GeoJSON.Polygon)?.coordinates?.[0];
        if (ring) holes.push(ring as [number, number][]);
      }
      if (holes.length > 0) {
        maskSrc.setData(fc([{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [worldRing, ...holes] }, properties: {} }]));
      }
    }

    // Fit to pastures on first data load
    if (hasBounds) {
      map.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 1200 });
    }
  }, [jobs, clearedByJob, mapLoaded]);

  // ── Toggle layer visibility ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const rasterMap: Record<string, string> = { naip: 'naip-overlay', naipCIR: 'naip-cir-overlay', naipNDVI: 'naip-ndvi-overlay' };
    for (const [key, layerId] of Object.entries(rasterMap)) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', layers[key as LayerKey] ? 'visible' : 'none');
      }
    }

    // Soil: always on top at 100% opacity when selected
    if (map.getLayer('soil-overlay')) {
      map.setLayoutProperty('soil-overlay', 'visibility', layers.soil ? 'visible' : 'none');
      map.setPaintProperty('soil-overlay', 'raster-opacity', 1.0);
      if (layers.soil) map.moveLayer('soil-overlay');
    }

    // Radar
    if (map.getLayer('radar-layer')) {
      map.setLayoutProperty('radar-layer', 'visibility', layers.radar ? 'visible' : 'none');
    }

    // 3D terrain — exaggeration 2x
    if (layers.terrain3d) {
      try {
        map.setTerrain({ source: 'mapbox-dem', exaggeration: 2.0 });
        if (!map.getLayer('sky')) {
          map.addLayer({ id: 'sky', type: 'sky', paint: { 'sky-type': 'atmosphere', 'sky-atmosphere-sun': [0.0, 90.0], 'sky-atmosphere-sun-intensity': 15 } });
        }
        if (map.getPitch() < 30) map.easeTo({ pitch: 50, duration: 800 });
      } catch { /* optional */ }
    } else {
      map.setTerrain(null);
      if (map.getLayer('sky')) { try { map.removeLayer('sky'); } catch {} }
    }

    // Cedar cells — respect the toggle directly
    for (const id of ['monitor-cedar-fill', 'monitor-cedar-border']) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', layers.cedarAI ? 'visible' : 'none');
    }

    // Pastures
    for (const id of ['monitor-pastures-fill', 'monitor-pastures-border', 'monitor-pastures-label']) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', layers.pastures ? 'visible' : 'none');
    }

    // ── Hologram mode ──
    if (layers.hologram) {
      // Show mask
      if (map.getLayer('holo-mask-fill')) map.setLayoutProperty('holo-mask-fill', 'visibility', 'visible');

      // Desaturate satellite
      for (const bl of (map.getStyle().layers ?? [])) {
        if (bl.id.startsWith('satellite') || bl.id.includes('mapbox-satellite')) {
          try {
            map.setPaintProperty(bl.id, 'raster-saturation', -0.8);
            map.setPaintProperty(bl.id, 'raster-brightness-max', 0.35);
          } catch {}
        }
      }

      // Hide roads/labels/etc
      for (const bl of (map.getStyle().layers ?? [])) {
        if (/road|label|poi|building|transit|admin|place|water-|waterway|land-structure|aeroway/.test(bl.id)) {
          try { map.setLayoutProperty(bl.id, 'visibility', 'none'); } catch {}
        }
      }

      // NDVI on if available
      if (map.getLayer('naip-ndvi-overlay')) {
        map.setLayoutProperty('naip-ndvi-overlay', 'visibility', 'visible');
        map.setPaintProperty('naip-ndvi-overlay', 'raster-opacity', 1.0);
      }

      // Green hologram styling on cedar cells
      const holoExpr: mapboxgl.Expression = ['match', ['get', 'classification'], 'cedar', '#00ff41', 'oak', '#ffaa00', 'mixed_brush', '#22dd44', '#00ff41'];
      if (map.getLayer('monitor-cedar-fill')) {
        map.setPaintProperty('monitor-cedar-fill', 'fill-color', holoExpr);
        map.setPaintProperty('monitor-cedar-fill', 'fill-opacity', 0.7);
      }
      if (map.getLayer('monitor-cedar-border')) {
        map.setPaintProperty('monitor-cedar-border', 'line-color', holoExpr);
        map.setPaintProperty('monitor-cedar-border', 'line-opacity', 0.9);
        map.setPaintProperty('monitor-cedar-border', 'line-width', 1.5);
      }

      // Green pasture borders
      if (map.getLayer('monitor-pastures-border')) {
        map.setPaintProperty('monitor-pastures-border', 'line-color', '#00ff41');
        map.setPaintProperty('monitor-pastures-border', 'line-width', 3);
      }
      if (map.getLayer('monitor-pastures-fill')) {
        map.setPaintProperty('monitor-pastures-fill', 'fill-color', '#00ff41');
        map.setPaintProperty('monitor-pastures-fill', 'fill-opacity', 0.05);
      }

      // Camera pitch
      map.easeTo({ pitch: 55, bearing: map.getBearing() || -20, duration: 1200 });
    } else {
      // Undo hologram

      if (map.getLayer('holo-mask-fill')) map.setLayoutProperty('holo-mask-fill', 'visibility', 'none');

      // Restore satellite
      for (const bl of (map.getStyle().layers ?? [])) {
        if (bl.id.startsWith('satellite') || bl.id.includes('mapbox-satellite')) {
          try {
            map.setPaintProperty(bl.id, 'raster-saturation', 0);
            map.setPaintProperty(bl.id, 'raster-brightness-max', 1);
          } catch {}
        }
      }

      // Restore roads/labels
      for (const bl of (map.getStyle().layers ?? [])) {
        if (/road|label|poi|building|transit|admin|place|water-|waterway|land-structure|aeroway/.test(bl.id)) {
          try { map.setLayoutProperty(bl.id, 'visibility', 'visible'); } catch {}
        }
      }

      // Restore cedar styling
      if (map.getLayer('monitor-cedar-fill')) {
        map.setPaintProperty('monitor-cedar-fill', 'fill-color', ['case', ['==', ['get', 'cleared'], 1], '#2a2a2a', ['get', 'holoColor']]);
        map.setPaintProperty('monitor-cedar-fill', 'fill-opacity', ['case', ['==', ['get', 'cleared'], 1], 0.25, 0.55]);
      }
      if (map.getLayer('monitor-cedar-border')) {
        map.setPaintProperty('monitor-cedar-border', 'line-color', ['case', ['==', ['get', 'cleared'], 1], '#555555', ['get', 'holoColor']]);
        map.setPaintProperty('monitor-cedar-border', 'line-opacity', 0.55);
        map.setPaintProperty('monitor-cedar-border', 'line-width', 0.5);
      }

      // Restore pasture styling
      if (map.getLayer('monitor-pastures-border')) {
        map.setPaintProperty('monitor-pastures-border', 'line-color', '#00ff41');
        map.setPaintProperty('monitor-pastures-border', 'line-width', 2);
      }
      if (map.getLayer('monitor-pastures-fill')) {
        map.setPaintProperty('monitor-pastures-fill', 'fill-color', '#00ff41');
        map.setPaintProperty('monitor-pastures-fill', 'fill-opacity', 0.08);
      }

      // Reset camera (but keep pitch if terrain is on)
      if (!layers.terrain3d) {
        map.easeTo({ pitch: 0, bearing: 0, duration: 800 });
      } else {
        map.easeTo({ bearing: 0, duration: 800 });
      }
    }
  }, [layers, mapLoaded]);

  // Hologram auto-rotation: start when hologram on, stop when off.
  // Delayed 1.3s to let the easeTo pitch animation finish first.
  // Pauses for 3s on user interaction then resumes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    if (!layers.hologram) {
      if (rotationRef.current) { cancelAnimationFrame(rotationRef.current); rotationRef.current = null; }
      return;
    }

    let alive = true;
    let resumeTimer: ReturnType<typeof setTimeout> | null = null;

    const startRotation = () => {
      if (!alive || rotationRef.current) return;
      const spin = () => {
        if (!alive || !mapRef.current) return;
        mapRef.current.setBearing(mapRef.current.getBearing() + 0.0375);
        rotationRef.current = requestAnimationFrame(spin);
      };
      rotationRef.current = requestAnimationFrame(spin);
    };

    const pause = () => {
      if (rotationRef.current) { cancelAnimationFrame(rotationRef.current); rotationRef.current = null; }
      if (resumeTimer) clearTimeout(resumeTimer);
      resumeTimer = setTimeout(startRotation, 3000);
    };

    // Wait for the easeTo animation to finish before starting rotation
    const startDelay = setTimeout(startRotation, 1400);

    map.on('mousedown', pause);
    map.on('touchstart', pause);
    map.on('wheel', pause);

    return () => {
      alive = false;
      clearTimeout(startDelay);
      if (rotationRef.current) { cancelAnimationFrame(rotationRef.current); rotationRef.current = null; }
      if (resumeTimer) clearTimeout(resumeTimer);
      map.off('mousedown', pause);
      map.off('touchstart', pause);
      map.off('wheel', pause);
    };
  }, [layers.hologram, mapLoaded]);

  // ── Operator trails ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const src = map.getSource('operator-trails') as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;

    const features: GeoJSON.Feature[] = [];
    for (const [jobId, coords] of Object.entries(trailsByJob)) {
      if (!coords || coords.length < 2) continue;
      features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: { jobId } });
    }
    src.setData(fc(features));
  }, [trailsByJob, mapLoaded]);

  // ── Hologram 3D trees: individual canopy extrusions that follow terrain ──
  // Each tree from extractTreesFromAnalysis gets a small hexagon polygon
  // extruded to its height. Cleared cells' trees are excluded entirely.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const SRC = 'holo-tree-src';
    const CANOPY = 'holo-tree-canopy';
    const TRUNK = 'holo-tree-trunk';

    if (!layers.hologram) {
      for (const id of [CANOPY, TRUNK]) { if (map.getLayer(id)) try { map.removeLayer(id); } catch {} }
      if (map.getSource(SRC)) try { map.removeSource(SRC); } catch {}
      return;
    }

    // Collect cleared cells
    const allCleared = new Set<string>();
    for (const job of jobs) {
      const cleared = clearedByJob[job.id];
      if (cleared) for (const id of cleared) allCleared.add(id);
    }

    // Filter out cleared cells, then extract tree positions
    const filteredPastures: Array<{ cedarAnalysis: any; density: string }> = [];
    for (const job of jobs) {
      const bid = job.bid_snapshot;
      if (!bid?.pastures) continue;
      for (const p of bid.pastures) {
        if (!p.cedarAnalysis?.gridCells?.features) continue;
        const kept = p.cedarAnalysis.gridCells.features.filter((_: any, idx: number) => !allCleared.has(`${p.id}:${idx}`));
        filteredPastures.push({
          cedarAnalysis: { gridCells: { ...p.cedarAnalysis.gridCells, features: kept }, summary: p.cedarAnalysis.summary },
          density: p.density,
        });
      }
    }

    const trees = extractTreesFromAnalysis(filteredPastures as any);

    // Build hexagon canopy polygons for each tree
    const feats: GeoJSON.Feature[] = [];
    const mPerDegLat = 111320;
    for (const t of trees) {
      const radiusM = t.canopyDiameter / 2;
      const radiusDegLat = radiusM / mPerDegLat;
      const radiusDegLng = radiusM / (mPerDegLat * Math.cos((t.lat * Math.PI) / 180));
      const color = t.species === 'cedar' ? '#00ff41' : t.species === 'oak' ? '#ffaa00' : '#22dd44';

      // 6-sided polygon (hexagon) for canopy
      const sides = 6;
      const ring: [number, number][] = [];
      for (let i = 0; i <= sides; i++) {
        const angle = (i * 2 * Math.PI) / sides;
        ring.push([
          t.lng + Math.cos(angle) * radiusDegLng,
          t.lat + Math.sin(angle) * radiusDegLat,
        ]);
      }

      feats.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: {
          color,
          height: t.height,
          trunkTop: t.species === 'oak' ? t.height * 0.4 : t.height * 0.15,
        },
      });
    }

    // Remove old layers/source
    for (const id of [CANOPY, TRUNK]) { if (map.getLayer(id)) try { map.removeLayer(id); } catch {} }
    if (map.getSource(SRC)) try { map.removeSource(SRC); } catch {}

    map.addSource(SRC, { type: 'geojson', data: fc(feats) });

    // Trunk: short extrusion from ground to canopy base
    map.addLayer({
      id: TRUNK,
      type: 'fill-extrusion',
      source: SRC,
      paint: {
        'fill-extrusion-color': ['get', 'color'],
        'fill-extrusion-opacity': 0.3,
        'fill-extrusion-height': ['get', 'trunkTop'],
        'fill-extrusion-base': 0,
      },
    });

    // Canopy: extrusion from trunk top to full height
    map.addLayer({
      id: CANOPY,
      type: 'fill-extrusion',
      source: SRC,
      paint: {
        'fill-extrusion-color': ['get', 'color'],
        'fill-extrusion-opacity': 0.65,
        'fill-extrusion-height': ['get', 'height'],
        'fill-extrusion-base': ['get', 'trunkTop'],
      },
    });

    // Move labels on top
    for (const layerId of ['monitor-pastures-label', 'monitor-pastures-border']) {
      if (map.getLayer(layerId)) try { map.moveLayer(layerId); } catch {}
    }
  }, [layers.hologram, mapLoaded, jobs, clearedByJob]);

  // ── Operator markers ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const markers = operatorMarkersRef.current;
    const nextKeys = new Set<string>();

    for (const [jobId, ops] of Object.entries(operatorsByJob ?? {})) {
      for (const op of ops ?? []) {
        if (typeof op.lng !== 'number' || typeof op.lat !== 'number') continue;
        const key = `${jobId}:${op.user_id}`;
        nextKeys.add(key);
        const existing = markers.get(key);
        if (existing) { existing.setLngLat([op.lng, op.lat]); continue; }

        const el = document.createElement('div');
        el.style.cssText = 'width:16px;height:16px;border-radius:999px;border:2px solid #fff;background:#FF6B00;box-shadow:0 0 12px rgba(255,107,0,0.6);cursor:pointer;';
        const marker = new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat([op.lng, op.lat]).addTo(map);
        el.addEventListener('click', () => {
          new mapboxgl.Popup({ closeButton: true, closeOnClick: true }).setLngLat([op.lng, op.lat]).setHTML(`
            <div style="font-family:ui-monospace,monospace;font-size:12px;color:#e5e2e1;">
              <div style="font-weight:800;color:#FF6B00;">OPERATOR</div>
              <div style="opacity:0.8;margin-top:4px;">${op.user_id}</div>
              <div style="opacity:0.7;margin-top:4px;">Speed: ${op.speed_mps != null ? (op.speed_mps * 2.237).toFixed(1) + ' mph' : '—'}</div>
              <div style="opacity:0.7;">Accuracy: ${op.accuracy_m != null ? Math.round(op.accuracy_m) + 'm' : '—'}</div>
            </div>
          `).addTo(map);
        });
        markers.set(key, marker);
      }
    }
    for (const [key, marker] of markers.entries()) {
      if (!nextKeys.has(key)) { marker.remove(); markers.delete(key); }
    }
  }, [operatorsByJob, mapLoaded]);

  // ── Fly to a specific job's pastures ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !flyToJobId) return;
    const job = jobs.find((j) => j.id === flyToJobId);
    if (!job?.bid_snapshot?.pastures) return;

    const bounds = new mapboxgl.LngLatBounds();
    let hasBounds = false;
    for (const p of job.bid_snapshot.pastures) {
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
      map.fitBounds(bounds, { padding: 80, maxZoom: 17, duration: 1400 });
    }
  }, [flyToJobId, mapLoaded, jobs]);

  return <div ref={containerRef} className="w-full h-full" />;
}
