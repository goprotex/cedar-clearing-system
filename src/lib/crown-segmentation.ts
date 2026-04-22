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
  aspectRatio: number;
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

function crownPatchToDetection(
  image: HiResImageData,
  bbox: number[],
  species: 'cedar' | 'oak',
  stats: CrownPatchStats,
  candidateConfidence: number,
): CrownDetection {
  const crownId = `crown-${species}-${Math.round(stats.centroidLng * 1e6)}-${Math.round(stats.centroidLat * 1e6)}`;
  const baseConfidence =
    species === 'cedar'
      ? 0.34 + stats.coverage * 0.34 + Math.max(stats.greenBias, 0) * 1.2 - stats.textureVar * 0.12
      : 0.34 + stats.coverage * 0.3 + Math.max(stats.redBias, 0) * 1.5 + stats.grayFrac * 0.12;
  const confidence = clamp(baseConfidence + candidateConfidence * 0.18, 0.35, 0.96);
  const height = clamp(
    (species === 'oak' ? 1.18 : 1.65) * stats.diameterM + (species === 'oak' ? 3.8 : 2.4),
    2.5,
    22,
  );

  return {
    id: crownId,
    lng: stats.centroidLng,
    lat: stats.centroidLat,
    species,
    confidence: Math.round(confidence * 100) / 100,
    canopyDiameter: Math.round(stats.diameterM * 10) / 10,
    height: Math.round(height * 10) / 10,
    source: 'hi_res_candidate_patch',
  };
}

function crownPatchToMaskFeature(
  image: HiResImageData,
  bbox: number[],
  species: 'cedar' | 'oak',
  stats: CrownPatchStats,
  confidence: number,
): GeoJSON.Feature<GeoJSON.Polygon, CrownMaskFeatureProperties> {
  const crownId = `crown-${species}-${Math.round(stats.centroidLng * 1e6)}-${Math.round(stats.centroidLat * 1e6)}`;
  const [cx, cy] = lngLatToPixel(image, bbox, stats.centroidLng, stats.centroidLat);
  const radiusPx = Math.max(1.2, (stats.diameterM / 2) / Math.max(0.25, image.metersPerPixel));
  const rx = radiusPx;
  const ry = radiusPx;
  const ring: GeoJSON.Position[] = [];
  const steps = 18;

  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * Math.PI * 2;
    const px = cx + Math.cos(theta) * rx;
    const py = cy + Math.sin(theta) * ry;
    const [lng, lat] = pixelToLngLat(image, bbox, px, py);
    ring.push([lng, lat]);
  }

  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: {
      id: crownId,
      species,
      confidence,
      supportCount: 1,
      source: 'hi_res_candidate_patch',
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
  let matchXX = 0;
  let matchYY = 0;
  let matchXY = 0;

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
        matchXX += x * x;
        matchYY += y * y;
        matchXY += x * y;
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
  const varX = matched > 0 ? Math.max(0, matchXX / matched - centroidX * centroidX) : 0;
  const varY = matched > 0 ? Math.max(0, matchYY / matched - centroidY * centroidY) : 0;
  const covXY = matched > 0 ? matchXY / matched - centroidX * centroidY : 0;
  const trace = varX + varY;
  const det = Math.max(0, varX * varY - covXY * covXY);
  const root = Math.sqrt(Math.max(0, trace * trace - 4 * det));
  const majorAxis = Math.max((trace + root) / 2, 0.05);
  const minorAxis = Math.max((trace - root) / 2, 0.05);
  const aspectRatio = Math.sqrt(majorAxis / minorAxis);
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
    aspectRatio,
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

  const patchDetections: CrownDetection[] = [];
  const patchMasks: GeoJSON.Feature<GeoJSON.Polygon, CrownMaskFeatureProperties>[] = [];

  for (const candidate of candidates) {
    const stats = sampleCrownPatch(image, bbox, candidate.lng, candidate.lat, candidate.speciesHint, profile);
    if (!stats) continue;

    const minDiameterM = candidate.speciesHint === 'oak' ? 3.6 : 2.4;
    const maxTextureVar = candidate.speciesHint === 'oak' ? 0.075 : 0.09;
    const maxAspectRatio = candidate.speciesHint === 'oak' ? 1.85 : 1.65;
    if (stats.diameterM < minDiameterM) continue;
    if (stats.textureVar > maxTextureVar) continue;
    if (stats.aspectRatio > maxAspectRatio) continue;

    const detection = crownPatchToDetection(image, bbox, candidate.speciesHint, stats, candidate.confidence);
    patchDetections.push(detection);
    patchMasks.push(crownPatchToMaskFeature(image, bbox, candidate.speciesHint, stats, detection.confidence));
  }

  const crowns = suppressOverlappingSpecies(patchDetections);
  const keptIds = new Set(crowns.map((crown) => crown.id));
  const maskFeatures = patchMasks.filter((feature) => {
    const props = feature.properties;
    return typeof props?.id === 'string' && keptIds.has(props.id);
  });

  return {
    crowns,
    maskFeatures,
  };
}