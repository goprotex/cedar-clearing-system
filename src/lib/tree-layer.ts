// ─── 3D Holographic Tree Layer for Mapbox GL JS ───
// Uses Three.js with Mapbox CustomLayerInterface for synchronized 3D rendering.
// Renders cedar (green cones) and oak (amber domes) as InstancedMesh with
// holographic shader materials, animated ground grid, floating particles,
// and extruded polygon walls.

import * as THREE from 'three';
import mapboxgl from 'mapbox-gl';
import type { MarkedTree } from '@/types';

// ─── Types ───

export interface TreePosition {
  lng: number;
  lat: number;
  species: 'cedar' | 'oak' | 'mixed';
  height: number;
  canopyDiameter: number;
}

export interface PastureWall {
  id: string;
  coordinates: [number, number][]; // exterior ring [lng, lat]
  color: string;
}

type Species = 'cedar' | 'oak' | 'mixed';

// ─── Hologram Color Palette ───

const HOLO = {
  cedar:  { base: new THREE.Color(0x00ff88), glow: new THREE.Color(0x44ffbb) },
  oak:    { base: new THREE.Color(0xffaa00), glow: new THREE.Color(0xffcc44) },
  mixed:  { base: new THREE.Color(0x00ccff), glow: new THREE.Color(0x66ddff) },
  grid:   new THREE.Color(0x00ff88),
  wall:   new THREE.Color(0x00eeff),
  particle: new THREE.Color(0x44ffcc),
  save:   new THREE.Color(0x00ff44), // bright green shield
  remove: new THREE.Color(0xff2244), // red target
};

// ─── Hologram Shader (Fresnel glow + scan lines) ───

const HOLO_VERTEX = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewPos;
  varying float vElevation;

  void main() {
    #ifdef USE_INSTANCING
      vec4 mvPos = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      vNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);
    #else
      vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
      vNormal = normalize(normalMatrix * normal);
    #endif
    vViewPos = mvPos.xyz;
    vElevation = position.y;
    gl_Position = projectionMatrix * mvPos;
  }
`;

const HOLO_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform vec3 uGlow;
  uniform float uOpacity;

  varying vec3 vNormal;
  varying vec3 vViewPos;
  varying float vElevation;

  void main() {
    vec3 viewDir = normalize(-vViewPos);
    float fresnel = 1.0 - abs(dot(viewDir, vNormal));
    fresnel = pow(fresnel, 2.5);

    // Animated scan lines
    float scan = sin(vElevation * 40.0 + uTime * 3.0) * 0.5 + 0.5;
    scan = smoothstep(0.25, 0.75, scan);

    // Breathe pulse
    float pulse = 0.85 + 0.15 * sin(uTime * 1.2);

    vec3 color = mix(uColor, uGlow, fresnel * 0.6 + scan * 0.2);
    float alpha = (uOpacity + fresnel * 0.45) * pulse;
    alpha *= (0.85 + scan * 0.15);

    gl_FragColor = vec4(color * 1.6, alpha);
  }
`;

// ─── Wall Shader ───

const WALL_VERTEX = /* glsl */ `
  varying float vHeight;
  varying float vFresnel;

  void main() {
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vec3 norm = normalize(normalMatrix * normal);
    vec3 viewDir = normalize(-mvPos.xyz);
    vFresnel = 1.0 - abs(dot(viewDir, norm));
    vHeight = position.y;
    gl_Position = projectionMatrix * mvPos;
  }
`;

const WALL_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;

  varying float vHeight;
  varying float vFresnel;

  void main() {
    float scan = sin(vHeight * 0.8 + uTime * 2.0) * 0.5 + 0.5;
    float edge = pow(vFresnel, 3.0);
    float alpha = (0.08 + edge * 0.25 + scan * 0.07);

    // Horizontal grid lines
    float gridLine = abs(sin(vHeight * 3.0)) < 0.05 ? 0.3 : 0.0;
    alpha += gridLine;

    gl_FragColor = vec4(uColor * 1.5, alpha);
  }
