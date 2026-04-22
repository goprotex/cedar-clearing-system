import { NextRequest, NextResponse } from 'next/server';
import * as turf from '@turf/turf';
import sharp from 'sharp';
import type { SpectralSamplePayload } from '@/lib/cedar-analysis-grid';
import { computeLocalNdviVariance } from '@/lib/spectral-texture';
import { fuseNaipWithTextureAndSentinel } from '@/lib/spectral-fusion';
import { isCentralTexasHillCountry } from '@/lib/spectral-region';
import {
  findSentinelScene,
  sampleNdviFromSceneItem,
  sceneMeta,
} from '@/lib/sentinel-sample-ndvi';
import { CEDAR_GRID_SPACING_KM, CEDAR_GRID_SPACING_M } from '@/lib/cedar-analysis-chunks';

export const maxDuration = 300; // 5 min — thorough spectral analysis

const NAIP_IDENTIFY =
  'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/identify';
const WORLD_IMAGERY_EXPORT =
  'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/export';

/** Smaller batches + retries reduce NAIP rate-limit / transient failures vs 50 parallel requests. */
const BATCH_SIZE = 25;
const NAIP_FETCH_TIMEOUT_MS = 15000;
const NAIP_MAX_ATTEMPTS = 5;
const HI_RES_FETCH_TIMEOUT_MS = 20000;
const HI_RES_MIN_DIM = 512;
const HI_RES_MAX_DIM = 2048;
const HI_RES_TARGET_METERS_PER_PIXEL = 0.6;
// Keep SSE sample events well below proxy/browser payload limits.
const STREAM_SAMPLE_BATCH_SIZE = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

async function fetchNaipIdentifyJson(lng: number, lat: number): Promise<unknown | null> {
  const geom = JSON.stringify({
    x: lng,
    y: lat,
    spatialReference: { wkid: 4326 },
  });
  const url = `${NAIP_IDENTIFY}?geometry=${encodeURIComponent(geom)}&geometryType=esriGeometryPoint&returnGeometry=false&returnCatalogItems=false&f=json`;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= NAIP_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(NAIP_FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        if (isRetryableHttpStatus(res.status) && attempt < NAIP_MAX_ATTEMPTS) {
          await sleep(200 * 2 ** (attempt - 1) + Math.floor(Math.random() * 100));
          continue;
        }
        return null;
      }
      const text = await res.text();
      try {
        return JSON.parse(text) as unknown;
      } catch {
        if (attempt < NAIP_MAX_ATTEMPTS) {
          await sleep(200 * 2 ** (attempt - 1));
          continue;
        }
        return null;
      }
    } catch (e) {
      lastErr = e;
      if (attempt < NAIP_MAX_ATTEMPTS) {
        await sleep(200 * 2 ** (attempt - 1) + Math.floor(Math.random() * 150));
      }
    }
  }
  return null;
}

type VegClass = 'cedar' | 'oak' | 'mixed_brush' | 'grass' | 'bare';

interface BandIndices {
  ndvi: number;   // (NIR-R)/(NIR+R) — vegetation greenness
  gndvi: number;  // (NIR-G)/(NIR+G) — chlorophyll content
  savi: number;   // ((NIR-R)/(NIR+R+0.5))*1.5 — soil-adjusted vegetation
  exg: number;    // 2*G - R - B (normalized) — excess green
  nirRatio: number; // NIR / brightness — canopy density indicator
}

interface SampleResult {
  lng: number;
  lat: number;
  ndvi: number;
  gndvi: number;
  savi: number;
  classification: VegClass;
  confidence: number;
  bandVotes: number; // how many indices agreed on classification (0-4)
  trustScore?: number;
  lowTrust?: boolean;
}

interface HiResWindowStats {
  brightness: number;
  greenBias: number;
  redBias: number;
  chroma: number;
  darkFrac: number;
  grayFrac: number;
  textureVar: number;
}

function summarizeLiveCounts(results: SampleResult[], acreage: number) {
  const totalPoints = results.length;
  const cedarCount = results.filter((r) => r.classification === 'cedar').length;
  const oakCount = results.filter((r) => r.classification === 'oak').length;
  const estimatedCedarAcres = totalPoints > 0
    ? Math.round((cedarCount / totalPoints) * acreage * 10) / 10
    : 0;

  return {
    cedarCount,
    oakCount,
    totalPoints,
    completed: totalPoints,
    estimatedCedarAcres,
  };
}

function toSpectralSamples(results: SampleResult[]): SpectralSamplePayload[] {
  return results.map((s) => ({
    lng: s.lng,
    lat: s.lat,
    ndvi: s.ndvi,
    gndvi: s.gndvi,
    savi: s.savi,
    classification: s.classification,
    confidence: s.confidence,
    bandVotes: s.bandVotes,
    trustScore: s.trustScore,
    lowTrust: s.lowTrust,
  }));
}

function oakCirVotes(
  r: number,
  g: number,
  b: number,
  nir: number,
  brightness: number,
  idx: BandIndices,
): number {
  let oakVotes = 0;
  const ndviBase = Math.max(idx.ndvi, 0.01);
  const deciduousRatio = idx.gndvi / ndviBase;
  const nirOverRed = nir / Math.max(r, 1);
  const redOverGreen = r / Math.max(g, 1);
  const redOverBlue = r / Math.max(b, 1);

  if (nir >= 160) oakVotes++; // bright NIR drives the pink/red CIR oak signature
  if (nir >= 140) oakVotes++;
  if (r >= 88) oakVotes++; // visible red stays elevated for pink/red oak canopy
  if (brightness >= 88) oakVotes++;
  if (deciduousRatio > 0.82) oakVotes++;
  if (nirOverRed < 2.05) oakVotes++; // oak pink keeps visible red closer to NIR than cedar does
  if (redOverGreen > 1.08) oakVotes++;
  if (redOverBlue > 1.0) oakVotes++;

  return oakVotes;
}

