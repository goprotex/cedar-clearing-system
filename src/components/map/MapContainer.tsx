'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import 'mapbox-gl/dist/mapbox-gl.css';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import { calculateAcreage, getCentroid, getBBox } from '@/lib/geo';
import { useBidStore } from '@/lib/store';
import { HologramMapboxLayers, extractTreesFromAnalysis } from '@/lib/hologram-mapbox';
import DrawPolygonMobile, { finishDrawing } from '@/lib/draw-polygon-mobile';
import type { PastureWall } from '@/lib/cedar-tree-data';
import type { MarkedTree } from '@/types';
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

/** Default property center used in new bids — must match createDefaultBid() in store.ts */
const DEFAULT_CENTER: [number, number] = [-99.1403, 30.0469];
/** ~111 m tolerance at the equator for matching default center */
const COORDINATE_TOLERANCE = 0.001;
const GEOLOCATION_TIMEOUT_MS = 8000;
const GEOLOCATION_MAX_AGE_MS = 60000;

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
type Species = 'cedar' | 'oak' | 'mixed';

function getAnalysisViewLayers(phase?: string): Record<LayerKey, boolean> {
  switch (phase) {
    case 'sampling':
    case 'grid':
    case 'indices':
    case 'classify':
      return {
        soil: false,
        naip: false,
        naipCIR: true,
        naipNDVI: false,
        terrain3d: false,
        cedarAI: false,
        hologram: false,
      };
    case 'hires':
    case 'refining':
      return {
        soil: false,
        naip: true,
        naipCIR: false,
        naipNDVI: false,
        terrain3d: false,
        cedarAI: false,
        hologram: false,
      };
    case 'sentinel':
    case 'consensus':
      return {
        soil: false,
        naip: false,
        naipCIR: false,
        naipNDVI: true,
        terrain3d: false,
        cedarAI: false,
        hologram: false,
      };
    case 'building':
    case 'applying':
    case 'trees':
      return {
        soil: false,
        naip: true,
        naipCIR: false,
        naipNDVI: false,
        terrain3d: false,
        cedarAI: true,
        hologram: false,
      };
    default:
      return {
        soil: false,
        naip: true,
        naipCIR: false,
        naipNDVI: false,
        terrain3d: false,
        cedarAI: false,
        hologram: false,
      };
  }
}

