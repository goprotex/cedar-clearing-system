/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import type { Bid } from '@/types';

type JobLike = {
  id: string;
  bid_snapshot: Bid;
};

type Props = {
  accessToken: string;
  jobs: JobLike[];
  clearedByJob: Record<string, Set<string>>;
  operatorsByJob: Record<string, Array<{ user_id: string; lng: number; lat: number; heading: number | null; speed_mps: number | null; accuracy_m: number | null; updated_at: string }>>;
  cedarOn: boolean;
  radarOn: boolean;
};

function asFeatureCollection(features: GeoJSON.Feature[]): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features };
}

// RainViewer radar tiles (no key). See https://www.rainviewer.com/api.html
// Note: this is a "nowcast" endpoint; if it ever changes, swap to their timestamped frames API.
const RAINVIEWER_TILES = 'https://tilecache.rainviewer.com/v2/radar/nowcast_1/{z}/{x}/{y}/2/1_1.png';

export default function MonitorMap({ accessToken, jobs, clearedByJob, operatorsByJob, cedarOn, radarOn }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const operatorMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    mapboxgl.accessToken = accessToken;

    const center: [number, number] =
      jobs[0]?.bid_snapshot?.propertyCenter ?? [-99.1403, 30.0469];

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center,
      zoom: 11,
      preserveDrawingBuffer: true,
      antialias: true,
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    map.on('load', () => {
      // Radar overlay (hidden by default; toggled via effect)
      map.addSource('radar', {
        type: 'raster',
        tiles: [RAINVIEWER_TILES],
        tileSize: 256,
      });
      map.addLayer({
        id: 'radar-layer',
        type: 'raster',
        source: 'radar',
        paint: { 'raster-opacity': 0.65 },
        layout: { visibility: 'none' },
      });

      // Cedar cells across all jobs
      map.addSource('monitor-cedar-cells', {
        type: 'geojson',
        data: asFeatureCollection([]),
      });
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
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  // Update radar visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    if (map.getLayer('radar-layer')) {
      map.setLayoutProperty('radar-layer', 'visibility', radarOn ? 'visible' : 'none');
    }
  }, [radarOn]);

  // Update cedar source data whenever jobs or cleared changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const src = map.getSource('monitor-cedar-cells') as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;

    const features: GeoJSON.Feature[] = [];
    for (const job of jobs) {
      const bid = job.bid_snapshot;
      const cleared = clearedByJob[job.id] ?? new Set<string>();
      for (const p of bid.pastures) {
        const fc = p.cedarAnalysis?.gridCells?.features ?? [];
        fc.forEach((f: any, idx: number) => {
          const cls = f?.properties?.classification;
          if (cls !== 'cedar' && cls !== 'oak' && cls !== 'mixed_brush') return;
          const cellId = `${p.id}:${idx}`;
          const holoColor = cls === 'cedar' ? '#00ff41' : cls === 'oak' ? '#ffaa00' : '#22dd44';
          features.push({
            ...(f as GeoJSON.Feature),
            properties: {
              ...(f as any).properties,
              jobId: job.id,
              cellId,
              holoColor,
              cleared: cleared.has(cellId) ? 1 : 0,
            },
          });
        });
      }
    }

    src.setData(asFeatureCollection(features));
  }, [jobs, clearedByJob]);

  // Update operator markers (live dots)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const markers = operatorMarkersRef.current;
    const nextKeys = new Set<string>();

    for (const [jobId, ops] of Object.entries(operatorsByJob ?? {})) {
      for (const op of ops ?? []) {
        const key = `${jobId}:${op.user_id}`;
        nextKeys.add(key);
        const existing = markers.get(key);
        if (existing) {
          existing.setLngLat([op.lng, op.lat]);
          continue;
        }

        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'operator-dot';
        el.title = `Operator ${op.user_id}`;
        el.style.width = '12px';
        el.style.height = '12px';
        el.style.borderRadius = '999px';
        el.style.border = '2px solid #fff';
        el.style.background = '#FF6B00';
        el.style.boxShadow = '0 0 12px rgba(255,107,0,0.55)';

        el.onclick = () => {
          const html = `
            <div style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;">
              <div style="font-weight:800; letter-spacing:0.08em;">OPERATOR</div>
              <div style="opacity:0.8; margin-top:4px;">${op.user_id}</div>
              <div style="opacity:0.8; margin-top:6px;">JOB ${jobId}</div>
              <div style="margin-top:8px;">
                <a href="/operator/${op.user_id}" style="color:#FF6B00; font-weight:800; text-decoration:none;">VIEW_PROFILE</a>
              </div>
            </div>
          `;
          new mapboxgl.Popup({ closeButton: true, closeOnClick: true })
            .setLngLat([op.lng, op.lat])
            .setHTML(html)
            .addTo(map);
        };

        const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([op.lng, op.lat])
          .addTo(map);
        markers.set(key, marker);
      }
    }

    // Remove stale markers
    for (const [key, marker] of markers.entries()) {
      if (!nextKeys.has(key)) {
        marker.remove();
        markers.delete(key);
      }
    }
  }, [operatorsByJob]);

  // Toggle cedar visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    for (const layerId of ['monitor-cedar-fill', 'monitor-cedar-border']) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', cedarOn ? 'visible' : 'none');
      }
    }
  }, [cedarOn]);

  return <div ref={containerRef} className="w-full h-full" />;
}

