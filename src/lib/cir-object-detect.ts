/**
 * Client-side CIR (NAIP bandIds 3,0,1) tree-crown detection.
 * One raster → boolean mask → connected components → centroids (no per-pixel API calls).
 */

export interface CirBlob {
  centroidXPx: number;
  centroidYPx: number;
  pixelCount: number;
}

export interface CirDetectOptions {
  /** Minimum blob area in pixels (noise) */
  minPixels: number;
  /** Max blob as fraction of image (reject whole-field merge) */
  maxPixelFrac: number;
}

const DEFAULT_OPTS: CirDetectOptions = {
  minPixels: 6,
  maxPixelFrac: 0.12,
};

/**
 * Vegetation in false-color CIR (R≈NIR, G≈red, B≈green): woody crowns read as strong red/magenta.
 * Exported for richer feature extraction on the same raster.
 */
export function vegetationMask(r: number, g: number, b: number): boolean {
  const sum = r + g + b + 1;
  const rn = r / sum;
  const gn = g / sum;
  const bn = b / sum;
  if (r < 55 && g < 55 && b < 55) return false;
  if (r > 245 && g > 245 && b > 245) return false;
  return rn > gn + 0.04 && rn > bn + 0.04 && r > g * 0.72 && r > b * 0.72;
}

/**
 * 8-connected connected components on binary mask. O(W×H).
 */
export function detectTreeBlobsFromRgba(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  opts: Partial<CirDetectOptions> = {}
): CirBlob[] {
  const { minPixels, maxPixelFrac } = { ...DEFAULT_OPTS, ...opts };
  const maxPixels = Math.floor(width * height * maxPixelFrac);
  const n = width * height;
  const mask = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    mask[i] = vegetationMask(data[p], data[p + 1], data[p + 2]) ? 1 : 0;
  }

  const visited = new Uint8Array(n);
  const blobs: CirBlob[] = [];

  for (let idx = 0; idx < n; idx++) {
    if (!mask[idx] || visited[idx]) continue;

    let sumX = 0;
    let sumY = 0;
    let count = 0;
    const stack = [idx];
    visited[idx] = 1;

    while (stack.length > 0) {
      const cur = stack.pop()!;
      const x = cur % width;
      const y = (cur / width) | 0;
      sumX += x;
      sumY += y;
      count++;

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

    if (count < minPixels || count > maxPixels) continue;
    blobs.push({
      centroidXPx: sumX / count,
      centroidYPx: sumY / count,
      pixelCount: count,
    });
  }

  return blobs;
}

/** Ground size of one pixel (meters) from geographic bbox and image size. */
export function metersPerPixel(
  minLng: number,
  maxLng: number,
  minLat: number,
  maxLat: number,
  widthPx: number,
  heightPx: number
): number {
  const midLat = (minLat + maxLat) / 2;
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos((midLat * Math.PI) / 180);
  const widthM = Math.max(1, (maxLng - minLng) * mPerDegLng);
  const heightM = Math.max(1, (maxLat - minLat) * mPerDegLat);
  return Math.sqrt((widthM / widthPx) * (heightM / heightPx));
}

/** Pixel centroid → WGS84 (image y top-down). */
export function pixelToLngLat(
  px: number,
  py: number,
  widthPx: number,
  heightPx: number,
  minLng: number,
  minLat: number,
  maxLng: number,
  maxLat: number
): [number, number] {
  const lng = minLng + ((px + 0.5) / widthPx) * (maxLng - minLng);
  const lat = maxLat - ((py + 0.5) / heightPx) * (maxLat - minLat);
  return [lng, lat];
}

/** Approximate crown diameter from blob area and ground resolution. */
export function blobDiameterMeters(pixelCount: number, mPerPx: number): number {
  const areaM2 = pixelCount * mPerPx * mPerPx;
  return Math.max(2.5, Math.min(35, 2 * Math.sqrt(areaM2 / Math.PI)));
}
