/**
 * Rich crown features from a single NAIP CIR export (bandIds 3,0,1 → PNG R=NIR, G=Red, B=Green).
 * No extra API calls: spectral indices, texture, bbox, local NDVI context (~20 m), and cast-shadow asymmetry.
 */

import { vegetationMask } from '@/lib/cir-object-detect';

const EPS = 1e-6;

export interface CirBlobFeatures {
  centroidXPx: number;
  centroidYPx: number;
  pixelCount: number;
  /** 0–1 reflectance proxies from 8-bit */
  meanNir: number;
  meanRed: number;
  meanGreen: number;
  ndvi: number;
  gndvi: number;
  savi: number;
  excessGreen: number;
  /** Std dev of NDVI inside the crown (texture) */
  ndviStd: number;
  /** max(width,height)/min(width,height) of axis-aligned bbox in pixels, ≥ 1 */
  aspectRatio: number;
  /** Mean NDVI of the ~20 m grid cell containing the centroid */
  cellNdvi20m: number;
  /** crown NDVI − cellNdvi20m (positive → brighter than local neighborhood) */
  isolationVs20m: number;
  /**
   * Cast-shadow asymmetry: spread of mean luminance across N/E/S/W bands outside the bbox.
   * Trees often show one much darker side (shadow); turf stays symmetric (~0). ~0…1.
   */
  shadowSideContrast: number;
}

export interface CirFeatureExtractOptions {
  minPixels?: number;
  maxPixelFrac?: number;
  /** Ground size of the coarse NDVI grid cell (meters). Default 20. */
  contextCellM?: number;
}

const DEFAULT_EXTRACT = {
  minPixels: 6,
  maxPixelFrac: 0.12,
  contextCellM: 20,
};

/** Per-pixel reflectance proxies; NAIP CIR export maps NIR,Red,Green → R,G,B. */
export function cirRgbToReflectance(r255: number, g255: number, b255: number) {
  return {
    nir: r255 / 255,
    red: g255 / 255,
    green: b255 / 255,
  };
}

export function spectralIndices(nir: number, red: number, green: number) {
  const ndvi = (nir - red) / (nir + red + EPS);
  const gndvi = (nir - green) / (nir + green + EPS);
  const L = 0.5;
  const savi = ((nir - red) / (nir + red + L + EPS)) * (1 + L);
  const excessGreen = 2 * green - red - nir;
  return { ndvi, gndvi, savi, excessGreen };
}

function cellPxForMeters(mPerPx: number, meters: number): number {
  return Math.max(1, Math.round(meters / Math.max(mPerPx, 0.01)));
}

function buildMeanNdviGrid(
  ndvi: Float32Array,
  w: number,
  h: number,
  cellPx: number
): { mean: Float32Array; gw: number; gh: number; cellPx: number } {
  const gw = Math.ceil(w / cellPx);
  const gh = Math.ceil(h / cellPx);
  const sum = new Float32Array(gw * gh);
  const cnt = new Uint32Array(gw * gh);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const iy = Math.min(gh - 1, Math.floor(y / cellPx));
    for (let x = 0; x < w; x++) {
      const i = row + x;
      const ix = Math.min(gw - 1, Math.floor(x / cellPx));
      const gi = iy * gw + ix;
      sum[gi] += ndvi[i];
      cnt[gi]++;
    }
  }
  const mean = new Float32Array(gw * gh);
  for (let i = 0; i < mean.length; i++) {
    mean[i] = cnt[i] > 0 ? sum[i] / cnt[i] : 0;
  }
  return { mean, gw, gh, cellPx };
}

function sampleGrid(
  px: number,
  py: number,
  grid: Float32Array,
  gw: number,
  gh: number,
  cellPx: number
): number {
  const ix = Math.min(gw - 1, Math.max(0, Math.floor(px / cellPx)));
  const iy = Math.min(gh - 1, Math.max(0, Math.floor(py / cellPx)));
  return grid[iy * gw + ix];
}

