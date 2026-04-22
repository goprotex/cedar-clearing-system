import type { CrownDetection, CrownMaskFeatureProperties } from '@/types';

export interface HiResImageData {
  data: Uint8Array;
  width: number;
  height: number;
  channels: number;
  metersPerPixel: number;
}

export interface CrownCalibrationExample {
  lng: number;
  lat: number;
  species: 'cedar' | 'oak';
}

export interface CrownPatchStats {
  coverage: number;
  brightness: number;
  textureVar: number;
  greenBias: number;
  grayFrac: number;
  redBias: number;
  diameterM: number;
  centroidLng: number;
  centroidLat: number;
}

interface PixelFeatures {
  brightness: Float32Array;
  greenBias: Float32Array;
  redBias: Float32Array;
  grayish: Uint8Array;
  vivid: Uint8Array;
}

interface ComponentAccumulator {
  pixelCount: number;
  sumX: number;
  sumY: number;
  sumBrightness: number;
  sumGreenBias: number;
  sumRedBias: number;
  grayPixels: number;
  vividPixels: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface RasterComponent {
  label: number;
  species: 'cedar' | 'oak';
  pixelCount: number;
  centroidX: number;
  centroidY: number;
  meanBrightness: number;
  meanGreenBias: number;
  meanRedBias: number;
  grayFrac: number;
  vividFrac: number;
  bboxWidthPx: number;
  bboxHeightPx: number;
  bboxAreaPx: number;
  supportCount: number;
  supportConfidence: number;
}

interface CrownSegmentationResult {
  crowns: CrownDetection[];
  maskFeatures: GeoJSON.Feature<GeoJSON.Polygon, CrownMaskFeatureProperties>[];
}

export interface CrownCalibrationProfile {
  cedarExamples: number;
  oakExamples: number;
  cedarCoverageFloor: number;
  cedarGreenBiasFloor: number;
  cedarBrightnessCeil: number;
  oakCoverageFloor: number;
  oakGrayFloor: number;
  oakBrightnessFloor: number;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function haversineM(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pixelToLngLat(image: HiResImageData, bbox: number[], x: number, y: number): [number, number] {
  const lng = bbox[0] + (x / Math.max(1, image.width - 1)) * (bbox[2] - bbox[0]);
  const lat = bbox[3] - (y / Math.max(1, image.height - 1)) * (bbox[3] - bbox[1]);
  return [lng, lat];
}

function classifyPatchPixel(
  r: number,
  g: number,
  b: number,
  species: 'cedar' | 'oak',
  profile: CrownCalibrationProfile,
): boolean {
  const brightness = (r + g + b) / 3;
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  const greenBias = (g - Math.max(r, b)) / Math.max(brightness, 1);
  const grayish = spread < 26 && brightness > 78 && brightness < 190;
  const redBias = (r - Math.max(g, b)) / Math.max(brightness, 1);

  if (species === 'cedar') {
    return (
      brightness <= profile.cedarBrightnessCeil &&
      (greenBias >= profile.cedarGreenBiasFloor || (g >= r && g >= b && spread > 16))
    );
  }

  return brightness >= profile.oakBrightnessFloor && (grayish || redBias > 0.04) && greenBias < 0.03;
}

function lngLatToPixel(image: HiResImageData, bbox: number[], lng: number, lat: number): [number, number] {
  const xNorm = (lng - bbox[0]) / Math.max(1e-9, bbox[2] - bbox[0]);
  const yNorm = (bbox[3] - lat) / Math.max(1e-9, bbox[3] - bbox[1]);
  return [
    clamp(Math.round(xNorm * (image.width - 1)), 0, image.width - 1),
    clamp(Math.round(yNorm * (image.height - 1)), 0, image.height - 1),
  ];
}

function computePixelFeatures(image: HiResImageData): PixelFeatures {
  const total = image.width * image.height;
  const brightness = new Float32Array(total);
  const greenBias = new Float32Array(total);
  const redBias = new Float32Array(total);
  const grayish = new Uint8Array(total);
  const vivid = new Uint8Array(total);

  for (let i = 0; i < total; i++) {
    const idx = i * image.channels;
    const r = image.data[idx];
    const g = image.data[idx + 1];
    const b = image.data[idx + 2];
    const bright = (r + g + b) / 3;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    brightness[i] = bright;
    greenBias[i] = (g - Math.max(r, b)) / Math.max(bright, 1);
    redBias[i] = (r - Math.max(g, b)) / Math.max(bright, 1);
    grayish[i] = spread < 26 && bright > 78 && bright < 190 ? 1 : 0;
    vivid[i] = spread > 20 ? 1 : 0;
  }

  return { brightness, greenBias, redBias, grayish, vivid };
}

function neighborCount(mask: Uint8Array, width: number, height: number, x: number, y: number): number {
  let count = 0;
  for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++) {
    for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++) {
      if (nx === x && ny === y) continue;
      count += mask[ny * width + nx];
    }
  }
  return count;
}

function orthogonalCount(mask: Uint8Array, width: number, height: number, x: number, y: number): number {
  let count = 0;
  if (x > 0) count += mask[y * width + (x - 1)];
  if (x + 1 < width) count += mask[y * width + (x + 1)];
  if (y > 0) count += mask[(y - 1) * width + x];
  if (y + 1 < height) count += mask[(y + 1) * width + x];
  return count;
}

function cleanMask(mask: Uint8Array, width: number, height: number, species: 'cedar' | 'oak'): Uint8Array {
  let current = mask.slice();
  const passes = species === 'oak' ? 2 : 1;

  for (let pass = 0; pass < passes; pass++) {
    const next = current.slice();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x;
        const neighbors = neighborCount(current, width, height, x, y);
        const orthogonal = orthogonalCount(current, width, height, x, y);

        if (current[index] === 1) {
          const minKeep = species === 'oak' ? 2 : 1;
          if (neighbors < minKeep || (neighbors <= 2 && orthogonal === 0)) {
            next[index] = 0;
          }
        } else {
          const fillThreshold = species === 'oak' ? 6 : 5;
          if (neighbors >= fillThreshold || (neighbors >= 4 && orthogonal >= 3)) {
            next[index] = 1;
          }
        }
      }
    }
    current = next;
  }

  const smoothed = current.slice();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const neighbors = neighborCount(current, width, height, x, y);
      if (current[index] === 1 && neighbors <= 1) {
        smoothed[index] = 0;
      } else if (current[index] === 0 && neighbors >= (species === 'oak' ? 6 : 5)) {
        smoothed[index] = 1;
      }
    }
  }

  return smoothed;
}