export default function MapContainer({ accessToken }: MapContainerProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const [mapStyleLoaded, setMapStyleLoaded] = useState(false);
  const lastFlyToPastureRef = useRef<string | null>(null);
  const lastAnalysisFocusRef = useRef<string | null>(null);
  const lastCinematicAnalysisRef = useRef<string | null>(null);
  const preHoloLayersRef = useRef<Record<string, boolean> | null>(null);
  const preAnalysisLayersRef = useRef<Record<LayerKey, boolean> | null>(null);
  const rotationFrameRef = useRef<number | null>(null);
  const treeLayerRef = useRef<HologramMapboxLayers | null>(null);
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

  const [overlayLayers, setOverlayLayers] = useState<Record<OverlayLayerKey, boolean>>(defaultOverlayState);
  const [overlayOpacities, setOverlayOpacities] = useState<Record<OverlayLayerKey, number>>(defaultOverlayOpacities);
  const overlayActiveCount = useOverlayActiveCount(overlayLayers);

  const [speciesVisible, setSpeciesVisible] = useState<Record<Species, boolean>>({
    cedar: true, oak: true, mixed: true,
  });
  const [markMode, setMarkMode] = useState<'save' | 'remove' | null>(null);
  const [autoRotate, setAutoRotate] = useState(false);
  const autoRotateRef = useRef(autoRotate);
  autoRotateRef.current = autoRotate;
  const [drawVertexCount, setDrawVertexCount] = useState(0);

  const {
    currentBid,
    selectedPastureId,
    drawingMode,
    analysisProgress,
    setPasturePolygon,
    setDrawingMode,
    selectPasture,
    markTree,
    unmarkTree,
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
      setDrawVertexCount(0);

      if (drawRef.current) {
        drawRef.current.deleteAll();
      }
    },
    [selectedPastureId, setPasturePolygon]
  );

  // Finish drawing via explicit button press (mobile-friendly)
  const handleFinishDrawing = useCallback(() => {
    const draw = drawRef.current;
    if (!draw || !selectedPastureId) return;

    const feature = finishDrawing(draw);
    if (feature) {
      const acreage = calculateAcreage(feature);
      const centroid = getCentroid(feature);
      setPasturePolygon(selectedPastureId, feature, acreage, centroid);
    }
    setDrawVertexCount(0);
  }, [selectedPastureId, setPasturePolygon]);

  // Undo the last drawn vertex
  const handleUndoVertex = useCallback(() => {
    const draw = drawRef.current;
    if (!draw) return;
    // MapboxDraw supports Undo via trash for the last vertex in draw_polygon
    // We can use the internal API: trigger backspace key or use trash
    try {
      // The draw_polygon mode listens for "Escape" and "Enter" key events,
      // and the trash method removes the last vertex when in draw mode
      draw.trash();
      // Update vertex count
      const all = draw.getAll();
      if (all.features.length > 0) {
        const feat = all.features[0] as GeoJSON.Feature<GeoJSON.Polygon>;
        const coords = feat.geometry?.coordinates?.[0] ?? [];
        // In draw_polygon, coords includes the in-progress closing point
        setDrawVertexCount(Math.max(0, coords.length - 1));
      } else {
        setDrawVertexCount(0);
      }
    } catch {
      // Ignore errors from trash when nothing to undo
    }
  }, []);

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
      modes: {
        ...MapboxDraw.modes,
        draw_polygon: DrawPolygonMobile as unknown as MapboxDraw.DrawCustomMode,
      },
      // Increase touch buffer so taps aren't misinterpreted
      touchBuffer: 30,
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    map.addControl(draw, 'top-right');

    map.on('load', () => {
      setMapStyleLoaded(true);

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

      // ── ESRI World Imagery (sub-meter for TX, sourced from TNRIS StratMap) ──
      // XYZ tile cache — no CORS issues, no bbox params needed
      map.addSource('naip-rgb', {
        type: 'raster',
        tiles: [
          'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        ],
        tileSize: 256,
        attribution: 'Esri, DigitalGlobe, GeoEye, i-cubed, USDA FSA, USGS, AEX, Getmapping, Aerogrid, IGN, IGP, swisstopo, and the GIS User Community',
      });

      map.addLayer({
        id: 'naip-overlay',
        type: 'raster',
        source: 'naip-rgb',
        paint: { 'raster-opacity': 0.85 },
        layout: { visibility: 'none' },
      });

      // ── USGS NAIP CIR (Color Infrared / False Color — highlights live vegetation) ──
      map.addSource('naip-cir', {
        type: 'raster',
        tiles: [
          'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png&bandIds=3,0,1&f=image',
        ],
        tileSize: 256,
        attribution: 'USDA Farm Service Agency',
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
          'text-field': ['concat', ['get', 'mapLabel'], '\n', ['get', 'acreageLabel']],
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

      // ── Add all overlay raster sources & layers ──
      addOverlaySourcesToMap(map);
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

  // ── Fly to user's GPS location for new bids with default center ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Only geolocate if the bid still has the default center (no pastures drawn yet)
    const [lng, lat] = currentBid.propertyCenter;
    const isDefault =
      Math.abs(lng - DEFAULT_CENTER[0]) < COORDINATE_TOLERANCE &&
      Math.abs(lat - DEFAULT_CENTER[1]) < COORDINATE_TOLERANCE;
    if (!isDefault || currentBid.pastures.length > 0) return;

    if (!navigator.geolocation) return;

    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled || !mapRef.current) return;
        mapRef.current.flyTo({
          center: [pos.coords.longitude, pos.coords.latitude],
          zoom: 14,
          duration: 1500,
        });
      },
      () => {
        // Geolocation denied or unavailable — stay on default center
      },
      { enableHighAccuracy: true, timeout: GEOLOCATION_TIMEOUT_MS, maximumAge: GEOLOCATION_MAX_AGE_MS },
    );
    return () => { cancelled = true; };
    // Only run once on mount — don't re-trigger on bid data changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Toggle layer visibility + opacity ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapStyleLoaded) return;

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
    const cedarVisible = layers.cedarAI;
    for (const cedarLayerId of ['cedar-flat', 'cedar-fill', 'cedar-border']) {
      const layer = map.getLayer(cedarLayerId);
      if (layer) {
        map.setLayoutProperty(cedarLayerId, 'visibility', cedarVisible ? 'visible' : 'none');
      }
    }

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

    // Toggle 3D terrain. Hologram trees use terrain-aligned Mapbox extrusions, so terrain stays on.
    if (layers.terrain3d || layers.hologram) {
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

      // NDVI: respect user toggle, default to ON in hologram mode
      if (map.getLayer('naip-ndvi-overlay')) {
        map.setLayoutProperty('naip-ndvi-overlay', 'visibility', layers.naipNDVI ? 'visible' : 'none');
        if (layers.naipNDVI) {
          map.setPaintProperty('naip-ndvi-overlay', 'raster-opacity', 1.0);
        }
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

      // Mapbox fill-extrusion trees on terrain (no Three.js custom layer)
      if (!treeLayerRef.current) {
        treeLayerRef.current = new HologramMapboxLayers(map);
      }

      const tl = treeLayerRef.current;
      const trees = extractTreesFromAnalysis(currentBid.pastures);
      tl.updateTrees(trees);

      const walls: PastureWall[] = currentBid.pastures
        .filter((p) => p.polygon.geometry.coordinates.length > 0)
        .map((p) => ({
          id: p.id,
          coordinates: p.polygon.geometry.coordinates[0] as [number, number][],
          color: VEGETATION_COLORS[p.vegetationType] || '#22c55e',
        }));
      tl.updatePolygonWalls(walls);

      for (const sp of ['cedar', 'oak', 'mixed'] as Species[]) {
        tl.setSpeciesVisible(sp, speciesVisible[sp]);
      }

      // Keep the hologram framing layers above the terrain-aligned tree shells.
      for (const layerId of ['holo-mask-fill', 'pastures-fill', 'pastures-border', 'pastures-labels']) {
        if (map.getLayer(layerId)) {
          map.moveLayer(layerId);
        }
      }

      // Rotation is now opt-in via the autoRotate button; don't auto-start it here
    } else {
      // Stop rotation
      if (rotationFrameRef.current) {
        cancelAnimationFrame(rotationFrameRef.current);
        rotationFrameRef.current = null;
      }

      if (treeLayerRef.current) {
        treeLayerRef.current.remove();
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

  }, [layers, opacities, speciesVisible, currentBid.pastures, currentBid.propertyCenter, mapStyleLoaded]);

  // ── Sync overlay layers visibility + opacity ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapStyleLoaded) return;
    syncOverlayVisibility(map, overlayLayers, overlayOpacities);
  }, [overlayLayers, overlayOpacities, mapStyleLoaded]);

  // Auto-rotation: only spin when autoRotate is enabled; disables zoom/pan when active.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!autoRotate) {
      if (rotationFrameRef.current) {
        cancelAnimationFrame(rotationFrameRef.current);
        rotationFrameRef.current = null;
      }
      try { map.scrollZoom.enable(); } catch { /* ignore */ }
      try { map.dragPan.enable(); } catch { /* ignore */ }
      try { map.touchZoomRotate.enable(); } catch { /* ignore */ }
      return;
    }

    // Disable pan/zoom while auto-rotating
    try { map.scrollZoom.disable(); } catch { /* ignore */ }
    try { map.dragPan.disable(); } catch { /* ignore */ }
    try { map.touchZoomRotate.disable(); } catch { /* ignore */ }

    let alive = true;

    const startSpin = () => {
      if (!alive || rotationFrameRef.current || !autoRotateRef.current) return;
      const rotate = () => {
        if (!alive || !mapRef.current || !autoRotateRef.current) return;
        mapRef.current.setBearing(mapRef.current.getBearing() + 0.0375);
        rotationFrameRef.current = requestAnimationFrame(rotate);
      };
      rotationFrameRef.current = requestAnimationFrame(rotate);
    };

    startSpin();

    return () => {
      alive = false;
      if (rotationFrameRef.current) {
        cancelAnimationFrame(rotationFrameRef.current);
        rotationFrameRef.current = null;
      }
    };
  }, [autoRotate]);

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
      // Hologram: switch to the terrain + NDVI cinematic state and hide the AI grid.
      if (key === 'hologram' && !prev.hologram) {
        preHoloLayersRef.current = {
          soil: prev.soil,
          naip: prev.naip,
          naipCIR: prev.naipCIR,
          naipNDVI: prev.naipNDVI,
          terrain3d: prev.terrain3d,
          cedarAI: prev.cedarAI,
        };
        next.soil = true;
        next.terrain3d = true;
        next.naip = false;
        next.naipCIR = false;
        next.naipNDVI = true;
        next.cedarAI = false;
        const map = mapRef.current;
        if (map) {
          map.easeTo({ pitch: 45, bearing: map.getBearing() || -20, duration: 1200 });
        }
      }
      // Restore previous state when hologram turns off
      if (key === 'hologram' && prev.hologram) {
        const saved = preHoloLayersRef.current;
        if (saved) {
          next.soil = saved.soil;
          next.naip = saved.naip;
          next.naipCIR = saved.naipCIR;
          next.naipNDVI = saved.naipNDVI;
          next.terrain3d = saved.terrain3d;
          next.cedarAI = saved.cedarAI;
          preHoloLayersRef.current = null;
        }
        setAutoRotate(false);
        const map = mapRef.current;
        if (map) {
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
    // Track vertex count while drawing (for the "Finish" button)
    const onDrawUpdate = () => {
      const draw = drawRef.current;
      if (!draw) return;
      const all = draw.getAll();
      if (all.features.length > 0) {
        const feat = all.features[0] as GeoJSON.Feature<GeoJSON.Polygon>;
        const coords = feat.geometry?.coordinates?.[0] ?? [];
        // In draw_polygon mode, coords includes the auto-closing point
        setDrawVertexCount(Math.max(0, coords.length - 1));
      }
    };
    map.on('draw.create', onDrawCreate);
    map.on('draw.update', onDrawUpdate);
    map.on('draw.render', onDrawUpdate);
    return () => {
      map.off('draw.create', onDrawCreate);
      map.off('draw.update', onDrawUpdate);
      map.off('draw.render', onDrawUpdate);
    };
  }, [handleDrawCreate]);

  // Toggle draw mode
  useEffect(() => {
    const draw = drawRef.current;
    if (!draw) return;

    if (drawingMode && selectedPastureId) {
      draw.changeMode('draw_polygon');
      setDrawVertexCount(0);
    } else {
      try {
        draw.changeMode('simple_select');
      } catch {
        // ignore if already in simple_select
      }
      setDrawVertexCount(0);
    }
  }, [drawingMode, selectedPastureId]);

  // Update pasture polygons on map
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapStyleLoaded) return;

    const source = map.getSource('pastures') as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;

    const clientLast = (currentBid.clientName || '').trim().split(/\s+/).pop() || '';

    const features: GeoJSON.Feature[] = currentBid.pastures
      .filter((p) => p.polygon.geometry.coordinates.length > 0)
      .map((p) => ({
        type: 'Feature',
        geometry: p.polygon.geometry,
        properties: {
          pastureId: p.id,
          name: p.name,
          mapLabel: clientLast || p.name,
          acreageLabel: `${p.acreage} ac`,
          color: VEGETATION_COLORS[p.vegetationType] || '#22c55e',
          selected: p.id === selectedPastureId,
        },
      }));

    source.setData({ type: 'FeatureCollection', features });
  }, [currentBid.pastures, currentBid.clientName, selectedPastureId]);

  // ── Sync cedar analysis overlay data ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapStyleLoaded) return;

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


  // ── Tree marking click handler ──
  useEffect(() => {
    const map = mapRef.current;
    const tl = treeLayerRef.current;
    if (!map || !tl || !markMode || !layers.hologram || !selectedPastureId) return;

    const onClick = (e: mapboxgl.MapMouseEvent) => {
      const nearest = tl.findNearestTree(e.lngLat.lng, e.lngLat.lat, 25);
      if (!nearest) return;

      const pasture = currentBid.pastures.find((p) => p.id === selectedPastureId);
      if (!pasture) return;

      const existing = (pasture.savedTrees ?? []).find(
        (t) => Math.abs(t.lng - nearest.lng) < 0.00001 && Math.abs(t.lat - nearest.lat) < 0.00001
      );

      if (existing) {
        if (existing.action === markMode) {
          unmarkTree(selectedPastureId, existing.id);
        } else {
          unmarkTree(selectedPastureId, existing.id);
          const tree: MarkedTree = {
            id: `tree-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            lng: nearest.lng, lat: nearest.lat, species: nearest.species,
            action: markMode,
            label: markMode === 'save' ? `Save ${nearest.species}` : `Remove ${nearest.species}`,
            height: nearest.height, canopyDiameter: nearest.canopyDiameter,
          };
          markTree(selectedPastureId, tree);
        }
      } else {
        const tree: MarkedTree = {
          id: `tree-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          lng: nearest.lng, lat: nearest.lat, species: nearest.species,
          action: markMode,
          label: markMode === 'save' ? `Save ${nearest.species}` : `Remove ${nearest.species}`,
          height: nearest.height, canopyDiameter: nearest.canopyDiameter,
        };
        markTree(selectedPastureId, tree);
      }
    };

    map.on('click', onClick);
    map.getCanvas().style.cursor = markMode === 'save' ? 'cell' : 'crosshair';

    return () => {
      map.off('click', onClick);
      map.getCanvas().style.cursor = '';
    };
  }, [markMode, layers.hologram, selectedPastureId, currentBid.pastures, markTree, unmarkTree]);

  // ── Sync marked trees to 3D layer ──
  useEffect(() => {
    const tl = treeLayerRef.current;
    if (!tl || !layers.hologram) return;

    const allMarked = markMode
      ? currentBid.pastures.flatMap((p) => p.savedTrees ?? [])
      : [];
    tl.updateMarkedTrees(allMarked);
  }, [currentBid.pastures, layers.hologram, markMode]);

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

  // ── Follow the region currently being processed during spectral analysis ──
  useEffect(() => {
    const map = mapRef.current;
    const focusBbox = analysisProgress?.focusBbox;
    const focusKey = analysisProgress?.focusKey;
    if (!map || !focusBbox || !focusKey || !analysisProgress?.active) return;
    if (lastAnalysisFocusRef.current === focusKey) return;

    lastAnalysisFocusRef.current = focusKey;
    map.fitBounds(
      [
        [focusBbox[0], focusBbox[1]],
        [focusBbox[2], focusBbox[3]],
      ],
      {
        padding: { top: 110, right: 80, bottom: 110, left: 80 },
        maxZoom: analysisProgress.phase === 'sampling' ? 18 : 17,
        duration: 900,
        essential: true,
      },
    );
  }, [analysisProgress?.active, analysisProgress?.focusBbox, analysisProgress?.focusKey, analysisProgress?.phase]);

  // ── Temporarily switch imagery while analysis is running so the map matches the active pass ──
  useEffect(() => {
    if (!analysisProgress?.active) {
      if (preAnalysisLayersRef.current) {
        if (!layers.hologram) {
          setLayers((prev) => {
            const saved = preAnalysisLayersRef.current;
            if (!saved) return prev;
            const same = (Object.keys(saved) as LayerKey[]).every((key) => prev[key] === saved[key]);
            return same ? prev : { ...prev, ...saved };
          });
        }
        preAnalysisLayersRef.current = null;
      }
      return;
    }

    if (analysisProgress.phase === 'done' || analysisProgress.phase === 'error') {
      return;
    }

    if (!preAnalysisLayersRef.current) {
      preAnalysisLayersRef.current = { ...layers };
    }

    const desired = getAnalysisViewLayers(analysisProgress.phase);
    setLayers((prev) => {
      if (prev.hologram) return prev;
      const same = (Object.keys(desired) as LayerKey[]).every((key) => prev[key] === desired[key]);
      return same ? prev : desired;
    });
  }, [analysisProgress?.active, analysisProgress?.phase, layers]);

  // ── Auto-enter cinematic terrain/hologram mode after spectral analysis completes ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || analysisProgress?.phase !== 'done' || !analysisProgress.active) return;

    const cinematicKey = `${analysisProgress.startedAt ?? 0}-${analysisProgress.focusKey ?? 'pasture'}`;
    if (lastCinematicAnalysisRef.current === cinematicKey) return;
    lastCinematicAnalysisRef.current = cinematicKey;

    setLayers((prev) => {
      if (prev.hologram && prev.terrain3d && prev.soil && prev.naipNDVI && !prev.cedarAI) {
        return prev;
      }

      if (!prev.hologram) {
        preHoloLayersRef.current = {
          soil: prev.soil,
          naip: prev.naip,
          naipCIR: prev.naipCIR,
          naipNDVI: prev.naipNDVI,
          terrain3d: prev.terrain3d,
          cedarAI: prev.cedarAI,
        };
      }

      return {
        ...prev,
        soil: true,
        terrain3d: true,
        naip: false,
        naipCIR: false,
        naipNDVI: true,
        cedarAI: false,
        hologram: true,
      };
    });

    setAutoRotate(true);
    window.setTimeout(() => {
      if (!mapRef.current) return;
      mapRef.current.easeTo({ pitch: 45, bearing: mapRef.current.getBearing() || -20, duration: 1600 });
    }, 60);
  }, [analysisProgress?.active, analysisProgress?.phase, analysisProgress?.startedAt, analysisProgress?.focusKey]);

  return (
    <div className={`relative w-full h-full ${layers.hologram ? 'hologram-mode' : ''}`}>
      <div ref={mapContainerRef} className="w-full h-full" />

      {/* Hologram scan-line overlay */}
      {layers.hologram && <div className="holo-scanlines" />}

      {/* Drawing mode banner */}
      {drawingMode && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-amber-600 text-white px-3 sm:px-4 py-2 rounded-lg shadow-lg text-sm font-medium z-10 max-w-[95vw]">
          <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3 text-center sm:text-left">
            <span className="text-xs sm:text-sm">
              Tap to place points.{' '}
              <span className="hidden sm:inline">Double-click to finish. </span>
              {drawVertexCount > 0 && (
                <span className="font-bold">{drawVertexCount} {drawVertexCount === 1 ? 'point' : 'points'}</span>
              )}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              {drawVertexCount > 0 && (
                <button
                  onClick={handleUndoVertex}
                  className="px-2 py-1 bg-amber-700 hover:bg-amber-800 rounded text-xs font-bold uppercase tracking-wide transition-colors touch-manipulation"
                >
                  Undo
                </button>
              )}
              {drawVertexCount >= 3 && (
                <button
                  onClick={handleFinishDrawing}
                  className="px-3 py-1 bg-white text-amber-700 hover:bg-amber-100 rounded text-xs font-black uppercase tracking-wide transition-colors touch-manipulation"
                >
                  ✓ Finish
                </button>
              )}
              <button
                onClick={() => {
                  setDrawingMode(false);
                  setDrawVertexCount(0);
                  drawRef.current?.deleteAll();
                  drawRef.current?.changeMode('simple_select');
                }}
                className="px-2 py-1 underline hover:no-underline text-xs touch-manipulation"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Layer control panel ── */}
      <div className="absolute bottom-4 left-4 z-10">
        {layersPanelOpen ? (
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
                layers: [
                  { key: 'soil', label: 'Soil Map', emoji: '🟫', active: layers.soil, opacity: opacities.soil, onToggle: () => toggleLayer('soil'), onOpacity: (v) => setOpacities((p) => ({ ...p, soil: v })) },
                  { key: 'naip', label: 'RGB (Hi-Res)', emoji: '🛰️', active: layers.naip, opacity: opacities.naip, onToggle: () => toggleLayer('naip'), onOpacity: (v) => setOpacities((p) => ({ ...p, naip: v })) },
                  { key: 'naipCIR', label: 'CIR (False Color)', emoji: '🔴', active: layers.naipCIR, opacity: opacities.naipCIR, onToggle: () => toggleLayer('naipCIR'), onOpacity: (v) => setOpacities((p) => ({ ...p, naipCIR: v })) },
                  { key: 'naipNDVI', label: 'NDVI', emoji: '🌿', active: layers.naipNDVI, opacity: opacities.naipNDVI, onToggle: () => toggleLayer('naipNDVI'), onOpacity: (v) => setOpacities((p) => ({ ...p, naipNDVI: v })) },
                ],
              },
              {
                category: 'analysis',
                label: 'Analysis',
                emoji: '🔬',
                layers: [
                  { key: 'terrain3d', label: '3D Terrain', emoji: '⛰️', active: layers.terrain3d, opacity: opacities.terrain3d, opacityRange: [0.5, 2.5] as [number, number], opacityStep: 0.1, onToggle: () => toggleLayer('terrain3d'), onOpacity: (v) => setOpacities((p) => ({ ...p, terrain3d: v })) },
                  { key: 'hologram', label: 'Hologram', emoji: '🔮', active: layers.hologram, opacity: opacities.hologram, onToggle: () => toggleLayer('hologram'), onOpacity: (v) => setOpacities((p) => ({ ...p, hologram: v })) },
                ],
              },
            ]}
          >
            {/* Species filters (only show when hologram is active) */}
            {layers.hologram && (
              <div className="px-2 pb-2 pt-1 border-t border-green-800/50">
                <span className="text-[9px] text-green-500 uppercase tracking-wider px-1 font-semibold">
                  Species
                </span>
                <SpeciesToggle label="Cedar" color="#00ff41" active={speciesVisible.cedar} onToggle={() => setSpeciesVisible(v => ({ ...v, cedar: !v.cedar }))} />
                <SpeciesToggle label="Oak" color="#ffaa00" active={speciesVisible.oak} onToggle={() => setSpeciesVisible(v => ({ ...v, oak: !v.oak }))} />
                <SpeciesToggle label="Mixed" color="#22dd44" active={speciesVisible.mixed} onToggle={() => setSpeciesVisible(v => ({ ...v, mixed: !v.mixed }))} />
              </div>
            )}
          </MapLayerPanel>
        ) : (
          <button
            onClick={() => setLayersPanelOpen(true)}
            className={`backdrop-blur rounded-lg shadow-lg px-3 py-2 text-xs font-medium transition-colors ${
              layers.hologram
                ? 'holo-panel text-green-300 hover:text-white'
                : 'bg-slate-900/90 text-slate-300 hover:text-white'
            }`}
          >
            Layers{overlayActiveCount > 0 && ` (${overlayActiveCount})`}
          </button>
        )}
      </div>

      {/* Auto-rotate button (top-right) */}
      <div className="absolute top-4 right-4 z-10">
        <button
          onClick={() => setAutoRotate(v => !v)}
          className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
            autoRotate
              ? layers.hologram
                ? 'bg-orange-500/80 text-white shadow-[0_0_12px_rgba(255,107,0,0.5)]'
                : 'bg-orange-600 text-white shadow-md'
              : layers.hologram
                ? 'holo-button'
                : 'backdrop-blur bg-slate-900/90 text-slate-300 hover:text-white shadow-lg'
          }`}
          title={autoRotate ? 'Auto-rotation ON (zoom/pan disabled) — click to stop' : 'Start auto-rotation (disables zoom/pan)'}
        >
          🔄 {autoRotate ? 'Rotate ON' : 'Rotate'}
        </button>
      </div>

      {/* Hologram controls (bottom-right) */}
      {layers.hologram && (
        <div className="absolute bottom-4 right-4 z-10 flex items-center gap-2">
          <button
            onClick={() => setMarkMode(markMode === 'save' ? null : 'save')}
            className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
              markMode === 'save'
                ? 'bg-green-500/80 text-white shadow-[0_0_12px_rgba(0,255,68,0.5)]'
                : 'holo-button'
            }`}
            title="Mark trees to SAVE (click on trees)"
          >
            🛡️ Save
          </button>
          <button
            onClick={() => setMarkMode(markMode === 'remove' ? null : 'remove')}
            className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
              markMode === 'remove'
                ? 'bg-red-500/80 text-white shadow-[0_0_12px_rgba(255,34,68,0.5)]'
                : 'holo-button'
            }`}
            title="Mark trees to REMOVE (click on trees)"
          >
            ✂️ Remove
          </button>
          <button
            onClick={captureScreenshot}
            className="holo-button px-3 py-2 rounded-lg text-xs font-medium"
            title="Capture hologram screenshot"
          >
            📸 Capture
          </button>
        </div>
      )}

      {/* Mark mode banner */}
      {markMode && layers.hologram && (
        <div className={`absolute top-4 left-1/2 -translate-x-1/2 z-10 px-4 py-2 rounded-lg shadow-lg text-sm font-medium ${
          markMode === 'save'
            ? 'bg-green-600/90 text-white shadow-[0_0_20px_rgba(0,255,68,0.3)]'
            : 'bg-red-600/90 text-white shadow-[0_0_20px_rgba(255,34,68,0.3)]'
        }`}>
          {markMode === 'save' ? '🛡️ Click trees to SAVE' : '✂️ Click trees to REMOVE'}
          <button
            onClick={() => setMarkMode(null)}
            className="ml-3 underline hover:no-underline"
          >
            Done
          </button>
        </div>
      )}

      {/* Hologram: no analysis data hint */}
      {layers.hologram && !currentBid.pastures.some(p => p.cedarAnalysis?.gridCells?.features?.length) && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-10 holo-panel px-4 py-2 rounded-lg shadow-lg text-xs text-green-300 max-w-xs text-center">
          🔮 No analysis data yet — draw a pasture to auto-run spectral analysis
        </div>
      )}

      {/* Apple Glass–style analysis progress overlay */}
      {analysisProgress?.active && (() => {
        const progressPct = analysisProgress.percent ?? analysisProgress.pct;
        const elapsedSec = analysisProgress.startedAt
          ? Math.max(0, Math.round((Date.now() - analysisProgress.startedAt) / 1000))
          : null;
        const phaseCode =
          analysisProgress.phase === 'soil' ? 'SOIL_DATA' :
          analysisProgress.phase === 'elevation' ? 'ELEVATION' :
          analysisProgress.phase === 'grid' ? 'GRID' :
          analysisProgress.phase === 'sampling' ? 'SPECTRAL_SCAN' :
          analysisProgress.phase === 'consensus' ? 'TILE_CONSENSUS' :
          analysisProgress.phase === 'sentinel' ? 'S2_FUSION' :
          analysisProgress.phase === 'building' ? 'BUILD_GRID' :
          analysisProgress.phase === 'applying' ? 'APPLY_MAP' :
          analysisProgress.phase === 'trees' ? 'TREES_3D' :
          analysisProgress.phase === 'retry' ? 'RETRY' :
          analysisProgress.phase === 'error' ? 'ERROR' :
          analysisProgress.phase === 'done' ? 'COMPLETE' :
          analysisProgress.phase === 'init' ? 'START' : 'INITIALIZING';
        return (
        <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
          <div className="w-[340px] backdrop-blur-xl bg-black/60 border border-white/10 rounded-3xl shadow-[0_8px_60px_rgba(0,255,65,0.15)] px-7 py-6 space-y-4 pointer-events-auto">
            {/* Phase icon + title */}
            <div className="flex items-center gap-3">
              <div className="relative w-10 h-10 shrink-0">
                <svg className="w-10 h-10 -rotate-90" viewBox="0 0 36 36">
                  <circle cx="18" cy="18" r="16" pathLength={100} fill="none" stroke="rgba(0,255,65,0.1)" strokeWidth="2.5" />
                  <circle cx="18" cy="18" r="16" pathLength={100} fill="none" stroke="#00ff41" strokeWidth="2.5"
                    strokeDasharray={`${Math.min(100, Math.max(0, progressPct))} ${100 - Math.min(100, Math.max(0, progressPct))}`}
                    strokeLinecap="round"
                    className="transition-all duration-500"
                  />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-green-400">
                  {progressPct}%
                </span>
                {analysisProgress.phase !== 'done' && analysisProgress.phase !== 'error' && (
                  <span className="absolute inset-2 rounded-full border border-green-400/30 animate-ping" />
                )}
              </div>
              <div className="min-w-0">
                <div className="text-white/90 font-semibold text-sm truncate">
                  {analysisProgress.step}
                </div>
                <div className="text-white/40 text-[11px] font-medium">
                  {phaseCode}
                </div>
              </div>
            </div>

            {/* Progress bar */}
            <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500 ease-out"
                style={{
                  width: `${progressPct}%`,
                  background: analysisProgress.phase === 'done'
                    ? 'linear-gradient(90deg, #00ff41, #33ff66)'
                    : analysisProgress.phase === 'error'
                    ? 'linear-gradient(90deg, #ef4444, #f97316)'
                    : 'linear-gradient(90deg, #00ff41, #00cc33)',
                  boxShadow: '0 0 12px rgba(0,255,65,0.4)',
                }}
              />
            </div>

            <div className="flex items-center justify-between text-[10px] text-white/35 font-mono">
              <span>{analysisProgress.phaseLabel ?? phaseCode}</span>
              {elapsedSec !== null && <span>T+{elapsedSec}s</span>}
            </div>

            {/* Stats row */}
            {(analysisProgress.phase === 'sampling' || analysisProgress.phase === 'retry') && (
              <div className="flex justify-between text-[11px]">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_6px_#00ff41]" />
                  <span className="text-white/60">Cedar</span>
                  <span className="text-green-400 font-bold">{analysisProgress.cedarCount ?? 0}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_6px_#ffaa00]" />
                  <span className="text-white/60">Oak</span>
                  <span className="text-amber-400 font-bold">{analysisProgress.oakCount ?? 0}</span>
                </div>
                <div className="text-white/30 font-mono">
                  {analysisProgress.completed ?? 0}/{analysisProgress.totalPoints ?? 0}
                </div>
              </div>
            )}

            {analysisProgress.phase === 'sampling' && (
              <div className="relative h-8 overflow-hidden rounded-xl border border-green-400/10 bg-green-950/20">
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-green-400/10 to-transparent animate-pulse" />
                <div className="absolute inset-0 flex items-center justify-center text-[10px] uppercase tracking-[0.25em] text-green-300/70">
                  Centering active region and sampling live imagery
                </div>
              </div>
            )}

            {/* Detail text */}
            {analysisProgress.detail && (
              <div className="text-white/30 text-[10px] text-center font-mono tracking-wide">
                {analysisProgress.detail}
              </div>
            )}

            {analysisProgress.processLines && analysisProgress.processLines.length > 0 && (
              <ul className="text-[10px] leading-snug space-y-1 border-t border-white/5 pt-3 list-disc pl-4 text-left">
                {analysisProgress.processLines.map((line, idx) => (
                  <li
                    key={idx}
                    className={
                      idx === analysisProgress.activeProcessIndex
                        ? 'text-green-300'
                        : idx < (analysisProgress.activeProcessIndex ?? 0)
                        ? 'text-white/45'
                        : 'text-white/20'
                    }
                  >
                    {line}
                  </li>
                ))}
              </ul>
            )}

            {analysisProgress.debugLines && analysisProgress.debugLines.length > 0 && (
              <div className="border-t border-white/5 pt-3 space-y-1">
                <div className="text-[10px] uppercase tracking-[0.25em] text-white/25">Debug</div>
                {analysisProgress.debugLines.map((line, idx) => (
                  <div key={idx} className="text-[10px] text-white/35 font-mono leading-snug">
                    {line}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        );
      })()}
    </div>
  );
}

function SpeciesToggle({ label, color, active, onToggle }: { label: string; color: string; active: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`w-full flex items-center gap-2 px-2 py-0.5 text-[11px] font-medium rounded transition-all duration-200 ${
        active ? 'text-white/90' : 'text-white/30 line-through'
      }`}
    >
      <span
        className="w-2.5 h-2.5 rounded-full shrink-0 transition-all duration-300"
        style={{
          backgroundColor: active ? color : 'transparent',
          border: `1.5px solid ${color}`,
          boxShadow: active ? `0 0 6px ${color}` : 'none',
        }}
      />
      {label}
    </button>
  );
}
