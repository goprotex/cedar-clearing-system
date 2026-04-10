/**
 * Rich crown features from a single NAIP CIR export (bandIds 3,0,1 → PNG R=NIR, G=Red, B=Green).
 * No extra API calls: spectral indices, texture, bbox shape, and multi-scale NDVI context (10 m / 60 m).
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
  /** Mean NDVI of the ~10 m grid cell containing the centroid */
  cellNdvi10m: number;
  /** Mean NDVI of the ~60 m grid cell containing the centroid */
  cellNdvi60m: number;
  /** ndvi - cellNdvi60m (positive → brighter than wide neighborhood) */
  isolationVs60m: number;
}

export interface CirFeatureExtractOptions {
  minPixels?: number;
  maxPixelFrac?: number;
  /** Ground cell sizes for coarse grids (meters) */
  contextCellM10?: number;
  contextCellM60?: number;
}

const DEFAULT_EXTRACT = {
  minPixels: 6,
  maxPixelFrac: 0.12,
  contextCellM10: 10,
  contextCellM60: 60,
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
  const m10 = opts.contextCellM10 ?? DEFAULT_EXTRACT.contextCellM10;
  const m60 = opts.contextCellM60 ?? DEFAULT_EXTRACT.contextCellM60;

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
  const cellPx10 = cellPxForMeters(mPerPx, m10);
  const cellPx60 = cellPxForMeters(mPerPx, m60);
  const grid10 = buildMeanNdviGrid(ndvi, width, height, cellPx10);
  const grid60 = buildMeanNdviGrid(ndvi, width, height, cellPx60);

  const visited = new Uint8Array(n);
  const out: CirBlobFeatures[] = [];

  for (let idx = 0; idx < n; idx++) {
    if (!mask[idx] || visited[idx]) continue;

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
      minY: height,
      maxY: 0,
    };

    const stack = [idx];
    visited[idx] = 1;

    while (stack.length > 0) {
      const cur = stack.pop()!;
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

    const count = acc.count;
    if (count < minPixels || count > maxPixels) continue;

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

    const cellNdvi10m = sampleGrid(cx, cy, grid10.mean, grid10.gw, grid10.gh, grid10.cellPx);
    const cellNdvi60m = sampleGrid(cx, cy, grid60.mean, grid60.gw, grid60.gh, grid60.cellPx);

    out.push({
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
      cellNdvi10m,
      cellNdvi60m,
      isolationVs60m: meanNdvi - cellNdvi60m,
    });
  }

  return out;
}