function buildSpeciesMask(
  image: HiResImageData,
  features: PixelFeatures,
  species: 'cedar' | 'oak',
  profile: CrownCalibrationProfile,
): Uint8Array {
  const total = image.width * image.height;
  const mask = new Uint8Array(total);

  for (let i = 0; i < total; i++) {
    const bright = features.brightness[i];
    const gBias = features.greenBias[i];
    const rBias = features.redBias[i];
    const isGray = features.grayish[i] === 1;
    const isVivid = features.vivid[i] === 1;

    const on =
      species === 'cedar'
        ? bright <= profile.cedarBrightnessCeil &&
          ((gBias >= profile.cedarGreenBiasFloor && isVivid) || (gBias >= profile.cedarGreenBiasFloor + 0.012))
        : bright >= profile.oakBrightnessFloor &&
          gBias < 0.03 &&
          (isGray || rBias > 0.04 || (rBias > 0.015 && bright > profile.oakBrightnessFloor + 12));
    if (on) mask[i] = 1;
  }

  return cleanMask(mask, image.width, image.height, species);
}

function extractRasterComponents(
  image: HiResImageData,
  mask: Uint8Array,
  features: PixelFeatures,
  species: 'cedar' | 'oak',
  minPixels: number,
): { labels: Int32Array; components: RasterComponent[] } {
  const labels = new Int32Array(image.width * image.height);
  const components: RasterComponent[] = [];
  let nextLabel = 1;
  const queue = new Int32Array(image.width * image.height);

  for (let start = 0; start < mask.length; start++) {
    if (mask[start] === 0 || labels[start] !== 0) continue;

    let qHead = 0;
    let qTail = 0;
    queue[qTail++] = start;
    labels[start] = nextLabel;
    const componentPixels: number[] = [start];

    const acc: ComponentAccumulator = {
      pixelCount: 0,
      sumX: 0,
      sumY: 0,
      sumBrightness: 0,
      sumGreenBias: 0,
      sumRedBias: 0,
      grayPixels: 0,
      vividPixels: 0,
      minX: image.width,
      minY: image.height,
      maxX: 0,
      maxY: 0,
    };

    while (qHead < qTail) {
      const index = queue[qHead++];
      const x = index % image.width;
      const y = Math.floor(index / image.width);

      acc.pixelCount++;
      acc.sumX += x;
      acc.sumY += y;
      acc.sumBrightness += features.brightness[index];
      acc.sumGreenBias += features.greenBias[index];
      acc.sumRedBias += features.redBias[index];
      acc.grayPixels += features.grayish[index];
      acc.vividPixels += features.vivid[index];
      if (x < acc.minX) acc.minX = x;
      if (y < acc.minY) acc.minY = y;
      if (x > acc.maxX) acc.maxX = x;
      if (y > acc.maxY) acc.maxY = y;

      for (let ny = Math.max(0, y - 1); ny <= Math.min(image.height - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(image.width - 1, x + 1); nx++) {
          if (nx === x && ny === y) continue;
          const neighbor = ny * image.width + nx;
          if (mask[neighbor] === 0 || labels[neighbor] !== 0) continue;
          labels[neighbor] = nextLabel;
          queue[qTail++] = neighbor;
          componentPixels.push(neighbor);
        }
      }
    }

    if (acc.pixelCount >= minPixels) {
      const bboxWidthPx = acc.maxX - acc.minX + 1;
      const bboxHeightPx = acc.maxY - acc.minY + 1;
      components.push({
        label: nextLabel,
        species,
        pixelCount: acc.pixelCount,
        centroidX: acc.sumX / acc.pixelCount,
        centroidY: acc.sumY / acc.pixelCount,
        meanBrightness: acc.sumBrightness / acc.pixelCount,
        meanGreenBias: acc.sumGreenBias / acc.pixelCount,
        meanRedBias: acc.sumRedBias / acc.pixelCount,
        grayFrac: acc.grayPixels / acc.pixelCount,
        vividFrac: acc.vividPixels / acc.pixelCount,
        bboxWidthPx,
        bboxHeightPx,
        bboxAreaPx: bboxWidthPx * bboxHeightPx,
        supportCount: 0,
        supportConfidence: 0,
      });
      nextLabel++;
    } else {
      for (const pixel of componentPixels) {
        labels[pixel] = 0;
      }
    }
  }

  return { labels, components };
}

