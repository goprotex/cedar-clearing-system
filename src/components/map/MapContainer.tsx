'use client';

import { useRef, useEffect, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import 'mapbox-gl/dist/mapbox-gl.css';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import { calculateAcreage, getCentroid } from '@/lib/geo';
import { useBidStore } from '@/lib/store';

const VEGETATION_COLORS: Record<string, string> = {
  cedar: '#22c55e',
  oak: '#92400e',
  mixed: '#f97316',
  brush: '#eab308',
  mesquite: '#a16207',
};

interface MapContainerProps {
  accessToken: string;
}

export default function MapContainer({ accessToken }: MapContainerProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);

  const {
    currentBid,
    selectedPastureId,
    drawingMode,
    setPasturePolygon,
    setDrawingMode,
    selectPasture,
  } = useBidStore();

  // Handle polygon creation from draw
  const handleDrawCreate = useCallback(
    (e: { features: GeoJSON.Feature[] }) => {
      if (!selectedPastureId) return;
      const feature = e.features[0] as GeoJSON.Feature<GeoJSON.Polygon>;
      if (!feature || feature.geometry.type !== 'Polygon') return;

      const acreage = calculateAcreage(feature);
      const centroid = getCentroid(feature);
      setPasturePolygon(selectedPastureId, feature, acreage, centroid);

      // Clear the draw layer since we manage polygons ourselves
      if (drawRef.current) {
        drawRef.current.deleteAll();
      }
    },
    [selectedPastureId, setPasturePolygon]
  );

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    mapboxgl.accessToken = accessToken;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center: currentBid.propertyCenter,
      zoom: currentBid.mapZoom,
    });

    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: {},
      defaultMode: 'simple_select',
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    map.addControl(draw, 'top-right');

    map.on('load', () => {
      // Add 3D terrain source
      map.addSource('mapbox-dem', {
        type: 'raster-dem',
        url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
        tileSize: 512,
        maxzoom: 14,
      });

      // Pasture polygons source
      map.addSource('pastures', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      // Fill layer
      map.addLayer({
        id: 'pastures-fill',
        type: 'fill',
        source: 'pastures',
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.25,
        },
      });

      // Border layer
      map.addLayer({
        id: 'pastures-border',
        type: 'line',
        source: 'pastures',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': [
            'case',
            ['boolean', ['get', 'selected'], false],
            3,
            2,
          ],
          'line-dasharray': [
            'case',
            ['boolean', ['get', 'selected'], false],
            ['literal', [1]],
            ['literal', [2, 1]],
          ],
        },
      });

      // Acreage labels
      map.addLayer({
        id: 'pastures-labels',
        type: 'symbol',
        source: 'pastures',
        layout: {
          'text-field': ['concat', ['get', 'name'], '\n', ['get', 'acreageLabel']],
          'text-size': 13,
          'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
          'text-anchor': 'center',
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#000000',
          'text-halo-width': 1.5,
        },
      });

      // Click on pasture polygon to select
      map.on('click', 'pastures-fill', (e) => {
        const f = e.features?.[0];
        if (f?.properties?.pastureId) {
          selectPasture(f.properties.pastureId as string);
        }
      });

      map.on('mouseenter', 'pastures-fill', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'pastures-fill', () => {
        map.getCanvas().style.cursor = '';
      });
    });

    mapRef.current = map;
    drawRef.current = draw;

    return () => {
      map.remove();
      mapRef.current = null;
      drawRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  // Attach draw event listeners
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const onDrawCreate = (e: { features: GeoJSON.Feature[] }) => handleDrawCreate(e);
    map.on('draw.create', onDrawCreate);
    return () => {
      map.off('draw.create', onDrawCreate);
    };
  }, [handleDrawCreate]);

  // Toggle draw mode
  useEffect(() => {
    const draw = drawRef.current;
    if (!draw) return;

    if (drawingMode && selectedPastureId) {
      draw.changeMode('draw_polygon');
    } else {
      try {
        draw.changeMode('simple_select');
      } catch {
        // ignore if already in simple_select
      }
    }
  }, [drawingMode, selectedPastureId]);

  // Update pasture polygons on map
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const source = map.getSource('pastures') as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;

    const features: GeoJSON.Feature[] = currentBid.pastures
      .filter((p) => p.polygon.geometry.coordinates.length > 0)
      .map((p) => ({
        type: 'Feature',
        geometry: p.polygon.geometry,
        properties: {
          pastureId: p.id,
          name: p.name,
          acreageLabel: `${p.acreage} ac`,
          color: VEGETATION_COLORS[p.vegetationType] || '#22c55e',
          selected: p.id === selectedPastureId,
        },
      }));

    source.setData({ type: 'FeatureCollection', features });
  }, [currentBid.pastures, selectedPastureId]);

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainerRef} className="w-full h-full" />
      {drawingMode && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-amber-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm font-medium z-10">
          Click on the map to draw pasture boundary. Double-click to finish.
          <button
            onClick={() => {
              setDrawingMode(false);
              drawRef.current?.deleteAll();
              drawRef.current?.changeMode('simple_select');
            }}
            className="ml-3 underline hover:no-underline"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
