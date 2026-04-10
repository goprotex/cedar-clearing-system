/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import type { Bid } from '@/types';

type JobLike = {
  id: string;
  bid_snapshot: Bid;
  title?: string;
  status?: string;
  cedar_total_cells?: number;
  cedar_cleared_cells?: number;
};

export type LayerKey = 'soil' | 'naip' | 'naipCIR' | 'naipNDVI' | 'terrain3d' | 'cedarAI' | 'radar' | 'pastures';

type Props = {
  accessToken: string;
  jobs: JobLike[];
  clearedByJob: Record<string, Set<string>>;
  operatorsByJob: Record<string, Array<{ user_id: string; lng: number; lat: number; heading: number | null; speed_mps: number | null; accuracy_m: number | null; updated_at: string }>>;
  cedarOn: boolean;
  radarOn: boolean;
  layers: Record<LayerKey, boolean>;
  onMapReady?: () => void;
};

function asFeatureCollection(features: GeoJSON.Feature[]): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features };
}

export default function MonitorMap({ accessToken, jobs, clearedByJob, operatorsByJob, cedarOn, radarOn, layers, onMapReady }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const operatorMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const [radarTs, setRadarTs] = useState<string | null>(null);

  // Fetch current RainViewer radar timestamp on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
        if (!res.ok) return;
        const data = await res.json();
        const frames = data?.radar?.past ?? [];
        const latest = frames[frames.length - 1];
        if (latest?.path) setRadarTs(latest.path);
      } catch { /* radar optional */ }
    })();
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    mapboxgl.accessToken = accessToken;

    // Compute center from all jobs' pastures
    const allCoords: [number, number][] = [];
    for (const job of jobs) {
      for (const p of job.bid_snapshot?.pastures ?? []) {
        const ring = p.polygon?.geometry?.coordinates?.[0];
        if (!ring || ring.length < 3) continue;
        for (const c of ring) {
          if (Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1])) {
            allCoords.push(c as [number, number]);
          }
        }
      }
    }
    let center: [number, number] = [-99.1403, 30.0469];
    let zoom = 11;
    if (allCoords.length > 0) {
      const bounds = new mapboxgl.LngLatBounds();
      for (const c of allCoords) bounds.extend(c);
      center = bounds.getCenter().toArray() as [number, number];
    }

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center,
      zoom,
      preserveDrawingBuffer: true,
      antialias: true,
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    map.addControl(new mapboxgl.ScaleControl({ unit: 'imperial' }), 'bottom-right');

    map.on('load', () => {
      // ── DEM source (for 3D terrain) ──
      map.addSource('mapbox-dem', {
        type: 'raster-dem',
        url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
        tileSize: 512,
        maxzoom: 14,
      });

      // ── USDA Soil WMS overlay ──
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

      // ── NAIP Natural Color ──
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

      // ── NAIP CIR ──
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

      // ── NAIP NDVI ──
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

      // ── Weather radar ──
      const radarUrl = radarTs
        ? `https://tilecache.rainviewer.com${radarTs}/256/{z}/{x}/{y}/2/1_1.png`
        : 'https://tilecache.rainviewer.com/v2/radar/nowcast_1/{z}/{x}/{y}/2/1_1.png';
      map.addSource('radar', { type: 'raster', tiles: [radarUrl], tileSize: 256 });
      map.addLayer({
        id: 'radar-layer',
        type: 'raster',
        source: 'radar',
        paint: { 'raster-opacity': 0.65 },
        layout: { visibility: 'none' },
      });

      // ── Cedar cells ──
      map.addSource('monitor-cedar-cells', { type: 'geojson', data: asFeatureCollection([]) });
      map.addLayer({
        id: 'monitor-cedar-fill',
        type: 'fill',
        source: 'monitor-cedar-cells',
        paint: {
          'fill-color': ['case', ['==', ['get', 'cleared'], 1], '#2a2a2a', ['get', 'holoColor']],
          'fill-opacity': ['case', ['==', ['get', 'cleared'], 1], 0.25, 0.55],
        },
        layout: { visibility: 'none' },
      });
      map.addLayer({
        id: 'monitor-cedar-border',
        type: 'line',
        source: 'monitor-cedar-cells',
        paint: {
          'line-color': ['case', ['==', ['get', 'cleared'], 1], '#555555', ['get', 'holoColor']],
          'line-width': 0.5,
          'line-opacity': 0.55,
        },
        layout: { visibility: 'none' },
      });

      // ── Pasture polygons ──
      map.addSource('monitor-pastures', { type: 'geojson', data: asFeatureCollection([]) });
      map.addLayer({
        id: 'monitor-pastures-fill',
        type: 'fill',
        source: 'monitor-pastures',
        paint: { 'fill-color': '#00ff41', 'fill-opacity': 0.08 },
      });
      map.addLayer({
        id: 'monitor-pastures-border',
        type: 'line',
        source: 'monitor-pastures',
        paint: { 'line-color': '#00ff41', 'line-width': 2, 'line-opacity': 0.8, 'line-dasharray': [2, 1] },
      });
      map.addLayer({
        id: 'monitor-pastures-label',
        type: 'symbol',
        source: 'monitor-pastures',
        layout: {
          'text-field': ['concat', ['get', 'name'], '\n', ['get', 'acreLabel']],
          'text-size': 13,
          'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
          'text-anchor': 'center',
        },
        paint: { 'text-color': '#00ff41', 'text-halo-color': '#000', 'text-halo-width': 1.5 },
      });

      // ── Click handlers ──
      const ensurePopup = () => {
        if (!popupRef.current) {
          popupRef.current = new mapboxgl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '360px' });
        }
        return popupRef.current;
      };

      map.on('click', 'monitor-pastures-fill', (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const props = f.properties as any;
        const html = `
          <div style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #e5e2e1;">
            <div style="font-weight:900; letter-spacing:0.08em; color:#13ff43;">${props?.name ?? 'Pasture'}</div>
            <div style="margin-top:4px; opacity:0.85;">${props?.acreLabel ?? ''}</div>
            <div style="margin-top:6px; opacity:0.85;">Cedar: ${props?.cedarCleared ?? 0}/${props?.cedarTotal ?? 0} cleared</div>
            <div style="margin-top:4px; opacity:0.85;">Job: ${props?.jobId ?? 'local'}</div>
          </div>
        `;
        ensurePopup().setLngLat(e.lngLat).setHTML(html).addTo(map);
      });
      map.on('mouseenter', 'monitor-pastures-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'monitor-pastures-fill', () => { map.getCanvas().style.cursor = ''; });

      // Fit to all pastures
      if (allCoords.length > 0) {
        const fitBounds = new mapboxgl.LngLatBounds();
        for (const c of allCoords) fitBounds.extend(c);
        map.fitBounds(fitBounds, { padding: 60, maxZoom: 16, duration: 1200 });
      }

      onMapReady?.();
    });

    mapRef.current = map;
    return () => {
      popupRef.current?.remove();
      popupRef.current = null;
      for (const m of operatorMarkersRef.current.values()) m.remove();
      operatorMarkersRef.current.clear();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, radarTs]);

  // ── Toggle raster layers ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const layerMap: Record<string, string> = {
      soil: 'soil-overlay',
      naip: 'naip-overlay',
      naipCIR: 'naip-cir-overlay',
      naipNDVI: 'naip-ndvi-overlay',
      radar: 'radar-layer',
    };

    for (const [key, layerId] of Object.entries(layerMap)) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', layers[key as LayerKey] ? 'visible' : 'none');
      }
    }

    // 3D terrain
    if (layers.terrain3d) {
      if (!map.getTerrain()) {
        try {
          map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.3 });
          if (!map.getLayer('sky')) {
            map.addLayer({
              id: 'sky', type: 'sky',
              paint: { 'sky-type': 'atmosphere', 'sky-atmosphere-sun': [0.0, 90.0], 'sky-atmosphere-sun-intensity': 15 },
            });
          }
        } catch { /* terrain optional */ }
      }
    } else {
      map.setTerrain(null);
      if (map.getLayer('sky')) {
        try { map.removeLayer('sky'); } catch { /* ignore */ }
      }
    }

    // Cedar cells visibility
    for (const layerId of ['monitor-cedar-fill', 'monitor-cedar-border']) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', layers.cedarAI ? 'visible' : 'none');
      }
    }

    // Pastures always visible (controlled separately)
    for (const layerId of ['monitor-pastures-fill', 'monitor-pastures-border', 'monitor-pastures-label']) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', layers.pastures ? 'visible' : 'none');
      }
    }
  }, [layers]);

  // ── Update cedar + pasture data ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const src = map.getSource('monitor-cedar-cells') as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;
    const pastureSrc = map.getSource('monitor-pastures') as mapboxgl.GeoJSONSource | undefined;

    const features: GeoJSON.Feature[] = [];
    const pastureFeatures: GeoJSON.Feature[] = [];
    for (const job of jobs) {
      const bid = job.bid_snapshot;
      if (!bid?.pastures) continue;
      const cleared = clearedByJob[job.id] ?? new Set<string>();
      for (const p of bid.pastures) {
        const fc = p.cedarAnalysis?.gridCells?.features ?? [];
        let cedarTotal = 0;
        let cedarCleared = 0;
        fc.forEach((f: any, idx: number) => {
          const cls = f?.properties?.classification;
          if (cls !== 'cedar' && cls !== 'oak' && cls !== 'mixed_brush') return;
          cedarTotal++;
          const cellId = `${p.id}:${idx}`;
          if (cleared.has(cellId)) cedarCleared++;
          const holoColor = cls === 'cedar' ? '#00ff41' : cls === 'oak' ? '#ffaa00' : '#22dd44';
          features.push({
            ...(f as GeoJSON.Feature),
            properties: { ...(f as any).properties, jobId: job.id, cellId, holoColor, cleared: cleared.has(cellId) ? 1 : 0 },
          });
        });

        if ((p.polygon as any)?.geometry?.coordinates?.length) {
          pastureFeatures.push({
            type: 'Feature',
            geometry: (p.polygon as any).geometry,
            properties: {
              jobId: job.id,
              pastureId: (p as any).id,
              name: (p as any).name,
              acreLabel: `${(p as any).acreage ?? 0} ac`,
              cedarTotal,
              cedarCleared,
            },
          } as GeoJSON.Feature);
        }
      }
    }

    src.setData(asFeatureCollection(features));
    if (pastureSrc) pastureSrc.setData(asFeatureCollection(pastureFeatures));
  }, [jobs, clearedByJob]);

  // ── Operator markers ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const markers = operatorMarkersRef.current;
    const nextKeys = new Set<string>();

    for (const [jobId, ops] of Object.entries(operatorsByJob ?? {})) {
      for (const op of ops ?? []) {
        if (typeof op.lng !== 'number' || typeof op.lat !== 'number') continue;
        const key = `${jobId}:${op.user_id}`;
        nextKeys.add(key);
        const existing = markers.get(key);
        if (existing) {
          existing.setLngLat([op.lng, op.lat]);
          continue;
        }

        const el = document.createElement('div');
        el.style.cssText = 'width:16px;height:16px;border-radius:999px;border:2px solid #fff;background:#FF6B00;box-shadow:0 0 12px rgba(255,107,0,0.6);cursor:pointer;';

        const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([op.lng, op.lat])
          .addTo(map);

        el.addEventListener('click', () => {
          new mapboxgl.Popup({ closeButton: true, closeOnClick: true })
            .setLngLat([op.lng, op.lat])
            .setHTML(`
              <div style="font-family:ui-monospace,monospace;font-size:12px;color:#e5e2e1;">
                <div style="font-weight:800;letter-spacing:0.08em;color:#FF6B00;">OPERATOR</div>
                <div style="opacity:0.8;margin-top:4px;">${op.user_id}</div>
                <div style="opacity:0.7;margin-top:4px;">Speed: ${op.speed_mps != null ? (op.speed_mps * 2.237).toFixed(1) + ' mph' : '—'}</div>
                <div style="opacity:0.7;">Accuracy: ${op.accuracy_m != null ? Math.round(op.accuracy_m) + 'm' : '—'}</div>
              </div>
            `)
            .addTo(map);
        });

        markers.set(key, marker);
      }
    }

    for (const [key, marker] of markers.entries()) {
      if (!nextKeys.has(key)) {
        marker.remove();
        markers.delete(key);
      }
    }
  }, [operatorsByJob]);

  return <div ref={containerRef} className="w-full h-full" />;
}