function attachCandidateSupport(
  image: HiResImageData,
  bbox: number[],
  labels: Int32Array,
  components: RasterComponent[],
  candidates: Array<{ lng: number; lat: number; speciesHint: 'cedar' | 'oak'; confidence: number }>,
  species: 'cedar' | 'oak',
) {
  const byLabel = new Map<number, RasterComponent>(components.map((component) => [component.label, component]));
  const searchRadius = clamp(Math.round(3 / Math.max(0.5, image.metersPerPixel)), 2, 8);

  for (const candidate of candidates) {
    if (candidate.speciesHint !== species) continue;
    const [cx, cy] = lngLatToPixel(image, bbox, candidate.lng, candidate.lat);

    let matchedLabel = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let y = Math.max(0, cy - searchRadius); y <= Math.min(image.height - 1, cy + searchRadius); y++) {
      for (let x = Math.max(0, cx - searchRadius); x <= Math.min(image.width - 1, cx + searchRadius); x++) {
        const label = labels[y * image.width + x];
        if (label === 0) continue;
        const dx = x - cx;
        const dy = y - cy;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          bestDist = dist;
          matchedLabel = label;
        }
      }
    }

    if (matchedLabel === 0) continue;
    const component = byLabel.get(matchedLabel);
    if (!component) continue;
    component.supportCount++;
    component.supportConfidence += candidate.confidence;
  }
}