// ── Band index computation ──

function computeIndices(r: number, g: number, b: number, nir: number): BandIndices {
  const brightness = (r + g + b) / 3;
  const L = 0.5; // SAVI soil adjustment factor
  return {
    ndvi: (nir + r) > 0 ? (nir - r) / (nir + r) : 0,
    gndvi: (nir + g) > 0 ? (nir - g) / (nir + g) : 0,
    savi: (nir + r + L) > 0 ? ((nir - r) / (nir + r + L)) * (1 + L) : 0,
    exg: brightness > 0 ? (2 * g - r - b) / (r + g + b) : 0,
    nirRatio: brightness > 0 ? nir / brightness : 0,
  };
}

// ── Multi-band classification with cross-verification ──

function classifyVegetation(
  r: number,
  g: number,
  b: number,
  nir: number | null,
  ndvi: number
): { classification: VegClass; confidence: number; bandVotes: number; gndvi: number; savi: number } {
  // RGB-only fallback (no NIR band)
  if (nir === null) {
    const brightness = (r + g + b) / 3;
    if (brightness < 80 && g > r) return { classification: 'cedar', confidence: 0.3, bandVotes: 0, gndvi: 0, savi: 0 };
    if (brightness < 120 && g > b) return { classification: 'mixed_brush', confidence: 0.25, bandVotes: 0, gndvi: 0, savi: 0 };
    if (g > r && g > b) return { classification: 'grass', confidence: 0.3, bandVotes: 0, gndvi: 0, savi: 0 };
    return { classification: 'bare', confidence: 0.35, bandVotes: 0, gndvi: 0, savi: 0 };
  }

  const idx = computeIndices(r, g, b, nir);
  const brightness = (r + g + b) / 3;
  const redGreenRatio = r / Math.max(g, 1);
  const redBlueRatio = r / Math.max(b, 1);
  const oakVotes = oakCirVotes(r, g, b, nir, brightness, idx);
  const pinkOakCir =
    idx.ndvi >= 0.2 &&
    brightness >= 84 &&
    nir >= 140 &&
    r >= 86 &&
    redGreenRatio > 1.06 &&
    redBlueRatio > 1.0 &&
    oakVotes >= 3;
  const highConfidenceOakCir =
    idx.ndvi >= 0.22 &&
    brightness >= 86 &&
    nir >= 150 &&
    r >= 88 &&
    redGreenRatio > 1.06 &&
    oakVotes >= 4;

  if (highConfidenceOakCir) {
    return {
      classification: 'oak',
      confidence: Math.min(0.9, 0.52 + oakVotes * 0.06),
      bandVotes: oakVotes,
      gndvi: idx.gndvi,
      savi: idx.savi,
    };
  }

  if (pinkOakCir) {
    return {
      classification: 'oak',
      confidence: Math.min(0.84, 0.46 + oakVotes * 0.06),
      bandVotes: oakVotes,
      gndvi: idx.gndvi,
      savi: idx.savi,
    };
  }

  // ── Pass 1: Bare ground — must be VERY BRIGHT + low NDVI ──
  // Real bare ground (soil, rock, caliche, roads) has brightness > 120 in NAIP.
  // Cedar canopy & shadow is dark (50-100). Grass can be 100-130.
  if (idx.ndvi < 0.08 && brightness > 120) {
    let votes = 1;
    if (idx.savi < 0.1) votes++;
    if (idx.exg < 0.02) votes++;
    if (idx.gndvi < 0.1) votes++;
    if (nir < 90) votes++; // very low NIR = no vegetation at all
    const conf = Math.min(0.95, 0.7 + votes * 0.05);
    return { classification: 'bare', confidence: conf, bandVotes: votes, gndvi: idx.gndvi, savi: idx.savi };
  }

  // Low NDVI but not very bright → cedar shadow/understory/dark canopy
  // Must be dark (< 100) to avoid catching grass shadows
  if (idx.ndvi < 0.08 && brightness <= 100) {
    let votes = 1;
    if (brightness < 80) votes++;   // very dark = dense cedar shadow
    if (nir > 60) votes++;          // some NIR = vegetation present
    if (r < 80) votes++;            // low red = not bare soil
    const conf = Math.min(0.7, 0.35 + votes * 0.1);
    return { classification: 'cedar', confidence: conf, bandVotes: votes, gndvi: idx.gndvi, savi: idx.savi };
  }

  // Moderate brightness (100-120) with low NDVI → grass/bare transition
  if (idx.ndvi < 0.08) {
    return { classification: 'grass', confidence: 0.45, bandVotes: 1, gndvi: idx.gndvi, savi: idx.savi };
  }

  // ── Pass 2: Low-moderate NDVI (0.08-0.22) ──
  // Cedar canopy/edges produce NDVI 0.08-0.22. Real grass/pasture is brighter.
  if (idx.ndvi >= 0.08 && idx.ndvi < 0.22) {
    // Dark pixel → cedar canopy or edge (must be genuinely dark)
    if (brightness < 95) {
      let votes = 1;
      if (idx.nirRatio > 1.1) votes++; // NIR penetrates shadow/canopy
      if (r < 80) votes++;             // low red = not soil
      if (brightness < 70) votes++;    // very dark = dense canopy
      if (nir > 60) votes++;           // some NIR = vegetation
      const conf = Math.min(0.75, 0.35 + votes * 0.08);
      return { classification: 'cedar', confidence: conf, bandVotes: votes, gndvi: idx.gndvi, savi: idx.savi };
    }
    // Moderate-to-bright pixel with low NDVI → grass/sparse vegetation
    let votes = 1;
    if (idx.savi >= 0.05 && idx.savi < 0.25) votes++;
    if (idx.exg > 0 && idx.exg < 0.15) votes++;
    if (brightness >= 110) votes++;
    const conf = Math.min(0.8, 0.5 + votes * 0.07);
    return { classification: 'grass', confidence: conf, bandVotes: votes, gndvi: idx.gndvi, savi: idx.savi };
  }

  // ── Pass 3: Moderate NDVI (0.22-0.35) — transitional zone ──
  if (idx.ndvi >= 0.22 && idx.ndvi < 0.35) {
    // Cedar vote accumulator for transitional zone
    let cedarVotes = 0;
    if (brightness < 95) cedarVotes++;           // dark canopy
    if (nir < 145) cedarVotes++;                 // cedar has moderate NIR, oak has high NIR
    if (r < 85) cedarVotes++;                    // low red reflectance
    if (idx.gndvi / Math.max(idx.ndvi, 0.01) < 0.90) cedarVotes++; // GNDVI < NDVI → evergreen tendency
    if (idx.savi > 0.18) cedarVotes++;           // soil-adjusted veg present

    const brightTransition = brightness >= 108;
    const pastureLikeTransition =
      brightTransition &&
      idx.exg > 0.05 &&
      idx.savi < 0.32 &&
      (idx.gndvi / Math.max(idx.ndvi, 0.01)) > 0.8;

    // Oak escape hatch FIRST — bright NIR + brightness = oak, not cedar
    if (nir >= 135 && brightness >= 86) {
      if (oakVotes >= 2 || (oakVotes >= 1 && brightness >= 96 && r >= 95)) {
        const conf = Math.min(0.82, 0.38 + oakVotes * 0.08);
        return { classification: 'oak', confidence: conf, bandVotes: oakVotes, gndvi: idx.gndvi, savi: idx.savi };
      }
    }

    if (pastureLikeTransition && cedarVotes <= 2) {
      return {
        classification: 'grass',
        confidence: Math.min(0.78, 0.52 + idx.exg * 0.25 + Math.max(0, brightness - 108) * 0.003),
        bandVotes: Math.max(1, cedarVotes),
        gndvi: idx.gndvi,
        savi: idx.savi,
      };
    }

    // Bright transition pixels need stronger evidence than dark canopy edges.
    const cedarVoteFloor = brightTransition ? 3 : 2;

    if (cedarVotes >= cedarVoteFloor) {
      const conf = Math.min(0.8, 0.35 + cedarVotes * 0.1 + (idx.ndvi - 0.22) * 0.5);
      return { classification: 'cedar', confidence: conf, bandVotes: cedarVotes, gndvi: idx.gndvi, savi: idx.savi };
    }

    // Single cedar vote but dark → still cedar
    if (cedarVotes === 1 && brightness < 90) {
      return { classification: 'cedar', confidence: 0.4, bandVotes: 1, gndvi: idx.gndvi, savi: idx.savi };
    }

    return { classification: 'grass', confidence: 0.5, bandVotes: 1, gndvi: idx.gndvi, savi: idx.savi };
  }

  // ── Pass 4: High NDVI (>= 0.35) — dense vegetation ──
  // CIR signature is the primary discriminator:
  //   Cedar = dark maroon/grey in CIR → moderate NIR (80-150), low brightness
  //   Oak   = bright red/pink in CIR  → high NIR (140+), higher brightness

  // CHECK OAK FIRST — high NIR + bright = deciduous hardwood, not cedar
  if (nir >= 135 && brightness >= 82) {
    // Strong oak signal: 3+ votes with high NIR
    if (oakVotes >= 3 || (oakVotes >= 2 && brightness >= 92 && r >= 90 && redGreenRatio > 1.04)) {
      const conf = Math.min(0.9, 0.42 + oakVotes * 0.07);
      return { classification: 'oak', confidence: conf, bandVotes: oakVotes, gndvi: idx.gndvi, savi: idx.savi };
    }
  }

  // Cedar vote accumulator
  let cedarVotes = 0;
  const totalChecks = 5;

  // Vote 1: Low-to-moderate NIR (cedar's dark maroon CIR signature)
  if (nir < 140) cedarVotes++;

  // Vote 2: Dark canopy (genuinely dark, not just moderate)
  if (brightness < 95) cedarVotes++;

  // Vote 3: GNDVI lower than NDVI → evergreen signature
  if (idx.gndvi > 0.10 && (idx.gndvi / Math.max(idx.ndvi, 0.01)) < 0.85) cedarVotes++;

  // Vote 4: SAVI confirms vegetation even accounting for soil
  if (idx.savi > 0.28) cedarVotes++;

  // Vote 5: Low red reflectance (chlorophyll absorption)
  if (r < 80) cedarVotes++;

  // Cedar classification: need at least 2 of 5 votes
  if (cedarVotes >= 2) {
    const voteRatio = cedarVotes / totalChecks;
    const conf = Math.min(0.95, 0.5 + voteRatio * 0.3 + (idx.ndvi - 0.35) * 0.3);
    return { classification: 'cedar', confidence: conf, bandVotes: cedarVotes, gndvi: idx.gndvi, savi: idx.savi };
  }

  // Remaining high-NDVI pixels with moderate NIR → oak or mixed brush
  if (nir >= 130 && brightness >= 85) {
    return { classification: 'oak', confidence: 0.45, bandVotes: 1, gndvi: idx.gndvi, savi: idx.savi };
  }

  return { classification: 'mixed_brush', confidence: 0.45, bandVotes: 1, gndvi: idx.gndvi, savi: idx.savi };
}