/** Display luminance 0…1 — shadows read dark in all bands. */
function lum01(data: Uint8ClampedArray, i: number): number {
  const p = i * 4;
  const r = data[p];
  const g = data[p + 1];
  const b = data[p + 2];
  return (r + g + b) / (3 * 255);
}

/**
 * Mean luminance in axis-aligned bands just outside the blob bbox (N/E/S/W), excluding blob pixels.
 * Returns (max−min) of the four means — strong when one side is much darker (cast shadow).
 */
function shadowContrastFourSides(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  blobSet: Set<number>
): number {
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const depth = Math.max(4, Math.min(28, Math.round(Math.min(bw, bh) * 0.28)));
  const xPad = Math.max(2, Math.min(12, Math.round(bw * 0.15)));

  const means: number[] = [];

  const sampleBand = (x0: number, y0: number, x1: number, y1: number) => {
    let s = 0;
    let n = 0;
    const xa = Math.max(0, Math.min(width - 1, Math.min(x0, x1)));
    const xb = Math.max(0, Math.min(width - 1, Math.max(x0, x1)));
    const ya = Math.max(0, Math.min(height - 1, Math.min(y0, y1)));
    const yb = Math.max(0, Math.min(height - 1, Math.max(y0, y1)));
    if (xa > xb || ya > yb) return;
    for (let y = ya; y <= yb; y++) {
      const row = y * width;
      for (let x = xa; x <= xb; x++) {
        const i = row + x;
        if (blobSet.has(i)) continue;
        s += lum01(data, i);
        n++;
      }
    }
    if (n >= 2) means.push(s / n);
  };

  // Image y increases downward; smaller y = north in typical north-up NAIP exports.
  sampleBand(minX - xPad, minY - depth, maxX + xPad, minY - 1);
  sampleBand(minX - xPad, maxY + 1, maxX + xPad, maxY + depth);
  sampleBand(minX - depth, minY - xPad, minX - 1, maxY + xPad);
  sampleBand(maxX + 1, minY - xPad, maxX + depth, maxY + xPad);

  if (means.length < 2) return 0;
  let lo = means[0];
  let hi = means[0];
  for (const m of means) {
    if (m < lo) lo = m;
    if (m > hi) hi = m;
  }
  const raw = hi - lo;
  return Math.max(0, Math.min(1, raw / Math.max(0.12, hi + 1e-6)));
}