function componentToDetection(
  image: HiResImageData,
  bbox: number[],
  component: RasterComponent,
): CrownDetection | null {
  const compactness = component.pixelCount / Math.max(component.bboxAreaPx, 1);
  const aspectRatio =
    Math.max(component.bboxWidthPx, component.bboxHeightPx) /
    Math.max(1, Math.min(component.bboxWidthPx, component.bboxHeightPx));
  const areaM2 = component.pixelCount * image.metersPerPixel * image.metersPerPixel;
  const canopyDiameter = clamp(Math.sqrt(Math.max(areaM2, 1) / Math.PI) * 2, 2.2, 18);
  const supportBoost =
    component.supportCount > 0
      ? Math.min(0.18, (component.supportConfidence / component.supportCount) * 0.12 + component.supportCount * 0.015)
      : 0;

  const passesSpeciesCheck =
    component.species === 'cedar'
      ? component.meanGreenBias > -0.005 && component.meanBrightness <= 148 && component.vividFrac > 0.38
      : component.meanBrightness >= 88 && (component.grayFrac > 0.08 || component.meanRedBias > 0.015);
  if (!passesSpeciesCheck) return null;
  if (component.supportCount <= 0) return null;
  if (aspectRatio > (component.species === 'oak' ? 2.8 : 2.4)) return null;
  if (compactness < (component.species === 'oak' ? 0.3 : 0.26)) return null;
  if (canopyDiameter < (component.species === 'oak' ? 4.0 : 2.8)) return null;

  const baseConfidence =
    component.species === 'cedar'
      ? 0.38 + compactness * 0.24 + component.vividFrac * 0.12 + Math.max(component.meanGreenBias, 0) * 1.5
      : 0.36 + compactness * 0.22 + component.grayFrac * 0.16 + Math.max(component.meanRedBias, 0) * 1.4;
  const confidence = clamp(baseConfidence + supportBoost, 0.35, 0.98);
  const [lng, lat] = pixelToLngLat(image, bbox, component.centroidX, component.centroidY);
  const height = clamp(
    (component.species === 'oak' ? 1.18 : 1.65) * canopyDiameter + (component.species === 'oak' ? 3.8 : 2.4),
    2.5,
    22,
  );

  return {
    id: `crown-${Math.round(lng * 1e6)}-${Math.round(lat * 1e6)}`,
    lng,
    lat,
    species: component.species,
    confidence: Math.round(confidence * 100) / 100,
    canopyDiameter: Math.round(canopyDiameter * 10) / 10,
    height: Math.round(height * 10) / 10,
    source: 'hi_res_connected_components',
  };
}

function componentToMaskFeature(
  image: HiResImageData,
  bbox: number[],
  component: RasterComponent,
): GeoJSON.Feature<GeoJSON.Polygon, CrownMaskFeatureProperties> {
  const rx = Math.max(1.2, component.bboxWidthPx / 2);
  const ry = Math.max(1.2, component.bboxHeightPx / 2);
  const ring: GeoJSON.Position[] = [];
  const steps = 18;

  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * Math.PI * 2;
    const px = component.centroidX + Math.cos(theta) * rx;
    const py = component.centroidY + Math.sin(theta) * ry;
    const [lng, lat] = pixelToLngLat(image, bbox, px, py);
    ring.push([lng, lat]);
  }

  const detection = componentToDetection(image, bbox, component);
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: {
      id: `mask-${component.species}-${component.label}`,
      species: component.species,
      confidence: detection?.confidence ?? 0.35,
      supportCount: component.supportCount,
      source: 'hi_res_connected_components',
    },
  };
}