`;

// ─── Grid Shader ───

const GRID_VERTEX = /* glsl */ `
  varying vec2 vWorldPos;
  void main() {
    vWorldPos = position.xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const GRID_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uRadius;

  varying vec2 vWorldPos;

  void main() {
    float dist = length(vWorldPos);
    if (dist > uRadius) discard;

    // Grid pattern
    vec2 grid = abs(fract(vWorldPos * 0.05) - 0.5);
    float line = min(grid.x, grid.y);
    float gridAlpha = 1.0 - smoothstep(0.0, 0.04, line);

    // Sub-grid
    vec2 subGrid = abs(fract(vWorldPos * 0.2) - 0.5);
    float subLine = min(subGrid.x, subGrid.y);
    float subAlpha = 1.0 - smoothstep(0.0, 0.02, subLine);

    float alpha = gridAlpha * 0.18 + subAlpha * 0.06;

    // Fade at edges
    float edgeFade = 1.0 - smoothstep(uRadius * 0.7, uRadius, dist);
    alpha *= edgeFade;

    // Pulse
    alpha *= 0.7 + 0.3 * sin(uTime * 0.6);

    // Radial sweep
    float angle = atan(vWorldPos.y, vWorldPos.x);
    float sweep = sin(angle * 2.0 - uTime * 0.8) * 0.5 + 0.5;
    alpha += sweep * 0.03 * edgeFade;

    gl_FragColor = vec4(uColor, alpha);
  }
`;

// ─── Marker Ring Shader (pulsing ring around marked trees) ───

const MARKER_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    #ifdef USE_INSTANCING
      vec4 mvPos = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    #else
      vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    #endif
    vUv = uv;
    gl_Position = projectionMatrix * mvPos;
  }
`;

const MARKER_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;

  varying vec2 vUv;

  void main() {
    vec2 center = vUv - 0.5;
    float dist = length(center) * 2.0;

    // Ring
    float ring = smoothstep(0.7, 0.75, dist) - smoothstep(0.85, 0.9, dist);

    // Inner glow
    float innerGlow = (1.0 - smoothstep(0.0, 0.7, dist)) * 0.15;

    // Pulsing
    float pulse = 0.7 + 0.3 * sin(uTime * 2.5);

    // Rotating dash pattern
    float angle = atan(center.y, center.x);
    float dash = sin(angle * 4.0 - uTime * 3.0) * 0.5 + 0.5;
    ring *= 0.6 + dash * 0.4;

    float alpha = (ring * 0.8 + innerGlow) * pulse;
    if (alpha < 0.01) discard;

    gl_FragColor = vec4(uColor * 1.5, alpha);
  }
`;

// ─── Helper: Create hologram material ───

function createHoloMaterial(base: THREE.Color, glow: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: base },
      uGlow: { value: glow },
      uOpacity: { value: 0.75 },
    },
    vertexShader: HOLO_VERTEX,
    fragmentShader: HOLO_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

// ─── Helper: Seeded random for deterministic scattering ───

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ─── Extract tree positions from cedar analysis data ───

export function extractTreesFromAnalysis(
  pastures: Array<{
    cedarAnalysis: { gridCells: GeoJSON.FeatureCollection; summary: { gridSpacingM: number } } | null;
    density: string;
  }>
): TreePosition[] {
  const trees: TreePosition[] = [];
  const rand = seededRandom(42);

  const densityTreeCount: Record<string, number> = {
    light: 2, moderate: 3, heavy: 5, extreme: 7,
  };

  for (const pasture of pastures) {
    if (!pasture.cedarAnalysis?.gridCells?.features) continue;

    const spacing = pasture.cedarAnalysis.summary.gridSpacingM || 30;
    const halfSpacingDeg = (spacing / 2) / 111320; // rough meters to degrees
    const treeCount = densityTreeCount[pasture.density] || 2;

    for (const feature of pasture.cedarAnalysis.gridCells.features) {
      const cls = feature.properties?.classification as string;
      if (cls !== 'cedar' && cls !== 'oak' && cls !== 'mixed_brush') continue;

      const species: Species = cls === 'mixed_brush' ? 'mixed' : cls as Species;

      // Get cell centroid from polygon
      const coords = (feature.geometry as GeoJSON.Polygon).coordinates[0];
      const cLng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
      const cLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;

      for (let t = 0; t < treeCount; t++) {
        const offsetLng = (rand() - 0.5) * halfSpacingDeg * 1.4;
        const offsetLat = (rand() - 0.5) * halfSpacingDeg * 1.4;

        let height: number, canopy: number;
        if (species === 'cedar') {
          height = 8 + rand() * 14;    // 8-22m
          canopy = 4 + rand() * 6;     // 4-10m
        } else if (species === 'oak') {
          height = 6 + rand() * 10;    // 6-16m
          canopy = 6 + rand() * 10;    // 6-16m
        } else {
          height = 3 + rand() * 6;     // 3-9m
          canopy = 3 + rand() * 6;     // 3-9m
        }

        trees.push({
          lng: cLng + offsetLng,
          lat: cLat + offsetLat,
          species,
          height: Math.round(height * 10) / 10,
          canopyDiameter: Math.round(canopy * 10) / 10,
        });
      }
    }
  }

  return trees;
}

// ─── TreeLayer3D: Mapbox Custom Layer ───

export class TreeLayer3D {
  readonly id = '3d-trees';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  private map!: mapboxgl.Map;
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.Camera();

  // Model transform from origin
  private originMerc!: { x: number; y: number; z: number; scale: number };

  // Instanced meshes per species (close-up geometry)
  private meshes: Record<Species, THREE.InstancedMesh | null> = {
    cedar: null, oak: null, mixed: null,
  };
  // LOD: dots for zoomed-out view
  private dotMeshes: Record<Species, THREE.InstancedMesh | null> = {
    cedar: null, oak: null, mixed: null,
  };

  // Materials
  private materials: Record<Species, THREE.ShaderMaterial> = {
    cedar: createHoloMaterial(HOLO.cedar.base, HOLO.cedar.glow),
    oak: createHoloMaterial(HOLO.oak.base, HOLO.oak.glow),
    mixed: createHoloMaterial(HOLO.mixed.base, HOLO.mixed.glow),
  };
  private dotMaterials: Record<Species, THREE.ShaderMaterial> = {
    cedar: createHoloMaterial(HOLO.cedar.base, HOLO.cedar.glow),
    oak: createHoloMaterial(HOLO.oak.base, HOLO.oak.glow),
    mixed: createHoloMaterial(HOLO.mixed.base, HOLO.mixed.glow),
  };

  // Holographic ground grid
  private gridMesh: THREE.Mesh | null = null;
  private gridMaterial: THREE.ShaderMaterial | null = null;

  // Polygon extrusion walls
  private wallGroup = new THREE.Group();
  private wallMaterial: THREE.ShaderMaterial;

  // Floating particles
  private particles: THREE.Points | null = null;
  private particleMaterial: THREE.PointsMaterial | null = null;
  private particlePositions: Float32Array | null = null;
  private particleVelocities: Float32Array | null = null;

  // Marked tree rings
  private saveRings: THREE.InstancedMesh | null = null;
  private removeRings: THREE.InstancedMesh | null = null;
  private saveRingMaterial: THREE.ShaderMaterial;
  private removeRingMaterial: THREE.ShaderMaterial;
  private markedTrees: MarkedTree[] = [];

  // State
  private trees: TreePosition[] = [];
  private speciesVisible: Record<Species, boolean> = { cedar: true, oak: true, mixed: true };
  private animTime = 0;
  private disposed = false;
  private originLngLat: [number, number];
  private lastZoom = 0;

  constructor(originLngLat: [number, number]) {
    this.originLngLat = originLngLat;

    // Wall material
    this.wallMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: HOLO.wall },
      },
      vertexShader: WALL_VERTEX,
      fragmentShader: WALL_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });

    // Marker ring materials
    this.saveRingMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: HOLO.save } },
      vertexShader: MARKER_VERTEX,
      fragmentShader: MARKER_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.removeRingMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: HOLO.remove } },
      vertexShader: MARKER_VERTEX,
      fragmentShader: MARKER_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
  }

  // ─── Mapbox callbacks ───

  onAdd(map: mapboxgl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;

    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl as WebGL2RenderingContext,
      antialias: true,
    });
    this.renderer.autoClear = false;

    // Compute Mercator origin
    const merc = mapboxgl.MercatorCoordinate.fromLngLat(this.originLngLat, 0);
    this.originMerc = {
      x: merc.x,
      y: merc.y,
      z: merc.z ?? 0,
      scale: merc.meterInMercatorCoordinateUnits(),
    };

    // Add wall group to scene
    this.scene.add(this.wallGroup);

    // Ambient light (hologram doesn't need directional light, but helps shape visibility)
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambient);
  }

  render(gl: WebGLRenderingContext | WebGL2RenderingContext, matrix: number[]) {
    if (this.disposed) return;

    // Advance animation time
    this.animTime += 0.016; // ~60fps

    // Update all shader uniforms
    const allMaterials = [
      ...Object.values(this.materials),
      ...Object.values(this.dotMaterials),
      this.gridMaterial,
      this.wallMaterial,
      this.saveRingMaterial,
      this.removeRingMaterial,
    ];
    for (const mat of allMaterials) {
      if (mat?.uniforms?.uTime) mat.uniforms.uTime.value = this.animTime;
    }

    // LOD: switch between full geometry and dots based on zoom
    const zoom = this.map.getZoom();
    if (Math.abs(zoom - this.lastZoom) > 0.5) {
      this.updateLOD(zoom);
      this.lastZoom = zoom;
    }

    // Update particles
    this.updateParticles();

    // Build the camera matrix: projection = mapboxMatrix * modelMatrix
    const { x, y, z, scale } = this.originMerc;

    const l = new THREE.Matrix4()
      .makeTranslation(x, y, z)
      .scale(new THREE.Vector3(scale, -scale, scale))
      .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));

    this.camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix).multiply(l);

    // Restore Three.js state after Mapbox modified WebGL context
    this.renderer.resetState();

    // Ensure viewport matches canvas size (Mapbox may have changed it)
    const canvas = this.map.getCanvas();
    this.renderer.setViewport(0, 0, canvas.width, canvas.height);

    this.renderer.render(this.scene, this.camera);
    this.map.triggerRepaint();
  }

  onRemove() {
    this.disposed = true;
    this.scene.clear();
    this.renderer.dispose();
    for (const mat of Object.values(this.materials)) mat.dispose();
    for (const mat of Object.values(this.dotMaterials)) mat.dispose();
    this.gridMaterial?.dispose();
    this.wallMaterial.dispose();
    this.saveRingMaterial.dispose();
    this.removeRingMaterial.dispose();
    this.particleMaterial?.dispose();
  }

  // ─── Public API ───

  updateTrees(trees: TreePosition[]) {
    this.trees = trees;
    this.rebuildMeshes();
    this.rebuildGrid();
    this.rebuildParticles();
    this.lastZoom = this.map?.getZoom() ?? 14;
    this.updateLOD(this.lastZoom);
  }

  setSpeciesVisible(species: Species, visible: boolean) {
    this.speciesVisible[species] = visible;
    if (this.meshes[species]) this.meshes[species]!.visible = visible && this.lastZoom > 13;
    if (this.dotMeshes[species]) this.dotMeshes[species]!.visible = visible && this.lastZoom <= 13;
  }

  getSpeciesVisible(): Record<Species, boolean> {
    return { ...this.speciesVisible };
  }

  updatePolygonWalls(walls: PastureWall[]) {
    // Clear old walls
    this.wallGroup.clear();

    for (const wall of walls) {
      const wallMesh = this.createWallGeometry(wall.coordinates);
      if (wallMesh) this.wallGroup.add(wallMesh);
    }
  }

  updateMarkedTrees(marked: MarkedTree[]) {
    this.markedTrees = marked;
    this.rebuildMarkerRings();
  }

  /** Find the nearest tree within `radiusM` meters of a given lng/lat. Returns tree info or null. */
  findNearestTree(lng: number, lat: number, radiusM = 20): TreePosition | null {
    if (this.trees.length === 0) return null;

    const clickScene = this.lngLatToScene(lng, lat);
    let best: TreePosition | null = null;
    let bestDist = Infinity;

    for (const t of this.trees) {
      const p = this.lngLatToScene(t.lng, t.lat);
      const dx = p.x - clickScene.x;
      const dz = p.z - clickScene.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < bestDist) {
        bestDist = dist;
        best = t;
      }
    }

    return bestDist <= radiusM ? best : null;
  }

  // ─── Internal: Build instanced meshes ───

  private rebuildMeshes() {
    // Remove old meshes
    for (const sp of ['cedar', 'oak', 'mixed'] as Species[]) {
      if (this.meshes[sp]) { this.scene.remove(this.meshes[sp]!); this.meshes[sp]!.dispose(); }
      if (this.dotMeshes[sp]) { this.scene.remove(this.dotMeshes[sp]!); this.dotMeshes[sp]!.dispose(); }
      this.meshes[sp] = null;
      this.dotMeshes[sp] = null;
    }

    if (this.trees.length === 0) return;

    // Group trees by species
    const grouped: Record<Species, TreePosition[]> = { cedar: [], oak: [], mixed: [] };
    for (const t of this.trees) grouped[t.species].push(t);

    // Geometries
    const cedarGeo = new THREE.ConeGeometry(1, 1, 8); // unit cone, scaled per instance
    cedarGeo.translate(0, 0.5, 0); // base at origin
    const oakGeo = new THREE.SphereGeometry(1, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.6);
    oakGeo.translate(0, 0.3, 0);
    const mixedGeo = new THREE.SphereGeometry(1, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55);
    mixedGeo.translate(0, 0.25, 0);
    const dotGeo = new THREE.CircleGeometry(1, 8);
    dotGeo.rotateX(-Math.PI / 2);
    dotGeo.translate(0, 0.5, 0);

    const geos: Record<Species, THREE.BufferGeometry> = {
      cedar: cedarGeo, oak: oakGeo, mixed: mixedGeo,
    };

    const dummy = new THREE.Object3D();

    for (const sp of ['cedar', 'oak', 'mixed'] as Species[]) {
      const arr = grouped[sp];
      if (arr.length === 0) continue;

      // Full geometry mesh
      const mesh = new THREE.InstancedMesh(geos[sp], this.materials[sp], arr.length);
      for (let i = 0; i < arr.length; i++) {
        const t = arr[i];
        const pos = this.lngLatToScene(t.lng, t.lat);
        const radiusX = t.canopyDiameter / 2;
        const radiusZ = t.canopyDiameter / 2;
        dummy.position.set(pos.x, 0, pos.z);
        dummy.scale.set(radiusX, t.height, radiusZ);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.meshes[sp] = mesh;

      // Dot mesh (for far zoom)
      const dot = new THREE.InstancedMesh(dotGeo, this.dotMaterials[sp], arr.length);
      for (let i = 0; i < arr.length; i++) {
        const t = arr[i];
        const pos = this.lngLatToScene(t.lng, t.lat);
        dummy.position.set(pos.x, 0, pos.z);
        dummy.scale.set(3, 1, 3);
        dummy.updateMatrix();
        dot.setMatrixAt(i, dummy.matrix);
      }
      dot.instanceMatrix.needsUpdate = true;
      dot.frustumCulled = false;
      dot.visible = false;
      this.scene.add(dot);
      this.dotMeshes[sp] = dot;
    }

    cedarGeo.dispose();
    oakGeo.dispose();
    mixedGeo.dispose();
    dotGeo.dispose();
  }

  // ─── Internal: LOD switching ───

  private updateLOD(zoom: number) {
    const close = zoom > 13;
    for (const sp of ['cedar', 'oak', 'mixed'] as Species[]) {
      const vis = this.speciesVisible[sp];
      if (this.meshes[sp]) this.meshes[sp]!.visible = vis && close;
      if (this.dotMeshes[sp]) this.dotMeshes[sp]!.visible = vis && !close;
    }
  }

  // ─── Internal: Marker rings for saved/removed trees ───

  private rebuildMarkerRings() {
    // Remove old ring meshes
    if (this.saveRings) { this.scene.remove(this.saveRings); this.saveRings.dispose(); this.saveRings = null; }
    if (this.removeRings) { this.scene.remove(this.removeRings); this.removeRings.dispose(); this.removeRings = null; }

    if (this.markedTrees.length === 0) return;

    const saves = this.markedTrees.filter((t) => t.action === 'save');
    const removes = this.markedTrees.filter((t) => t.action === 'remove');

    const ringGeo = new THREE.PlaneGeometry(1, 1);
    ringGeo.rotateX(-Math.PI / 2);
    ringGeo.translate(0, 0.3, 0);

    const dummy = new THREE.Object3D();

    const buildRings = (trees: MarkedTree[], material: THREE.ShaderMaterial): THREE.InstancedMesh => {
      const mesh = new THREE.InstancedMesh(ringGeo, material, trees.length);
      for (let i = 0; i < trees.length; i++) {
        const t = trees[i];
        const p = this.lngLatToScene(t.lng, t.lat);
        const ringSize = Math.max(t.canopyDiameter * 1.5, 8);
        dummy.position.set(p.x, 0, p.z);
        dummy.scale.set(ringSize, 1, ringSize);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      return mesh;
    };

    if (saves.length > 0) {
      this.saveRings = buildRings(saves, this.saveRingMaterial);
      this.scene.add(this.saveRings);
    }
    if (removes.length > 0) {
      this.removeRings = buildRings(removes, this.removeRingMaterial);
      this.scene.add(this.removeRings);
    }

    ringGeo.dispose();
  }

  // ─── Internal: Holographic ground grid ───

  private rebuildGrid() {
    if (this.gridMesh) {
      this.scene.remove(this.gridMesh);
      this.gridMesh.geometry.dispose();
    }

    if (this.trees.length === 0) return;

    // Compute extent of all trees
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const t of this.trees) {
      const p = this.lngLatToScene(t.lng, t.lat);
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }

    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const radius = Math.max(maxX - minX, maxZ - minZ) / 2 + 100;

    this.gridMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: HOLO.grid },
        uRadius: { value: radius },
      },
      vertexShader: GRID_VERTEX,
      fragmentShader: GRID_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const gridGeo = new THREE.PlaneGeometry(radius * 2, radius * 2);
    gridGeo.rotateX(-Math.PI / 2);
    this.gridMesh = new THREE.Mesh(gridGeo, this.gridMaterial);
    this.gridMesh.position.set(cx, -0.5, cz);
    this.gridMesh.frustumCulled = false;
    this.scene.add(this.gridMesh);
  }

  // ─── Internal: Floating particles ───

  private rebuildParticles() {
    if (this.particles) {
      this.scene.remove(this.particles);
      this.particles.geometry.dispose();
    }

    if (this.trees.length === 0) return;

    const count = Math.min(this.trees.length * 3, 600);
    this.particlePositions = new Float32Array(count * 3);
    this.particleVelocities = new Float32Array(count * 3);

    const rand = seededRandom(123);

    // Compute bounds
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const t of this.trees) {
      const p = this.lngLatToScene(t.lng, t.lat);
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }

    for (let i = 0; i < count; i++) {
      this.particlePositions[i * 3]     = minX + rand() * (maxX - minX);
      this.particlePositions[i * 3 + 1] = rand() * 30;
      this.particlePositions[i * 3 + 2] = minZ + rand() * (maxZ - minZ);

      this.particleVelocities[i * 3]     = (rand() - 0.5) * 0.3;
      this.particleVelocities[i * 3 + 1] = 0.2 + rand() * 0.5;
      this.particleVelocities[i * 3 + 2] = (rand() - 0.5) * 0.3;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));

    this.particleMaterial = new THREE.PointsMaterial({
      color: HOLO.particle,
      size: 3.5,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    this.particles = new THREE.Points(geo, this.particleMaterial);
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);
  }

  private updateParticles() {
    if (!this.particlePositions || !this.particleVelocities || !this.particles) return;

    const count = this.particlePositions.length / 3;
    for (let i = 0; i < count; i++) {
      this.particlePositions[i * 3]     += this.particleVelocities[i * 3]     * 0.016;
      this.particlePositions[i * 3 + 1] += this.particleVelocities[i * 3 + 1] * 0.016;
      this.particlePositions[i * 3 + 2] += this.particleVelocities[i * 3 + 2] * 0.016;

      // Reset particle when it drifts too high
      if (this.particlePositions[i * 3 + 1] > 35) {
        this.particlePositions[i * 3 + 1] = 0;
      }
    }

    const attr = this.particles.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
  }

  // ─── Internal: Polygon extrusion walls ───

  private createWallGeometry(coords: [number, number][]): THREE.Mesh | null {
    if (coords.length < 3) return null;

    const wallHeight = 40; // meters
    const segments = coords.length;
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i < segments; i++) {
      const [lng1, lat1] = coords[i];
      const [lng2, lat2] = coords[(i + 1) % segments];
      const p1 = this.lngLatToScene(lng1, lat1);
      const p2 = this.lngLatToScene(lng2, lat2);

      const vi = positions.length / 3;

      // Two triangles per wall segment (quad)
      // Bottom-left, bottom-right, top-right, top-left
      positions.push(p1.x, 0, p1.z);
      positions.push(p2.x, 0, p2.z);
      positions.push(p2.x, wallHeight, p2.z);
      positions.push(p1.x, wallHeight, p1.z);

      // Normal pointing outward (perpendicular to wall segment)
      const dx = p2.x - p1.x;
      const dz = p2.z - p1.z;
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      const nx = -dz / len;
      const nz = dx / len;

      for (let j = 0; j < 4; j++) {
        normals.push(nx, 0, nz);
      }

      indices.push(vi, vi + 1, vi + 2);
      indices.push(vi, vi + 2, vi + 3);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setIndex(indices);

    const mesh = new THREE.Mesh(geo, this.wallMaterial);
    mesh.frustumCulled = false;
    return mesh;
  }

  // ─── Coordinate conversion ───

  private lngLatToScene(lng: number, lat: number): { x: number; z: number } {
    const merc = mapboxgl.MercatorCoordinate.fromLngLat([lng, lat], 0);
    return {
      x: (merc.x - this.originMerc.x) / this.originMerc.scale,
      z: (merc.y - this.originMerc.y) / this.originMerc.scale,
    };
  }
}
