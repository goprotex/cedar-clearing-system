'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import 'mapbox-gl/dist/mapbox-gl.css';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import { calculateAcreage, getCentroid, getBBox } from '@/lib/geo';
import { useBidStore } from '@/lib/store';
import { TreeLayer3D, extractTreesFromAnalysis } from '@/lib/tree-layer';
import type { PastureWall } from '@/lib/tree-layer';

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

type LayerKey = 'soil' | 'naip' | 'naipCIR' | 'naipNDVI' | 'terrain3d' | 'cedarAI' | 'hologram';

export default function MapContainer({ accessToken }: MapContainerProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const lastFlyToPastureRef = useRef<string | null>(null);
  const preHoloLayersRef = useRef<Record<string, boolean> | null>(null);
  const rotationFrameRef = useRef<number | null>(null);
  const treeLayerRef = useRef<TreeLayer3D | null>(null);
  const [layersPanelOpen, setLayersPanelOpen] = useState(false);
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({
    soil: false,
    naip: false,
    naipCIR: false,
    naipNDVI: false,
    terrain3d: false,
    cedarAI: false,
    hologram: false,
  });
  const [opacities, setOpacities] = useState<Record<LayerKey, number>>({
    soil: 0.45,
    naip: 0.85,
    naipCIR: 0.85,
    naipNDVI: 0.75,
    terrain3d: 1.3, // terrain exaggeration (0.5–2.5)
    cedarAI: 0.7,
    hologram: 1.0,
  });

  const {
    currentBid,
    selectedPastureId,
    drawingMode,
    analysisProgress,
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

      if (feature.geometry.coordinates[0].length < 4) return;

      const acreage = calculateAcreage(feature);
      const centroid = getCentroid(feature);
      setPasturePolygon(selectedPastureId, feature, acreage, centroid);

      if (drawRef.current) {
        drawRef.current.deleteAll();
      }

      // Auto-enable hologram mode after drawing a pasture
      setLayers((prev) => {
        if (prev.hologram) return prev;
        const next = { ...prev };
        preHoloLayersRef.current = { naip: prev.naip, naipCIR: prev.naipCIR, naipNDVI: prev.naipNDVI, terrain3d: prev.terrain3d, cedarAI: prev.cedarAI };
        next.hologram = true;
        next.terrain3d = false;
        next.naip = false;
        next.naipCIR = false;
        next.naipNDVI = true;
        next.cedarAI = true;
        return next;
      });
      const map = mapRef.current;
      if (map) {
        map.easeTo({ pitch: 60, bearing: map.getBearing() || -20, duration: 1200 });
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
      preserveDrawingBuffer: true, // needed for screenshot capture
      antialias: true,
    });

    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: {},
      defaultMode: 'simple_select',
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    map.addControl(draw, 'top-right');

    map.on('load', () => {
      // ── DEM source (for 3D terrain) ──
      map.addSource('mapbox-dem', {
        type: 'raster-dem',
        url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
        tileSize: 512,
        maxzoom: 14,
      });

      // ── USDA SDA Soil map WMS overlay ──
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

      // ── NAIP Natural Color overlay (USGS ImageServer) ──
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

      // ── NAIP CIR (False Color Composite: NIR, Red, Green) ──
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

      // ── NAIP NDVI (Computed NDVI color) ──
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

      // ── Pasture polygons source ──
      map.addSource('pastures', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      // ── Hologram mask: black fill outside pasture polygons ──
      map.addSource('holo-mask', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'holo-mask-fill',
        type: 'fill',
        source: 'holo-mask',
        paint: {
          'fill-color': '#000000',
          'fill-opacity': 0.92,
        },
        layout: { visibility: 'none' },
      });

      // ── Cedar AI overlay source ──
      map.addSource('cedar-analysis', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      // 2D flat fill — works on all devices including mobile
      map.addLayer({
        id: 'cedar-flat',
        type: 'fill',
        source: 'cedar-analysis',
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.6,
        },
        layout: { visibility: 'none' },
      });

      // 3D extrusion — bonus layer for desktop
      map.addLayer({
        id: 'cedar-fill',
        type: 'fill-extrusion',
        source: 'cedar-analysis',
        paint: {
          'fill-extrusion-color': ['get', 'color'],
          'fill-extrusion-opacity': 0.7,
          'fill-extrusion-height': 2,
          'fill-extrusion-base': 0,
        },
        layout: { visibility: 'none' },
      });

      map.addLayer({
        id: 'cedar-border',
        type: 'line',
        source: 'cedar-analysis',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 0.5,
          'line-opacity': 0.5,
        },
        layout: { visibility: 'none' },
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

  // ── Toggle layer visibility + opacity ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const layerMap: Record<LayerKey, string> = {
      soil: 'soil-overlay',
      naip: 'naip-overlay',
      naipCIR: 'naip-cir-overlay',
      naipNDVI: 'naip-ndvi-overlay',
      terrain3d: '', // handled separately
      cedarAI: '',   // handled below (two layers)
      hologram: '',  // handled separately (3D tree layer)
    };

    // Toggle raster layers and set opacity
    for (const [key, layerId] of Object.entries(layerMap)) {
      if (!layerId) continue;
      const layer = map.getLayer(layerId);
      if (layer) {
        map.setLayoutProperty(
          layerId,
          'visibility',
          layers[key as LayerKey] ? 'visible' : 'none'
        );
        map.setPaintProperty(layerId, 'raster-opacity', opacities[key as LayerKey]);
      }
    }

    // Toggle cedar AI overlay (flat fill + extrusion + border)
    const cedarVisible = layers.cedarAI || layers.hologram;
    for (const cedarLayerId of ['cedar-flat', 'cedar-fill', 'cedar-border']) {
      const layer = map.getLayer(cedarLayerId);
      if (layer) {
        map.setLayoutProperty(cedarLayerId, 'visibility', cedarVisible ? 'visible' : 'none');
      }
    }

    // Hologram: bright green flat fill + optional extrusion + thick borders
    if (layers.hologram) {
      const holoColorExpr = [
        'match', ['get', 'classification'],
        'cedar', '#00ff41',
        'oak', '#ffaa00',
        'mixed_brush', '#22dd44',
        '#00ff41',
      ] as mapboxgl.Expression;

      if (map.getLayer('cedar-flat')) {
        map.setPaintProperty('cedar-flat', 'fill-color', holoColorExpr);
        map.setPaintProperty('cedar-flat', 'fill-opacity', 0.7);
      }
      if (map.getLayer('cedar-fill')) {
        map.setPaintProperty('cedar-fill', 'fill-extrusion-color', holoColorExpr);
        map.setPaintProperty('cedar-fill', 'fill-extrusion-opacity', 0.6);
        map.setPaintProperty('cedar-fill', 'fill-extrusion-height', 6);
      }
      if (map.getLayer('cedar-border')) {
        map.setPaintProperty('cedar-border', 'line-color', holoColorExpr);
        map.setPaintProperty('cedar-border', 'line-opacity', 0.9);
        map.setPaintProperty('cedar-border', 'line-width', 1.5);
      }
    } else {
      if (map.getLayer('cedar-flat')) {
        map.setPaintProperty('cedar-flat', 'fill-color', ['get', 'color']);
        map.setPaintProperty('cedar-flat', 'fill-opacity', opacities.cedarAI * 0.8);
      }
      if (map.getLayer('cedar-fill')) {
        map.setPaintProperty('cedar-fill', 'fill-extrusion-color', ['get', 'color']);
        map.setPaintProperty('cedar-fill', 'fill-extrusion-opacity', opacities.cedarAI);
        map.setPaintProperty('cedar-fill', 'fill-extrusion-height', 2);
      }
      if (map.getLayer('cedar-border')) {
        map.setPaintProperty('cedar-border', 'line-color', ['get', 'color']);
        map.setPaintProperty('cedar-border', 'line-opacity', 0.5);
        map.setPaintProperty('cedar-border', 'line-width', 0.5);
      }
    }

    // Toggle 3D terrain (disabled when hologram is on)
    if (layers.terrain3d && !layers.hologram) {
      map.setTerrain({ source: 'mapbox-dem', exaggeration: opacities.terrain3d });
      if (!map.getLayer('sky')) {
        map.addLayer({
          id: 'sky',
          type: 'sky',
          paint: {
            'sky-type': 'atmosphere',
            'sky-atmosphere-sun': [0.0, 90.0],
            'sky-atmosphere-sun-intensity': 15,
          },
        });
      }
    } else {
      map.setTerrain(null);
      if (map.getLayer('sky')) {
        map.removeLayer('sky');
      }
    }

    // ── Hologram mode ──
    if (layers.hologram) {
      // Build inverted mask: world polygon with pasture shapes as holes
      const maskSource = map.getSource('holo-mask') as mapboxgl.GeoJSONSource | undefined;
      if (maskSource) {
        const worldRing: [number, number][] = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
        const holes: [number, number][][] = currentBid.pastures
          .filter(p => p.polygon.geometry.coordinates.length > 0)
          .map(p => p.polygon.geometry.coordinates[0] as [number, number][]);

        if (holes.length > 0) {
          maskSource.setData({
            type: 'FeatureCollection',
            features: [{
              type: 'Feature',
              geometry: { type: 'Polygon', coordinates: [worldRing, ...holes] },
              properties: {},
            }],
          });
          map.setLayoutProperty('holo-mask-fill', 'visibility', 'visible');
        }
      }

      // Desaturate the satellite base map
      for (const bl of (map.getStyle().layers ?? [])) {
        if (bl.id.startsWith('satellite') || bl.id.includes('mapbox-satellite')) {
          try {
            map.setPaintProperty(bl.id, 'raster-saturation', -0.8);
            map.setPaintProperty(bl.id, 'raster-brightness-max', 0.35);
          } catch { /* not a raster layer */ }
        }
      }

      // Hide all road/label/poi/building layers so pasture floats in void
      for (const bl of (map.getStyle().layers ?? [])) {
        if (bl.id.includes('road') || bl.id.includes('label') || bl.id.includes('poi') ||
            bl.id.includes('building') || bl.id.includes('transit') || bl.id.includes('admin') ||
            bl.id.includes('place') || bl.id.includes('water-') || bl.id.includes('waterway') ||
            bl.id.includes('land-structure') || bl.id.includes('aeroway')) {
          try { map.setLayoutProperty(bl.id, 'visibility', 'none'); } catch {}
        }
      }

      // Force NDVI visible at 100%
      if (map.getLayer('naip-ndvi-overlay')) {
        map.setLayoutProperty('naip-ndvi-overlay', 'visibility', 'visible');
        map.setPaintProperty('naip-ndvi-overlay', 'raster-opacity', 1.0);
      }

      // Green pasture borders — glowing
      if (map.getLayer('pastures-border')) {
        map.setPaintProperty('pastures-border', 'line-color', '#00ff41');
        map.setPaintProperty('pastures-border', 'line-width', 3);
      }
      if (map.getLayer('pastures-fill')) {
        map.setPaintProperty('pastures-fill', 'fill-color', '#00ff41');
        map.setPaintProperty('pastures-fill', 'fill-opacity', 0.05);
      }
      if (map.getLayer('pastures-labels')) {
        map.setPaintProperty('pastures-labels', 'text-color', '#00ff41');
      }

      // ── 3D tree layer ──
      if (!treeLayerRef.current || !map.getLayer('3d-trees')) {
        if (treeLayerRef.current && !map.getLayer('3d-trees')) {
          treeLayerRef.current = null;
        }
        if (!treeLayerRef.current) {
          const treeLayer = new TreeLayer3D(currentBid.propertyCenter);
          treeLayerRef.current = treeLayer;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          map.addLayer(treeLayer as any);
        }
      }

      const tl = treeLayerRef.current;
      if (tl) {
        const trees = extractTreesFromAnalysis(currentBid.pastures);
        if (trees.length > 0) tl.updateTrees(trees);

        const walls: PastureWall[] = currentBid.pastures
          .filter(p => p.polygon.geometry.coordinates.length > 0)
          .map(p => ({
            id: p.id,
            coordinates: p.polygon.geometry.coordinates[0] as [number, number][],
            color: VEGETATION_COLORS[p.vegetationType] || '#22c55e',
          }));
        tl.updatePolygonWalls(walls);
      }

      // Start slow auto-rotation
      if (!rotationFrameRef.current) {
        const rotate = () => {
          if (!mapRef.current) return;
          const bearing = mapRef.current.getBearing() + 0.15;
          mapRef.current.setBearing(bearing);
          rotationFrameRef.current = requestAnimationFrame(rotate);
        };
        rotationFrameRef.current = requestAnimationFrame(rotate);
      }
    } else {
      // Stop rotation
      if (rotationFrameRef.current) {
        cancelAnimationFrame(rotationFrameRef.current);
        rotationFrameRef.current = null;
      }

      // Remove 3D tree layer
      if (treeLayerRef.current && map.getLayer('3d-trees')) {
        map.removeLayer('3d-trees');
        treeLayerRef.current = null;
      }

      // Hide mask
      if (map.getLayer('holo-mask-fill')) {
        map.setLayoutProperty('holo-mask-fill', 'visibility', 'none');
      }

      // Restore satellite base map
      for (const bl of (map.getStyle().layers ?? [])) {
        if (bl.id.startsWith('satellite') || bl.id.includes('mapbox-satellite')) {
          try {
            map.setPaintProperty(bl.id, 'raster-saturation', 0);
            map.setPaintProperty(bl.id, 'raster-brightness-max', 1);
          } catch { /* not a raster layer */ }
        }
      }

      // Restore road/label/poi layers
      for (const bl of (map.getStyle().layers ?? [])) {
        if (bl.id.includes('road') || bl.id.includes('label') || bl.id.includes('poi') ||
            bl.id.includes('building') || bl.id.includes('transit') || bl.id.includes('admin') ||
            bl.id.includes('place') || bl.id.includes('water-') || bl.id.includes('waterway') ||
            bl.id.includes('land-structure') || bl.id.includes('aeroway')) {
          try { map.setLayoutProperty(bl.id, 'visibility', 'visible'); } catch {}
        }
      }

      // Restore pasture colors
      if (map.getLayer('pastures-border')) {
        map.setPaintProperty('pastures-border', 'line-color', ['get', 'color']);
        map.setPaintProperty('pastures-border', 'line-width', [
          'case', ['boolean', ['get', 'selected'], false], 3, 2,
        ]);
      }
      if (map.getLayer('pastures-fill')) {
        map.setPaintProperty('pastures-fill', 'fill-color', ['get', 'color']);
        map.setPaintProperty('pastures-fill', 'fill-opacity', 0.25);
      }
      if (map.getLayer('pastures-labels')) {
        map.setPaintProperty('pastures-labels', 'text-color', '#ffffff');
      }
    }

  }, [layers, opacities, currentBid.pastures, currentBid.propertyCenter]);

  // Pause rotation on user interaction, resume after 3s idle
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layers.hologram) return;

    let resumeTimer: ReturnType<typeof setTimeout> | null = null;

    const pause = () => {
      if (rotationFrameRef.current) {
        cancelAnimationFrame(rotationFrameRef.current);
        rotationFrameRef.current = null;
      }
      if (resumeTimer) clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => {
        if (!mapRef.current || !rotationFrameRef.current) {
          const rotate = () => {
            if (!mapRef.current) return;
            mapRef.current.setBearing(mapRef.current.getBearing() + 0.15);
            rotationFrameRef.current = requestAnimationFrame(rotate);
          };
          rotationFrameRef.current = requestAnimationFrame(rotate);
        }
      }, 3000);
    };

    map.on('mousedown', pause);
    map.on('touchstart', pause);
    map.on('wheel', pause);

    return () => {
      map.off('mousedown', pause);
      map.off('touchstart', pause);
      map.off('wheel', pause);
      if (resumeTimer) clearTimeout(resumeTimer);
    };
  }, [layers.hologram]);

  // Clean up rotation on unmount
  useEffect(() => {
    return () => {
      if (rotationFrameRef.current) {
        cancelAnimationFrame(rotationFrameRef.current);
        rotationFrameRef.current = null;
      }
    };
  }, []);

  // Ensure NAIP layers are mutually exclusive (only one at a time)
  const toggleLayer = useCallback((key: LayerKey) => {
    setLayers((prev) => {
      const next = { ...prev };
      // NAIP variants are mutually exclusive
      if (key === 'naip' || key === 'naipCIR' || key === 'naipNDVI') {
        if (!prev[key]) {
          next.naip = false;
          next.naipCIR = false;
          next.naipNDVI = false;
        }
      }
      // Hologram: disable 3D terrain, switch to NDVI base map, keep cedar AI visible
      if (key === 'hologram' && !prev.hologram) {
        preHoloLayersRef.current = { naip: prev.naip, naipCIR: prev.naipCIR, naipNDVI: prev.naipNDVI, terrain3d: prev.terrain3d, cedarAI: prev.cedarAI };
        next.terrain3d = false;
        next.naip = false;
        next.naipCIR = false;
        next.naipNDVI = true;
        next.cedarAI = true;
        const map = mapRef.current;
        if (map) {
          map.easeTo({ pitch: 60, bearing: map.getBearing() || -20, duration: 1200 });
        }
      }
      // Block 3D terrain while hologram is active
      if (key === 'terrain3d' && prev.hologram) {
        return prev;
      }
      // Restore previous state when hologram turns off
      if (key === 'hologram' && prev.hologram) {
        const saved = preHoloLayersRef.current;
        if (saved) {
          next.naip = saved.naip;
          next.naipCIR = saved.naipCIR;
          next.naipNDVI = saved.naipNDVI;
          next.terrain3d = saved.terrain3d;
          next.cedarAI = saved.cedarAI;
          preHoloLayersRef.current = null;
        }
        const map = mapRef.current;
        if (map) {
          map.easeTo({ pitch: 0, bearing: 0, duration: 800 });
        }
      }
      next[key] = !prev[key];
      return next;
    });
  }, []);

  // Screenshot capture
  const captureScreenshot = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const canvas = map.getCanvas();
    const dataUrl = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `hologram-${currentBid.bidNumber}-${Date.now()}.png`;
    link.href = dataUrl;
    link.click();
  }, [currentBid.bidNumber]);

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

  // ── Sync cedar analysis overlay data ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const source = map.getSource('cedar-analysis') as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;

    const allFeatures: GeoJSON.Feature[] = [];
    for (const p of currentBid.pastures) {
      if (p.cedarAnalysis?.gridCells?.features) {
        for (const f of p.cedarAnalysis.gridCells.features) {
          const cls = f.properties?.classification;
          if (cls === 'cedar' || cls === 'oak' || cls === 'mixed_brush') {
            allFeatures.push(f);
          }
        }
      }
    }

    source.setData({ type: 'FeatureCollection', features: allFeatures });
  }, [currentBid.pastures]);


  // ── Fly to selected pasture when selection changes ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedPastureId) return;

    // Only fly when the selected pasture actually changes, not on data updates
    if (lastFlyToPastureRef.current === selectedPastureId) return;
    lastFlyToPastureRef.current = selectedPastureId;

    const pasture = currentBid.pastures.find((p) => p.id === selectedPastureId);
    if (!pasture || pasture.acreage === 0) return;

    // Only fly if polygon has coordinates
    if (pasture.polygon.geometry.coordinates.length === 0) return;

    const bbox = getBBox(pasture.polygon);
    map.fitBounds(
      [
        [bbox[0], bbox[1]],
        [bbox[2], bbox[3]],
      ],
      { padding: 80, maxZoom: 17, duration: 1000 }
    );
  }, [selectedPastureId, currentBid.pastures]);

  return (
    <div className={`relative w-full h-full ${layers.hologram ? 'hologram-mode' : ''}`}>
      <div ref={mapContainerRef} className="w-full h-full" />

      {/* Hologram scan-line overlay */}
      {layers.hologram && <div className="holo-scanlines" />}

      {/* Drawing mode banner */}
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

      {/* ── Layer control panel ── */}
      <div className="absolute bottom-4 left-4 z-10">
        {layersPanelOpen ? (
          <div className={`backdrop-blur rounded-lg shadow-lg p-2 min-w-[170px] ${layers.hologram ? 'holo-panel' : 'bg-slate-900/90'}`}>
            <div className="flex items-center justify-between px-1 pb-1">
              <span className={`text-[10px] font-semibold uppercase tracking-wider ${layers.hologram ? 'text-green-400' : 'text-slate-400'}`}>
                Layers
              </span>
              <button
                onClick={() => setLayersPanelOpen(false)}
                className="text-slate-400 hover:text-white text-xs leading-none"
                title="Collapse"
              >
                ✕
              </button>
            </div>

            <LayerRow
              label="🟫 Soil"
              active={layers.soil}
              opacity={opacities.soil}
              onToggle={() => toggleLayer('soil')}
              onOpacity={(v) => setOpacities((p) => ({ ...p, soil: v }))}
              holoMode={layers.hologram}
            />
            <LayerRow
              label="🛰️ RGB"
              active={layers.naip}
              opacity={opacities.naip}
              onToggle={() => toggleLayer('naip')}
              onOpacity={(v) => setOpacities((p) => ({ ...p, naip: v }))}
              holoMode={layers.hologram}
            />
            <LayerRow
              label="🔴 CIR"
              active={layers.naipCIR}
              opacity={opacities.naipCIR}
              onToggle={() => toggleLayer('naipCIR')}
              onOpacity={(v) => setOpacities((p) => ({ ...p, naipCIR: v }))}
              holoMode={layers.hologram}
            />
            <LayerRow
              label="🌿 NDVI"
              active={layers.naipNDVI}
              opacity={opacities.naipNDVI}
              onToggle={() => toggleLayer('naipNDVI')}
              onOpacity={(v) => setOpacities((p) => ({ ...p, naipNDVI: v }))}
              holoMode={layers.hologram}
            />

            <div className={`border-t my-1 ${layers.hologram ? 'border-green-800/50' : 'border-slate-700'}`} />

            <LayerRow
              label={layers.hologram ? '⛰️ 3D (off in hologram)' : '⛰️ 3D'}
              active={layers.terrain3d}
              opacity={opacities.terrain3d}
              opacityRange={[0.5, 2.5]}
              opacityStep={0.1}
              onToggle={() => toggleLayer('terrain3d')}
              onOpacity={(v) => setOpacities((p) => ({ ...p, terrain3d: v }))}
              disabled={layers.hologram}
              holoMode={layers.hologram}
            />

            <div className={`border-t my-1 ${layers.hologram ? 'border-green-800/50' : 'border-slate-700'}`} />

            <LayerRow
              label="🤖 AI Cedar"
              active={layers.cedarAI}
              opacity={opacities.cedarAI}
              onToggle={() => toggleLayer('cedarAI')}
              onOpacity={(v) => setOpacities((p) => ({ ...p, cedarAI: v }))}
              holoMode={layers.hologram}
            />

            <div className={`border-t my-1 ${layers.hologram ? 'border-cyan-800/50' : 'border-slate-700'}`} />

            {/* Hologram 3D toggle */}
            <LayerRow
              label="🔮 Hologram"
              active={layers.hologram}
              opacity={opacities.hologram}
              onToggle={() => toggleLayer('hologram')}
              onOpacity={(v) => setOpacities((p) => ({ ...p, hologram: v }))}
              holoMode={layers.hologram}
            />

          </div>
        ) : (
          <button
            onClick={() => setLayersPanelOpen(true)}
            className={`backdrop-blur rounded-lg shadow-lg px-3 py-2 text-xs font-medium transition-colors ${
              layers.hologram
                ? 'holo-panel text-green-300 hover:text-white'
                : 'bg-slate-900/90 text-slate-300 hover:text-white'
            }`}
          >
            Layers
          </button>
        )}
      </div>

      {/* Screenshot button (hologram mode) */}
      {layers.hologram && (
        <div className="absolute bottom-4 right-4 z-10 flex items-center gap-2">
          <button
            onClick={captureScreenshot}
            className="holo-button px-3 py-2 rounded-lg text-xs font-medium"
            title="Capture hologram screenshot"
          >
            📸 Capture
          </button>
        </div>
      )}

      {/* Hologram: no analysis data hint */}
      {layers.hologram && !currentBid.pastures.some(p => p.cedarAnalysis?.gridCells?.features?.length) && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-10 holo-panel px-4 py-2 rounded-lg shadow-lg text-xs text-green-300 max-w-xs text-center">
          🔮 No analysis data yet — draw a pasture to auto-run spectral analysis
        </div>
      )}

      {/* Analysis progress overlay */}
      {analysisProgress?.active && (
        <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
          <div className="bg-slate-900/90 backdrop-blur-sm border border-green-500/30 rounded-xl shadow-2xl px-8 py-6 max-w-sm text-center space-y-3 pointer-events-auto">
            {/* Spinner */}
            <div className="flex justify-center">
              <div className="w-10 h-10 border-3 border-green-500/30 border-t-green-400 rounded-full animate-spin" />
            </div>
            {/* Step */}
            <div className="text-green-300 font-semibold text-sm">
              {analysisProgress.step}
            </div>
            {/* Detail */}
            <div className="text-slate-400 text-xs leading-relaxed">
              {analysisProgress.detail}
            </div>
            {/* Pulse bar */}
            <div className="w-full h-1 bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-green-500 to-emerald-400 rounded-full animate-pulse" style={{ width: '100%' }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LayerRow({
  label,
  active,
  opacity,
  opacityRange = [0, 1],
  opacityStep = 0.05,
  onToggle,
  onOpacity,
  holoMode = false,
  disabled = false,
}: {
  label: string;
  active: boolean;
  opacity: number;
  opacityRange?: [number, number];
  opacityStep?: number;
  onToggle: () => void;
  onOpacity: (v: number) => void;
  holoMode?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-0.5">
      <button
        onClick={disabled ? undefined : onToggle}
        className={`w-full text-left px-2 py-1 rounded text-xs font-medium transition-all duration-200 ${
          disabled
            ? 'text-slate-500 cursor-not-allowed opacity-50'
            : active
              ? holoMode
                ? 'bg-green-700/60 text-green-100 shadow-[0_0_8px_rgba(0,255,65,0.3)]'
                : 'bg-amber-600 text-white'
              : holoMode
                ? 'text-green-300/70 hover:bg-green-900/40 hover:text-green-200'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
        }`}
      >
        {label}
        {active && !disabled && <span className="float-right text-[10px] opacity-75">ON</span>}
      </button>
      {active && (
        <div className="flex items-center gap-1.5 px-2 pb-0.5">
          <input
            type="range"
            min={opacityRange[0]}
            max={opacityRange[1]}
            step={opacityStep}
            value={opacity}
            onChange={(e) => onOpacity(parseFloat(e.target.value))}
            className={`w-full h-1 cursor-pointer ${holoMode ? 'accent-green-400' : 'accent-amber-500'}`}
          />
          <span className={`text-[9px] w-7 text-right tabular-nums ${holoMode ? 'text-green-500' : 'text-slate-400'}`}>
            {Math.round((opacity / opacityRange[1]) * 100)}%
          </span>
        </div>
      )}
    </div>
  );
}