function suppressOverlappingSpecies(detections: CrownDetection[]): CrownDetection[] {
  const kept: CrownDetection[] = [];

  for (const detection of [...detections].sort((a, b) => b.confidence - a.confidence)) {
    const overlaps = kept.some((existing) => {
      const mergeDist = Math.max(2.2, Math.min(detection.canopyDiameter, existing.canopyDiameter) * 0.58);
      return haversineM(detection.lng, detection.lat, existing.lng, existing.lat) <= mergeDist;
    });
    if (!overlaps) kept.push(detection);
  }

  return kept;
}

export function sampleCrownPatch(
  image: HiResImageData,
  bbox: number[],
  lng: number,
  lat: number,
  species: 'cedar' | 'oak',
  profile: CrownCalibrationProfile,
): CrownPatchStats | null {
  const [cx, cy] = lngLatToPixel(image, bbox, lng, lat);
  const targetRadiusM = species === 'oak' ? 5.2 : 3.8;
  const radiusPx = clamp(Math.round(targetRadiusM / Math.max(0.25, image.metersPerPixel)), 3, 16);

  let total = 0;
  let matched = 0;
  let sumBrightness = 0;
  let sumBrightnessSq = 0;
  let sumGreenBias = 0;
  let sumRedBias = 0;
  let sumGray = 0;
  let matchX = 0;
  let matchY = 0;

  for (let y = Math.max(0, cy - radiusPx); y <= Math.min(image.height - 1, cy + radiusPx); y++) {
    for (let x = Math.max(0, cx - radiusPx); x <= Math.min(image.width - 1, cx + radiusPx); x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > radiusPx * radiusPx) continue;

      const idx = (y * image.width + x) * image.channels;
      const r = image.data[idx];
      const g = image.data[idx + 1];
      const b = image.data[idx + 2];
      const brightness = (r + g + b) / 3;
      const spread = Math.max(r, g, b) - Math.min(r, g, b);
      const greenBias = (g - Math.max(r, b)) / Math.max(brightness, 1);
      const redBias = (r - Math.max(g, b)) / Math.max(brightness, 1);
      const grayish = spread < 26 && brightness > 78 && brightness < 190 ? 1 : 0;

      total++;
      sumBrightness += brightness;
      sumBrightnessSq += brightness * brightness;
      sumGreenBias += greenBias;
      sumRedBias += redBias;
      sumGray += grayish;

      if (classifyPatchPixel(r, g, b, species, profile)) {
        matched++;
        matchX += x;
        matchY += y;
      }
    }
  }

  if (total === 0) return null;

  const coverage = matched / total;
  if (coverage < (species === 'cedar' ? profile.cedarCoverageFloor : profile.oakCoverageFloor)) {
    return null;
  }

  const meanBrightness = sumBrightness / total;
  const textureVar = Math.max(0, sumBrightnessSq / total - meanBrightness * meanBrightness) /
    (Math.max(meanBrightness, 1) * Math.max(meanBrightness, 1));
  const centroidX = matched > 0 ? matchX / matched : cx;
  const centroidY = matched > 0 ? matchY / matched : cy;
  const [centroidLng, centroidLat] = pixelToLngLat(image, bbox, centroidX, centroidY);
  const areaM2 = matched * image.metersPerPixel * image.metersPerPixel;
  const diameterM = clamp(Math.sqrt(Math.max(areaM2, 1) / Math.PI) * 2 * 1.12, 2.2, 14);
  return {
    coverage,
    brightness: meanBrightness,
    textureVar,
    greenBias: sumGreenBias / total,
    grayFrac: sumGray / total,
    redBias: sumRedBias / total,
    diameterM,
    centroidLng,
    centroidLat,
  };
}