type Accum = {
  sumX: number;
  sumY: number;
  count: number;
  sumR: number;
  sumG: number;
  sumB: number;
  sumNdvi: number;
  sumNdviSq: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

function bboxOfIndices(indices: number[], width: number): { bw: number; bh: number } {
  let minX = Infinity;
  let maxX = 0;
  let minY = Infinity;
  let maxY = 0;
  for (const i of indices) {
    const x = i % width;
    const y = (i / width) | 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { bw: maxX - minX + 1, bh: maxY - minY + 1 };
}

/** How many spatial clusters to try inside one merged 8-connected blob (tight cedar thickets). */
function estimateClusterK(pixelCount: number, bw: number, bh: number, mPerPx: number, minPx: number): number {
  const maxDm = Math.max(bw, bh) * mPerPx;
  const crownM = 3.9;
  if (pixelCount < 68) return 1;
  if (pixelCount < minPx * 2.4 && maxDm < crownM * 1.25) return 1;
  const bySpan = Math.max(1, Math.round(maxDm / crownM));
  const areaM2 = pixelCount * mPerPx * mPerPx;
  const byArea = Math.max(1, Math.round(areaM2 / (Math.PI * (crownM / 2) ** 2)));
  const k = Math.round(Math.min(bySpan * bySpan * 0.38 + 1, byArea * 0.85));
  return Math.max(2, Math.min(24, k));
}

/**
 * Split merged mask component into ~one feature per crown using k-means on (x,y),
 * seeded from high-NDVI pixels so dark maroon clusters still get multiple centers.
 */
function kmeansSplitBlobPixels(
  blobPixels: number[],
  ndvi: Float32Array,
  width: number,
  k: number,
  minCluster: number
): number[][] {
  const nPts = blobPixels.length;
  if (k <= 1 || nPts < minCluster * 2) return [blobPixels];

  type Pt = { idx: number; x: number; y: number; nd: number };
  const pts: Pt[] = blobPixels.map((i) => ({
    idx: i,
    x: i % width,
    y: (i / width) | 0,
    nd: ndvi[i],
  }));

  const minSeedDistSq = 12; // px — separate nearby crown peaks in a thicket
  const sorted = [...pts].sort((a, b) => b.nd - a.nd);
  const seeds: { x: number; y: number }[] = [];
  for (const p of sorted) {
    if (seeds.length >= k) break;
    if (seeds.every((s) => (s.x - p.x) ** 2 + (s.y - p.y) ** 2 >= minSeedDistSq)) {
      seeds.push({ x: p.x, y: p.y });
    }
  }
  let s = 0;
  while (seeds.length < k && s < nPts * 2) {
    const p = pts[s % nPts];
    s++;
    if (seeds.every((c) => (c.x - p.x) ** 2 + (c.y - p.y) ** 2 >= 6)) seeds.push({ x: p.x, y: p.y });
  }
  if (seeds.length < 2) return [blobPixels];

  const useK = seeds.length;
  const cx = seeds.map((c) => c.x);
  const cy = seeds.map((c) => c.y);
  const label = new Int16Array(nPts);

  for (let it = 0; it < 14; it++) {
    for (let j = 0; j < nPts; j++) {
      const { x, y } = pts[j];
      let best = 0;
      let bestD = (x - cx[0]) ** 2 + (y - cy[0]) ** 2;
      for (let c = 1; c < useK; c++) {
        const d = (x - cx[c]) ** 2 + (y - cy[c]) ** 2;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      label[j] = best;
    }
    const sx = new Float64Array(useK);
    const sy = new Float64Array(useK);
    const cnt = new Int32Array(useK);
    for (let j = 0; j < nPts; j++) {
      const c = label[j];
      sx[c] += pts[j].x;
      sy[c] += pts[j].y;
      cnt[c]++;
    }
    for (let c = 0; c < useK; c++) {
      if (cnt[c] > 0) {
        cx[c] = sx[c] / cnt[c];
        cy[c] = sy[c] / cnt[c];
      }
    }
  }

  const groups: number[][] = Array.from({ length: useK }, () => []);
  for (let j = 0; j < nPts; j++) {
    groups[label[j]].push(pts[j].idx);
  }
  const valid = groups.filter((g) => g.length >= minCluster);
  return valid.length > 0 ? valid : [blobPixels];
}

function accumulateFromIndices(indices: number[], data: Uint8ClampedArray, ndvi: Float32Array, width: number): Accum {
  const acc: Accum = {
    sumX: 0,
    sumY: 0,
    count: 0,
    sumR: 0,
    sumG: 0,
    sumB: 0,
    sumNdvi: 0,
    sumNdviSq: 0,
    minX: width,
    maxX: 0,
    minY: Infinity,
    maxY: 0,
  };
  for (const cur of indices) {
    const x = cur % width;
    const y = (cur / width) | 0;
    const p = cur * 4;
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    acc.sumX += x;
    acc.sumY += y;
    acc.count++;
    acc.sumR += r;
    acc.sumG += g;
    acc.sumB += b;
    const nv = ndvi[cur];
    acc.sumNdvi += nv;
    acc.sumNdviSq += nv * nv;
    if (x < acc.minX) acc.minX = x;
    if (x > acc.maxX) acc.maxX = x;
    if (y < acc.minY) acc.minY = y;
    if (y > acc.maxY) acc.maxY = y;
  }
  return acc;
}

function featureFromAccum(
  acc: Accum,
  data: Uint8ClampedArray,
  width: number,
  height: number,
  gridCtx: ReturnType<typeof buildMeanNdviGrid>,
  blobPixels: number[]
): CirBlobFeatures {
  const count = acc.count;
  const inv = 1 / count;
  const meanR = acc.sumR * inv;
  const meanG = acc.sumG * inv;
  const meanB = acc.sumB * inv;
  const { nir, red, green } = cirRgbToReflectance(meanR, meanG, meanB);
  const { ndvi: meanNdvi, gndvi, savi, excessGreen } = spectralIndices(nir, red, green);
  const meanNdviForVar = acc.sumNdvi * inv;
  const varNdvi = Math.max(0, acc.sumNdviSq * inv - meanNdviForVar * meanNdviForVar);
  const ndviStd = Math.sqrt(varNdvi);

  const bw = acc.maxX - acc.minX + 1;
  const bh = acc.maxY - acc.minY + 1;
  const aspectRatio = Math.max(bw, bh) / Math.max(1, Math.min(bw, bh));

  const cx = acc.sumX * inv;
  const cy = acc.sumY * inv;

  const cellNdvi20m = sampleGrid(cx, cy, gridCtx.mean, gridCtx.gw, gridCtx.gh, gridCtx.cellPx);

  const blobSet = new Set(blobPixels);
  const shadowSideContrast = shadowContrastFourSides(
    data,
    width,
    height,
    acc.minX,
    acc.maxX,
    acc.minY,
    acc.maxY,
    blobSet
  );

  return {
    centroidXPx: cx,
    centroidYPx: cy,
    pixelCount: count,
    meanNir: nir,
    meanRed: red,
    meanGreen: green,
    ndvi: meanNdvi,
    gndvi,
    savi,
    excessGreen,
    ndviStd,
    aspectRatio,
    cellNdvi20m,
    isolationVs20m: meanNdvi - cellNdvi20m,
    shadowSideContrast,
  };
}

/**
 * Full pipeline: mask → connected components with per-blob stats + multi-scale NDVI context.
 */
export function extractCirBlobFeaturesFromRgba(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  mPerPx: number,
  opts: CirFeatureExtractOptions = {}
): CirBlobFeatures[] {
  const minPixels = opts.minPixels ?? DEFAULT_EXTRACT.minPixels;
  const maxPixelFrac = opts.maxPixelFrac ?? DEFAULT_EXTRACT.maxPixelFrac;
  const ctxM = opts.contextCellM ?? DEFAULT_EXTRACT.contextCellM;

  const n = width * height;
  const mask = new Uint8Array(n);
  const ndvi = new Float32Array(n);

  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    mask[i] = vegetationMask(r, g, b) ? 1 : 0;
    const { nir, red, green } = cirRgbToReflectance(r, g, b);
    ndvi[i] = spectralIndices(nir, red, green).ndvi;
  }

  const maxPixels = Math.floor(n * maxPixelFrac);
  const cellPxCtx = cellPxForMeters(mPerPx, ctxM);
  const gridCtx = buildMeanNdviGrid(ndvi, width, height, cellPxCtx);

  const visited = new Uint8Array(n);
  const out: CirBlobFeatures[] = [];

  for (let idx = 0; idx < n; idx++) {
    if (!mask[idx] || visited[idx]) continue;

    const stack = [idx];
    visited[idx] = 1;
    const blobPixels: number[] = [];

    while (stack.length > 0) {
      const cur = stack.pop()!;
      blobPixels.push(cur);
      const x = cur % width;
      const y = (cur / width) | 0;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const ni = ny * width + nx;
          if (!mask[ni] || visited[ni]) continue;
          visited[ni] = 1;
          stack.push(ni);
        }
      }
    }

    const count = blobPixels.length;
    if (count < minPixels || count > maxPixels) continue;

    const { bw, bh } = bboxOfIndices(blobPixels, width);
    const k = estimateClusterK(count, bw, bh, mPerPx, minPixels);
    const minSub = Math.max(4, minPixels - 1);
    const groups = k <= 1 ? [blobPixels] : kmeansSplitBlobPixels(blobPixels, ndvi, width, k, minSub);

    for (const group of groups) {
      if (group.length < minPixels) continue;
      const acc = accumulateFromIndices(group, data, ndvi, width);
      out.push(featureFromAccum(acc, data, width, height, gridCtx, group));
    }
  }

  return out;
}
