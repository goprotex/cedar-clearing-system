# TODO — Cedar Hack

## 3D Holographic View (Deferred)

The Three.js-based 3D holographic tree layer (`src/lib/tree-layer.ts`) renders instanced
tree meshes as a Mapbox `CustomLayerInterface`. It currently does not render correctly
in production (trees invisible / WebGL context issues with Mapbox shared GL context).

### Known Issues

- [ ] **3D trees don't render on Mapbox satellite style** — The `TreeLayer3D` custom layer
      shares the Mapbox WebGL context. The projection matrix and viewport setup may need
      further debugging (camera `matrixAutoUpdate`, `projectionMatrixInverse`, drawingBuffer
      dimensions). Currently disabled: hologram mode uses 2D cedar overlay only.
- [ ] **3D terrain + hologram conflict** — Enabling Mapbox 3D terrain (`map.setTerrain`)
      alongside the Three.js custom layer causes rendering issues. These are mutually
      exclusive for now. Investigate using terrain elevation queries to position trees
      without enabling the terrain source.
- [ ] **Species visibility toggles removed** — The per-species (cedar/oak/mixed) visibility
      toggles and tree marking UI (save/remove) were removed when 3D was disabled.
      Re-add when 3D rendering is fixed.
- [ ] **Tree marking (save/remove) disabled** — Click-to-mark trees via `findNearestTree()`
      requires the 3D layer. Could be reimplemented as a 2D feature using the cedar
      analysis grid cells instead.

### Files

- `src/lib/tree-layer.ts` — `TreeLayer3D` class, shaders, `extractTreesFromAnalysis()`
- `src/components/map/MapContainer.tsx` — Layer toggle logic, hologram mode
- `src/app/operate/[id]/OperatorClient.tsx` — Operator mode (uses 2D cedar overlay)

## Operate Mode

- [ ] **Map rendering on mobile** — The Mapbox map in operate mode had issues with the
      container div not being in the DOM when the map init effect fires. Fixed by always
      rendering the container and using an overlay for the no-bid state. Monitor for
      regressions.
- [ ] **NDVI overlay performance on mobile** — The NAIP NDVI raster tiles load from USGS
      ImageServer which can be slow. Consider caching or pre-rendering tiles.
- [ ] **GPS trail persistence** — The operator trail is only stored in memory
      (`trailCoordsRef`). Should persist to localStorage alongside cleared cells.

## General

- [ ] **PDF generation** — "GENERATE_PDF" button is a placeholder (Phase 4)
- [ ] **Supabase integration** — Currently all data is in localStorage. Move to Supabase
      for multi-device sync.