export function buildCalibrationProfile(
  image: HiResImageData | null,
  bbox: number[],
  examples: CrownCalibrationExample[],
): CrownCalibrationProfile {
  const base: CrownCalibrationProfile = {
    cedarExamples: 0,
    oakExamples: 0,
    cedarCoverageFloor: 0.16,
    cedarGreenBiasFloor: 0.004,
    cedarBrightnessCeil: 126,
    oakCoverageFloor: 0.14,
    oakGrayFloor: 0.17,
    oakBrightnessFloor: 104,
  };

  if (!image || examples.length === 0) return base;

  const cedarStats: CrownPatchStats[] = [];
  const oakStats: CrownPatchStats[] = [];

  for (const example of examples) {
    const stats = sampleCrownPatch(image, bbox, example.lng, example.lat, example.species, base);
    if (!stats) continue;
    if (example.species === 'cedar') cedarStats.push(stats);
    else oakStats.push(stats);
  }

  const avg = (items: CrownPatchStats[], pick: (item: CrownPatchStats) => number, fallback: number) =>
    items.length > 0 ? items.reduce((sum, item) => sum + pick(item), 0) / items.length : fallback;

  return {
    cedarExamples: cedarStats.length,
    oakExamples: oakStats.length,
    cedarCoverageFloor: clamp(avg(cedarStats, (s) => s.coverage * 0.72, base.cedarCoverageFloor), 0.1, 0.32),
    cedarGreenBiasFloor: clamp(avg(cedarStats, (s) => s.greenBias * 0.65, base.cedarGreenBiasFloor), -0.02, 0.06),
    cedarBrightnessCeil: clamp(avg(cedarStats, (s) => s.brightness + 8, base.cedarBrightnessCeil), 96, 145),
    oakCoverageFloor: clamp(avg(oakStats, (s) => s.coverage * 0.68, base.oakCoverageFloor), 0.1, 0.3),
    oakGrayFloor: clamp(avg(oakStats, (s) => s.grayFrac * 0.68, base.oakGrayFloor), 0.08, 0.4),
    oakBrightnessFloor: clamp(avg(oakStats, (s) => s.brightness - 12, base.oakBrightnessFloor), 84, 155),
  };
}

export function segmentCrownsFromCandidates(
  candidates: Array<{ lng: number; lat: number; speciesHint: 'cedar' | 'oak'; confidence: number }>,
  image: HiResImageData | null,
  bbox: number[],
  profile: CrownCalibrationProfile,
): CrownSegmentationResult {
  if (!image) return { crowns: [], maskFeatures: [] };

  const features = computePixelFeatures(image);
  const cedarMask = buildSpeciesMask(image, features, 'cedar', profile);
  const oakMask = buildSpeciesMask(image, features, 'oak', profile);
  const minCedarPixels = clamp(Math.round(6 / Math.max(0.2, image.metersPerPixel * image.metersPerPixel)), 6, 64);
  const minOakPixels = clamp(Math.round(9 / Math.max(0.2, image.metersPerPixel * image.metersPerPixel)), 8, 90);
  const cedar = extractRasterComponents(image, cedarMask, features, 'cedar', minCedarPixels);
  const oak = extractRasterComponents(image, oakMask, features, 'oak', minOakPixels);

  attachCandidateSupport(image, bbox, cedar.labels, cedar.components, candidates, 'cedar');
  attachCandidateSupport(image, bbox, oak.labels, oak.components, candidates, 'oak');

  const validComponents = [...cedar.components, ...oak.components].filter(
    (component) => componentToDetection(image, bbox, component) !== null,
  );
  const detections = validComponents
    .map((component) => componentToDetection(image, bbox, component))
    .filter((item): item is CrownDetection => item !== null);
  const maskFeatures = validComponents.map((component) => componentToMaskFeature(image, bbox, component));

  return {
    crowns: suppressOverlappingSpecies(detections),
    maskFeatures,
  };
}