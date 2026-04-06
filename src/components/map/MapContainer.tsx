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
import type { MarkedTree } from '@/types';

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

export default function MapContainer({ accessToken }: MapContainerProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
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
  const [speciesVisible, setSpeciesVisible] = useState<Record<Species, boolean>>({
    cedar: true, oak: true, mixed: true,
  });
  const [markMode, setMarkMode] = useState<'save' | 'remove' | null>(null);

  const {
    currentBid,
    selectedPastureId,
    drawingMode,
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

      // Validate polygon has at least 3 distinct points (GeoJSON closes the ring, so >=4 coords)
      if (feature.geometry.coordinates[0].length < 4) return;

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

      // ── Cedar AI overlay source ──
      map.addSource('cedar-analysis', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      map.addLayer({
        id: 'cedar-fill',
        type: 'fill',
        source: 'cedar-analysis',
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.7,
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

    // Toggle cedar AI overlay (fill + border) — auto-hide when hologram is active
    const cedarVisible = layers.cedarAI && !layers.hologram;
    for (const cedarLayerId of ['cedar-fill', 'cedar-border']) {
      const layer = map.getLayer(cedarLayerId);
      if (layer) {
        map.setLayoutProperty(cedarLayerId, 'visibility', cedarVisible ? 'visible' : 'none');
      }
    }
    if (map.getLayer('cedar-fill')) {
      map.setPaintProperty('cedar-fill', 'fill-opacity', opacities.cedarAI);
    }

    // Toggle 3D terrain — disabled when hologram is active (trees render at y=0,
    // but terrain DEM raises the satellite surface above them, hiding them)
    if (layers.terrain3d && !layers.hologram) {
      map.setTerrain({ source: 'mapbox-dem', exaggeration: opacities.terrain3d });
      // Add sky layer for atmosphere if not present
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

    // ── Hologram mode: 3D tree layer ──
    if (layers.hologram) {
      if (!treeLayerRef.current || !map.getLayer('3d-trees')) {
        // Clean up stale ref if layer was somehow removed
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

      // Always sync tree data when pastures change
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

        // Sync species visibility
        for (const sp of ['cedar', 'oak', 'mixed'] as Species[]) {
          tl.setSpeciesVisible(sp, speciesVisible[sp]);
        }
      }
    } else {
      if (treeLayerRef.current && map.getLayer('3d-trees')) {
        map.removeLayer('3d-trees');
        treeLayerRef.current = null;
      }
    }
  }, [layers, opacities, speciesVisible, currentBid.pastures, currentBid.propertyCenter]);

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
      // Hologram auto-hides cedar AI squares and disables terrain
      // (terrain DEM raises surface above y=0 where 3D trees render)
      if (key === 'hologram' && !prev.hologram) {
        next.terrain3d = false;
        next.cedarAI = false; // hide flat squares, 3D trees replace them
        // Pitch the camera to see 3D trees from an angle
        const map = mapRef.current;
        if (map) {
          map.easeTo({ pitch: 60, bearing: map.getBearing() || -20, duration: 1200 });
        }
      }
      // Reset camera when hologram turns off
      if (key === 'hologram' && prev.hologram) {
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

    // Merge all pastures' cedar analysis grid cells into one FeatureCollection
    const allFeatures: GeoJSON.Feature[] = [];
    for (const p of currentBid.pastures) {
      if (p.cedarAnalysis?.gridCells?.features) {
        allFeatures.push(...p.cedarAnalysis.gridCells.features);
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

      // Check if tree is already marked at this location
      const existing = (pasture.savedTrees ?? []).find(
        (t) => Math.abs(t.lng - nearest.lng) < 0.00001 && Math.abs(t.lat - nearest.lat) < 0.00001
      );

      if (existing) {
        // Toggle or remove
        if (existing.action === markMode) {
          unmarkTree(selectedPastureId, existing.id);
        } else {
          // Switch from save⇄remove — remove then re-add
          unmarkTree(selectedPastureId, existing.id);
          const tree: MarkedTree = {
            id: `tree-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            lng: nearest.lng,
            lat: nearest.lat,
            species: nearest.species,
            action: markMode,
            label: markMode === 'save' ? `Save ${nearest.species}` : `Remove ${nearest.species}`,
            height: nearest.height,
            canopyDiameter: nearest.canopyDiameter,
          };
          markTree(selectedPastureId, tree);
        }
      } else {
        const tree: MarkedTree = {
          id: `tree-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          lng: nearest.lng,
          lat: nearest.lat,
          species: nearest.species,
          action: markMode,
          label: markMode === 'save' ? `Save ${nearest.species}` : `Remove ${nearest.species}`,
          height: nearest.height,
          canopyDiameter: nearest.canopyDiameter,
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

    const allMarked = currentBid.pastures.flatMap((p) => p.savedTrees ?? []);
    tl.updateMarkedTrees(allMarked);
  }, [currentBid.pastures, layers.hologram]);

  // ── Fly to selected pasture when it changes ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedPastureId) return;

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
              <span className={`text-[10px] font-semibold uppercase tracking-wider ${layers.hologram ? 'text-cyan-400' : 'text-slate-400'}`}>
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

            <div className={`border-t my-1 ${layers.hologram ? 'border-cyan-800/50' : 'border-slate-700'}`} />

            <LayerRow
              label="⛰️ 3D"
              active={layers.terrain3d}
              opacity={opacities.terrain3d}
              opacityRange={[0.5, 2.5]}
              opacityStep={0.1}
              onToggle={() => toggleLayer('terrain3d')}
              onOpacity={(v) => setOpacities((p) => ({ ...p, terrain3d: v }))}
              holoMode={layers.hologram}
            />

            <div className={`border-t my-1 ${layers.hologram ? 'border-cyan-800/50' : 'border-slate-700'}`} />

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

            {/* Species filters (only show when hologram is active) */}
            {layers.hologram && (
              <div className="mt-1 pt-1 border-t border-cyan-800/50">
                <span className="text-[9px] text-cyan-500 uppercase tracking-wider px-2 font-semibold">
                  Species
                </span>
                <SpeciesToggle
                  label="Cedar"
                  color="#00ff88"
                  active={speciesVisible.cedar}
                  onToggle={() => setSpeciesVisible(v => ({ ...v, cedar: !v.cedar }))}
                />
                <SpeciesToggle
                  label="Oak"
                  color="#ffaa00"
                  active={speciesVisible.oak}
                  onToggle={() => setSpeciesVisible(v => ({ ...v, oak: !v.oak }))}
                />
                <SpeciesToggle
                  label="Mixed"
                  color="#00ccff"
                  active={speciesVisible.mixed}
                  onToggle={() => setSpeciesVisible(v => ({ ...v, mixed: !v.mixed }))}
                />
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={() => setLayersPanelOpen(true)}
            className={`backdrop-blur rounded-lg shadow-lg px-3 py-2 text-xs font-medium transition-colors ${
              layers.hologram
                ? 'holo-panel text-cyan-300 hover:text-white'
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
          {/* Tree marking mode buttons */}
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

      {/* Hologram: no trees hint */}
      {layers.hologram && !currentBid.pastures.some(p => p.cedarAnalysis?.gridCells?.features?.length) && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-10 holo-panel px-4 py-2 rounded-lg shadow-lg text-xs text-cyan-300 max-w-xs text-center">
          🔮 No tree data yet — run <span className="font-bold text-cyan-100">Analyze Cedar (AI)</span> on a pasture to generate 3D hologram trees
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
}: {
  label: string;
  active: boolean;
  opacity: number;
  opacityRange?: [number, number];
  opacityStep?: number;
  onToggle: () => void;
  onOpacity: (v: number) => void;
  holoMode?: boolean;
}) {
  return (
    <div className="space-y-0.5">
      <button
        onClick={onToggle}
        className={`w-full text-left px-2 py-1 rounded text-xs font-medium transition-all duration-200 ${
          active
            ? holoMode
              ? 'bg-cyan-600/60 text-cyan-100 shadow-[0_0_8px_rgba(0,255,200,0.3)]'
              : 'bg-amber-600 text-white'
            : holoMode
              ? 'text-cyan-300/70 hover:bg-cyan-900/40 hover:text-cyan-200'
              : 'text-slate-300 hover:bg-slate-800 hover:text-white'
        }`}
      >
        {label}
        {active && <span className="float-right text-[10px] opacity-75">ON</span>}
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
            className={`w-full h-1 cursor-pointer ${holoMode ? 'accent-cyan-400' : 'accent-amber-500'}`}
          />
          <span className={`text-[9px] w-7 text-right tabular-nums ${holoMode ? 'text-cyan-500' : 'text-slate-400'}`}>
            {Math.round((opacity / opacityRange[1]) * 100)}%
          </span>
        </div>
      )}
    </div>
  );
}

function SpeciesToggle({
  label,
  color,
  active,
  onToggle,
}: {
  label: string;
  color: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={`w-full flex items-center gap-2 px-2 py-0.5 text-[11px] font-medium rounded transition-all duration-200 ${
        active
          ? 'text-white/90'
          : 'text-white/30 line-through'
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