function getClassColor(classification: VegClass, ndvi: number): string {
  switch (classification) {
    case 'cedar':
      if (ndvi > 0.5) return '#dc2626'; // dense
      if (ndvi > 0.4) return '#ea580c'; // moderate
      return '#f97316'; // light
    case 'oak':
      return '#92400e';
    case 'mixed_brush':
      return '#d97706';
    case 'grass':
      return '#65a30d';
    case 'bare':
      return '#9ca3af';
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function hiResImageDimensions(bbox: number[]): {
  width: number;
  height: number;
  metersPerPixel: number;
} {
  const centerLat = (bbox[1] + bbox[3]) / 2;
  const widthM = Math.max(1, (bbox[2] - bbox[0]) * 111_320 * Math.cos((centerLat * Math.PI) / 180));
  const heightM = Math.max(1, (bbox[3] - bbox[1]) * 111_320);
  const width = clamp(Math.round(widthM / HI_RES_TARGET_METERS_PER_PIXEL), HI_RES_MIN_DIM, HI_RES_MAX_DIM);
  const height = clamp(Math.round(heightM / HI_RES_TARGET_METERS_PER_PIXEL), HI_RES_MIN_DIM, HI_RES_MAX_DIM);
  return {
    width,
    height,
    metersPerPixel: Math.max(widthM / width, heightM / height),
  };
}

async function fetchHiResWindowImage(bbox: number[]): Promise<{
  data: Uint8Array;
  width: number;
  height: number;
  channels: number;
  metersPerPixel: number;
} | null> {
  const dims = hiResImageDimensions(bbox);
  const url = `${WORLD_IMAGERY_EXPORT}?bbox=${bbox.join(',')}&bboxSR=4326&imageSR=4326&size=${dims.width},${dims.height}&format=png32&transparent=false&f=image`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(HI_RES_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const raw = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return {
      data: raw.data,
      width: raw.info.width,
      height: raw.info.height,
      channels: raw.info.channels,
      metersPerPixel: dims.metersPerPixel,
    };
  } catch {
    return null;
  }
}

function sampleHiResWindowStats(
  image: { data: Uint8Array; width: number; height: number; channels: number; metersPerPixel: number },
  bbox: number[],
  lng: number,
  lat: number,
): HiResWindowStats | null {
  const xNorm = (lng - bbox[0]) / Math.max(1e-9, bbox[2] - bbox[0]);
  const yNorm = (bbox[3] - lat) / Math.max(1e-9, bbox[3] - bbox[1]);
  const cx = clamp(Math.round(xNorm * (image.width - 1)), 0, image.width - 1);
  const cy = clamp(Math.round(yNorm * (image.height - 1)), 0, image.height - 1);
  const radiusPx = clamp(Math.round(3 / Math.max(0.25, image.metersPerPixel)), 2, 8);

  let count = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumBrightness = 0;
  let sumBrightnessSq = 0;
  let darkCount = 0;
  let grayCount = 0;

  for (let y = Math.max(0, cy - radiusPx); y <= Math.min(image.height - 1, cy + radiusPx); y++) {
    for (let x = Math.max(0, cx - radiusPx); x <= Math.min(image.width - 1, cx + radiusPx); x++) {
      const idx = (y * image.width + x) * image.channels;
      const r = image.data[idx];
      const g = image.data[idx + 1];
      const b = image.data[idx + 2];
      const brightness = (r + g + b) / 3;
      const spread = Math.max(r, g, b) - Math.min(r, g, b);

      count++;
      sumR += r;
      sumG += g;
      sumB += b;
      sumBrightness += brightness;
      sumBrightnessSq += brightness * brightness;
      if (brightness < 105) darkCount++;
      if (spread < 18 && brightness > 85 && brightness < 170) grayCount++;
    }
  }

  if (count === 0) return null;

  const meanR = sumR / count;
  const meanG = sumG / count;
  const meanB = sumB / count;
  const brightness = sumBrightness / count;
  const variance = Math.max(0, sumBrightnessSq / count - brightness * brightness);
  const denom = Math.max(brightness, 1);

  return {
    brightness,
    greenBias: (meanG - Math.max(meanR, meanB)) / denom,
    redBias: (meanR - Math.max(meanG, meanB)) / denom,
    chroma: (Math.max(meanR, meanG, meanB) - Math.min(meanR, meanG, meanB)) / denom,
    darkFrac: darkCount / count,
    grayFrac: grayCount / count,
    textureVar: variance / (denom * denom),
  };
}

function refineWithHiResImagery(
  original: SampleResult,
  hiRes: HiResWindowStats | null,
): Pick<SampleResult, 'classification' | 'confidence'> {
  if (!hiRes) {
    return { classification: original.classification, confidence: original.confidence };
  }

  const strongCedar =
    hiRes.brightness < 118 &&
    hiRes.greenBias > 0.018 &&
    hiRes.darkFrac > 0.16 &&
    hiRes.chroma > 0.07;

  const strongOak =
    hiRes.brightness > 116 &&
    hiRes.grayFrac > 0.26 &&
    hiRes.darkFrac < 0.18 &&
    hiRes.greenBias < 0.02;

  const strongGrass =
    hiRes.brightness > 128 &&
    hiRes.darkFrac < 0.08 &&
    hiRes.greenBias > 0.015 &&
    hiRes.chroma > 0.05;

  const weakCedarInOpenPasture =
    original.classification === 'cedar' &&
    original.bandVotes <= 2 &&
    original.confidence < 0.68;

  const sparseCedar =
    hiRes.brightness < 136 &&
    hiRes.darkFrac > 0.09 &&
    hiRes.textureVar > 0.006 &&
    hiRes.greenBias > 0.006;

  const sparseOak =
    hiRes.brightness > 102 &&
    hiRes.grayFrac > 0.14 &&
    hiRes.textureVar > 0.004 &&
    hiRes.darkFrac < 0.28;

  if (strongCedar) {
    return {
      classification: 'cedar',
      confidence: Math.min(0.96, Math.max(original.confidence, 0.62) + hiRes.darkFrac * 0.18 + hiRes.greenBias),
    };
  }

  if (sparseCedar && ['grass', 'mixed_brush', 'bare'].includes(original.classification)) {
    return {
      classification: 'cedar',
      confidence: Math.min(0.82, Math.max(original.confidence, 0.46) + hiRes.darkFrac * 0.16 + hiRes.textureVar * 4),
    };
  }

  if (strongOak && ['cedar', 'oak', 'mixed_brush'].includes(original.classification)) {
    return {
      classification: 'oak',
      confidence: Math.min(0.92, Math.max(original.confidence, 0.58) + hiRes.grayFrac * 0.16),
    };
  }

  if (sparseOak && ['grass', 'mixed_brush', 'bare', 'cedar'].includes(original.classification)) {
    return {
      classification: 'oak',
      confidence: Math.min(0.78, Math.max(original.confidence, 0.44) + hiRes.grayFrac * 0.12 + hiRes.textureVar * 3),
    };
  }

  if (strongGrass && (['grass', 'mixed_brush', 'bare'].includes(original.classification) || weakCedarInOpenPasture)) {
    return {
      classification: 'grass',
      confidence: Math.min(
        0.88,
        Math.max(weakCedarInOpenPasture ? 0.5 : original.confidence, 0.54) +
          hiRes.greenBias * 0.5,
      ),
    };
  }

  if (
    original.classification === 'cedar' &&
    hiRes.brightness > 130 &&
    hiRes.grayFrac > 0.42 &&
    hiRes.darkFrac < 0.1
  ) {
    return {
      classification: 'oak',
      confidence: Math.min(0.86, Math.max(0.52, original.confidence)),
    };
  }

  return { classification: original.classification, confidence: original.confidence };
}

// ── Overlapping tile consensus ──
// Overlays a grid of 5×5-pixel tiles (75m) at 2-pixel stride (30m) = 60% overlap.
// Each pixel is covered by up to 9 tiles. Tiles vote on classification via
// confidence-weighted consensus; final pixel classification is the weighted
// majority across all covering tiles. This eliminates salt-and-pepper noise
// from single-pixel misclassification without any extra API calls.

function applyTileConsensus(
  results: SampleResult[],
  spacingKm: number,
  bbox: number[],
): { refined: SampleResult[]; tileCount: number; consensusImprovedCells: number } {
  if (results.length < 4) {
    return { refined: results, tileCount: 0, consensusImprovedCells: 0 };
  }

  const centerLat = (bbox[1] + bbox[3]) / 2;
  const kmPerDegLng = 111.32 * Math.cos((centerLat * Math.PI) / 180);
  const kmPerDegLat = 111.32;
  const spacingLng = spacingKm / kmPerDegLng;
  const spacingLat = spacingKm / kmPerDegLat;

  const minLng = bbox[0];
  const minLat = bbox[1];

  interface IndexedResult extends SampleResult {
    col: number;
    row: number;
    originalIdx: number;
  }

  const indexed: IndexedResult[] = results.map((r, i) => ({
    ...r,
    col: Math.round((r.lng - minLng) / spacingLng),
    row: Math.round((r.lat - minLat) / spacingLat),
    originalIdx: i,
  }));

  const gridMap = new Map<string, IndexedResult>();
  let maxCol = 0;
  let maxRow = 0;
  for (const ir of indexed) {
    gridMap.set(`${ir.col},${ir.row}`, ir);
    if (ir.col > maxCol) maxCol = ir.col;
    if (ir.row > maxRow) maxRow = ir.row;
  }

  const tileRadius = 2; // 5×5 tile: center ± 2
  const stride = 2;     // 60% overlap: (5 - 2) / 5 = 0.6

  const pixelVotes: Array<Array<{ classification: VegClass; weight: number }>> =
    results.map(() => []);

  let tileCount = 0;

  for (let tc = 0; tc <= maxCol; tc += stride) {
    for (let tr = 0; tr <= maxRow; tr += stride) {
      const tilePixels: IndexedResult[] = [];
      for (let dc = -tileRadius; dc <= tileRadius; dc++) {
        for (let dr = -tileRadius; dr <= tileRadius; dr++) {
          const px = gridMap.get(`${tc + dc},${tr + dr}`);
          if (px) tilePixels.push(px);
        }
      }

      if (tilePixels.length < 2) continue;
      tileCount++;

      const classWeight: Record<VegClass, number> = {
        cedar: 0, oak: 0, mixed_brush: 0, grass: 0, bare: 0,
      };
      for (const px of tilePixels) {
        classWeight[px.classification] += px.confidence * (1 + px.bandVotes * 0.2);
      }

      let winner: VegClass = 'bare';
      let maxW = -1;
      for (const cls of Object.keys(classWeight) as VegClass[]) {
        if (classWeight[cls] > maxW) {
          maxW = classWeight[cls];
          winner = cls;
        }
      }

      const agreeing = tilePixels.filter((p) => p.classification === winner).length;
      const agreement = agreeing / tilePixels.length;
      const agreeConf =
        tilePixels
          .filter((p) => p.classification === winner)
          .reduce((s, p) => s + p.confidence, 0) / agreeing;

      const voteWeight = agreeConf * agreement;
      for (const px of tilePixels) {
        pixelVotes[px.originalIdx].push({ classification: winner, weight: voteWeight });
      }
    }
  }

  let consensusImprovedCells = 0;
  const refined = results.map((original, idx) => {
    const votes = pixelVotes[idx];
    if (votes.length === 0) return original;

    const cw: Record<VegClass, number> = {
      cedar: 0, oak: 0, mixed_brush: 0, grass: 0, bare: 0,
    };
    for (const v of votes) {
      cw[v.classification] += v.weight;
    }

    let bestClass: VegClass = original.classification;
    let bestWeight = -1;
    for (const cls of Object.keys(cw) as VegClass[]) {
      if (cw[cls] > bestWeight) {
        bestWeight = cw[cls];
        bestClass = cls;
      }
    }

    const totalWeight = Object.values(cw).reduce((a, b) => a + b, 0);
    const winFraction = totalWeight > 0 ? bestWeight / totalWeight : 0;

    const originalWoody =
      original.classification === 'cedar' ||
      original.classification === 'oak' ||
      original.classification === 'mixed_brush';
    const preserveIsolatedWoody =
      originalWoody &&
      (original.bandVotes >= 3 || original.confidence >= 0.62);

    if (preserveIsolatedWoody && (bestClass === 'grass' || bestClass === 'bare')) {
      return {
        ...original,
        confidence: Math.round(Math.min(0.95, original.confidence + winFraction * 0.05) * 100) / 100,
      };
    }

    if (bestClass !== original.classification) {
      consensusImprovedCells++;
      const newConf = Math.min(0.95, original.confidence * 0.3 + winFraction * 0.7);
      return { ...original, classification: bestClass, confidence: Math.round(newConf * 100) / 100 };
    }

    const boostedConf = Math.min(0.95, original.confidence + winFraction * 0.15);
    return { ...original, confidence: Math.round(boostedConf * 100) / 100 };
  });

  return { refined, tileCount, consensusImprovedCells };
}

// ── API handler ──

function isValidClipBbox(b: unknown): b is [number, number, number, number] {
  return (
    Array.isArray(b) &&
    b.length === 4 &&
    b.every((x) => typeof x === 'number' && Number.isFinite(x)) &&
    b[0] < b[2] &&
    b[1] < b[3]
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { coordinates, acreage, clipBbox } = body;

    if (!coordinates || !Array.isArray(coordinates) || coordinates.length === 0) {
      return NextResponse.json({ error: 'Polygon coordinates required' }, { status: 400 });
    }

    const polygon = turf.polygon(coordinates);
    const bbox = turf.bbox(polygon);
    const ac = acreage || turf.area(polygon) / 4047;

    let gridBbox = bbox;
    if (clipBbox !== undefined && clipBbox !== null) {
      if (!isValidClipBbox(clipBbox)) {
        return NextResponse.json({ error: 'clipBbox must be [minLng, minLat, maxLng, maxLat]' }, { status: 400 });
      }
      const clipped = turf.bboxClip(polygon, clipBbox);
      if (!clipped || turf.area(clipped) <= 0) {
        return NextResponse.json(
          { error: 'clipBbox does not overlap the pasture polygon' },
          { status: 400 }
        );
      }
      gridBbox = turf.bbox(clipped);
    }

    // 45m uniform grid — coarser wall-to-wall coverage for faster, broader analysis
    const spacingKm = CEDAR_GRID_SPACING_KM;

    const grid = turf.pointGrid(gridBbox, spacingKm, { units: 'kilometers' });
    const pointsInPoly = grid.features.filter((pt) =>
      turf.booleanPointInPolygon(pt, polygon)
    );

    // Use all points — 45m grid keeps coverage broad while cutting request volume substantially
    const samplePoints = pointsInPoly;

    if (samplePoints.length === 0) {
      return NextResponse.json(
        { error: 'No sample points generated. Polygon may be too small.' },
        { status: 400 }
      );
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const push = (event: string, payload: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
        };

        try {
          push('progress', {
            phase: 'grid',
            message: 'Building analyzer grid',
            detail: `${samplePoints.length} cells queued for this pasture`,
            pct: 2,
            completed: 0,
            totalPoints: samplePoints.length,
            cedarCount: 0,
            oakCount: 0,
            estimatedCedarAcres: 0,
          });

          const results: SampleResult[] = [];

          for (let i = 0; i < samplePoints.length; i += BATCH_SIZE) {
            const batch = samplePoints.slice(i, i + BATCH_SIZE);
            const batchResults = await Promise.all(
              batch.map(async (pt): Promise<SampleResult | null> => {
                const [lng, lat] = pt.geometry.coordinates;
                try {
                  const data = (await fetchNaipIdentifyJson(lng, lat)) as { value?: string } | null;
                  if (!data) return null;
                  const pixelStr: string = data?.value || '';

                  if (!pixelStr || pixelStr === 'NoData') {
                    return { lng, lat, ndvi: 0, gndvi: 0, savi: 0, classification: 'bare', confidence: 0.3, bandVotes: 0 };
                  }

                  const vals = pixelStr
                    .split(/[\s,]+/)
                    .map(Number)
                    .filter((n) => !isNaN(n));
                  if (vals.length < 3) return null;

                  const [r, g, b] = vals;
                  const nir = vals.length >= 4 ? vals[3] : null;

                  let ndvi = 0;
                  if (nir !== null && nir + r > 0) {
                    ndvi = (nir - r) / (nir + r);
                  }

                  const { classification, confidence, bandVotes, gndvi, savi } = classifyVegetation(r, g, b, nir, ndvi);
                  return { lng, lat, ndvi, gndvi, savi, classification, confidence, bandVotes };
                } catch {
                  return null;
                }
              })
            );

            results.push(...batchResults.filter((r): r is SampleResult => r !== null));

            const preview = summarizeLiveCounts(results, ac);
            push('progress', {
              phase: 'sampling',
              message: 'Sampling CIR cells',
              detail: `Batch ${Math.min(samplePoints.length, i + BATCH_SIZE)}/${samplePoints.length} cells classified`,
              pct: Math.round(8 + (results.length / Math.max(samplePoints.length, 1)) * 32),
              ...preview,
            });
          }

          if (results.length === 0) {
            push('error', { message: 'No NAIP data available for this area' });
            controller.close();
            return;
          }

          const textureNdviVar = computeLocalNdviVariance(
            results.map((r) => ({ lng: r.lng, lat: r.lat, ndvi: r.ndvi })),
            gridBbox,
            spacingKm,
          );

          const now = new Date();
          const year = now.getFullYear();
          const winterRange = `${year - 2}-12-01/${year}-02-28`;
          const summerRange = `${year - 2}-06-01/${year - 1}-08-31`;
          const samplePointFeatures = results.map((r) =>
            turf.point([r.lng, r.lat]) as GeoJSON.Feature<GeoJSON.Point>
          );

          push('progress', {
            phase: 'sentinel',
            message: 'Fetching seasonal scenes',
            detail: 'Sampling winter and summer Sentinel-2 cues across all cells',
            pct: 45,
            ...summarizeLiveCounts(results, ac),
          });

          const [winterScene, summerScene] = await Promise.all([
            findSentinelScene(gridBbox, winterRange, 30),
            findSentinelScene(gridBbox, summerRange, 30),
          ]);

          const [winterSample, summerSample] = await Promise.all([
            winterScene ? sampleNdviFromSceneItem(winterScene, samplePointFeatures, gridBbox) : Promise.resolve(null),
            summerScene ? sampleNdviFromSceneItem(summerScene, samplePointFeatures, gridBbox) : Promise.resolve(null),
          ]);

          const hiResImage = await fetchHiResWindowImage(gridBbox);

          const winterValues = winterSample?.values ?? new Array(results.length).fill(null);
          const summerValues = summerSample?.values ?? new Array(results.length).fill(null);
          const hillCountry = isCentralTexasHillCountry(gridBbox);

          const fusedResults: SampleResult[] = results.map((result, index) => {
            const fused = fuseNaipWithTextureAndSentinel(
              result.classification,
              result.confidence,
              textureNdviVar[index] ?? 0,
              winterValues[index] ?? null,
              summerValues[index] ?? null,
              { hillCountry },
            );

            return {
              ...result,
              classification: fused.classification as VegClass,
              confidence: fused.confidence,
              trustScore: fused.trustScore,
              lowTrust: fused.lowTrust,
            };
          });

          push('progress', {
            phase: 'classify',
            message: 'Fusing seasonal and texture cues',
            detail: 'Stage 1 complete across the full cell set',
            pct: 60,
            ...summarizeLiveCounts(fusedResults, ac),
          });

          const hiResStats = fusedResults.map((result) =>
            hiResImage ? sampleHiResWindowStats(hiResImage, gridBbox, result.lng, result.lat) : null,
          );

          const hiResRefinedResults: SampleResult[] = fusedResults.map((result, index) => {
            const hiResRefined = refineWithHiResImagery(result, hiResStats[index]);
            return {
              ...result,
              classification: hiResRefined.classification,
              confidence: hiResRefined.confidence,
            };
          });

          push('progress', {
            phase: 'refining',
            message: 'Applying hi-res imagery refinement',
            detail: 'Stage 2 complete across the full cell set',
            pct: 75,
            ...summarizeLiveCounts(hiResRefinedResults, ac),
          });

          const {
            refined: consensusResults,
            tileCount,
            consensusImprovedCells,
          } = applyTileConsensus(hiResRefinedResults, spacingKm, gridBbox);

          const centerLat = (gridBbox[1] + gridBbox[3]) / 2;
          const halfLngDeg = spacingKm / 2 / (111.32 * Math.cos((centerLat * Math.PI) / 180));
          const halfLatDeg = spacingKm / 2 / 111.32;

          push('progress', {
            phase: 'consensus',
            message: 'Running consensus smoothing',
            detail: 'Stage 3 complete across the full cell set',
            pct: 88,
            ...summarizeLiveCounts(consensusResults, ac),
          });

          const total = consensusResults.length;
          const cedarCount = consensusResults.filter((r) => r.classification === 'cedar').length;
          const oakCount = consensusResults.filter((r) => r.classification === 'oak').length;
          const mixedCount = consensusResults.filter((r) => r.classification === 'mixed_brush').length;
          const grassCount = consensusResults.filter((r) => r.classification === 'grass').length;
          const bareCount = consensusResults.filter((r) => r.classification === 'bare').length;

          const cedarPct = total > 0 ? cedarCount / total : 0;
          const avgNdvi = consensusResults.reduce((sum, r) => sum + r.ndvi, 0) / total;
          const avgConf = consensusResults.reduce((sum, r) => sum + r.confidence, 0) / total;
          const avgBandVotes = consensusResults.reduce((sum, r) => sum + r.bandVotes, 0) / total;
          const avgGndvi = consensusResults.reduce((sum, r) => sum + r.gndvi, 0) / total;
          const avgSavi = consensusResults.reduce((sum, r) => sum + r.savi, 0) / total;
          const highConfCedar = consensusResults.filter((r) => r.classification === 'cedar' && r.bandVotes >= 3).length;
          const lowTrustCount = consensusResults.filter((r) => r.lowTrust).length;
          const pairedSamples = consensusResults.filter(
            (_, index) => winterValues[index] !== null && summerValues[index] !== null,
          ).length;

          const summary = {
            totalSamples: total,
            cedar: { count: cedarCount, pct: Math.round(cedarPct * 100) },
            oak: { count: oakCount, pct: total > 0 ? Math.round((oakCount / total) * 100) : 0 },
            mixedBrush: { count: mixedCount, pct: total > 0 ? Math.round((mixedCount / total) * 100) : 0 },
            grass: { count: grassCount, pct: total > 0 ? Math.round((grassCount / total) * 100) : 0 },
            bare: { count: bareCount, pct: total > 0 ? Math.round((bareCount / total) * 100) : 0 },
            estimatedCedarAcres: Math.round(cedarPct * ac * 10) / 10,
            averageNDVI: Math.round(avgNdvi * 1000) / 1000,
            averageGNDVI: Math.round(avgGndvi * 1000) / 1000,
            averageSAVI: Math.round(avgSavi * 1000) / 1000,
            confidence: Math.round(avgConf * 100),
            avgBandVotes: Math.round(avgBandVotes * 10) / 10,
            highConfidenceCedarCells: highConfCedar,
            gridSpacingM: CEDAR_GRID_SPACING_M,
            cellHalfLngDeg: halfLngDeg,
            cellHalfLatDeg: halfLatDeg,
            lowTrustCells: lowTrustCount,
            lowTrustPct: total > 0 ? Math.round((lowTrustCount / total) * 100) : 0,
            hiResImagery: {
              used: Boolean(hiResImage),
              source: 'esri-world-imagery',
            },
            tileConsensus: {
              tileCount,
              tileOverlapPct: 60,
              tileSizePixels: 5,
              tileSizeM: Math.round(CEDAR_GRID_SPACING_M * 5),
              stridePixels: 2,
              strideM: Math.round(CEDAR_GRID_SPACING_M * 2),
              consensusImprovedCells,
              consensusImprovedPct: total > 0 ? Math.round((consensusImprovedCells / total) * 100) : 0,
            },
            sentinelFusion: {
              used: Boolean(winterSample || summerSample),
              pairedSamples,
              winterDate: winterScene ? sceneMeta(winterScene).datetime : undefined,
              summerDate: summerScene ? sceneMeta(summerScene).datetime : undefined,
              winterSceneId: winterScene?.id,
              summerSceneId: summerScene?.id,
            },
          };

          push('progress', {
            phase: 'building',
            message: 'Packaging final cedar result',
            detail: 'Streaming analysis result back to the client',
            pct: 96,
            cedarCount,
            oakCount,
            estimatedCedarAcres: summary.estimatedCedarAcres,
            totalPoints: total,
            completed: total,
          });

          const compactSamples = toSpectralSamples(consensusResults);
          const totalBatches = Math.max(1, Math.ceil(compactSamples.length / STREAM_SAMPLE_BATCH_SIZE));
          push('result_summary', { summary, totalBatches });
          await sleep(0);

          for (let i = 0; i < compactSamples.length; i += STREAM_SAMPLE_BATCH_SIZE) {
            const batchIndex = Math.floor(i / STREAM_SAMPLE_BATCH_SIZE);
            push('result_samples', {
              samples: compactSamples.slice(i, i + STREAM_SAMPLE_BATCH_SIZE),
              batchIndex,
              totalBatches,
            });
            if (batchIndex % 4 === 3) {
              await sleep(0);
            }
          }

          push('result_done', { totalSamples: compactSamples.length, totalBatches });
          await sleep(0);
          controller.close();
        } catch (err) {
          push('error', {
            message: err instanceof Error ? err.message : 'Unknown analysis error',
          });
          controller.close();
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: 'Analysis failed',
        detail: err instanceof Error ? err.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
