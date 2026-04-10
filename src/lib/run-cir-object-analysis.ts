import type { CedarAnalysis } from '@/types';
import type { CirClassifierCalibration } from '@/lib/cir-calibration';
import { metersPerPixel } from '@/lib/cir-object-detect';
import { extractCirBlobFeaturesFromRgba } from '@/lib/cir-blob-features';
import { buildCedarAnalysisFromCirBlobs } from '@/lib/cedar-analysis-from-cir-objects';

/**
 * One USGS NAIP export + client-side CIR blob detection (Canvas), no per-pixel API calls.
 */
export async function runCirObjectAnalysis(
  coordinates: GeoJSON.Position[][],
  pastureAcreage: number,
  calibration?: CirClassifierCalibration
): Promise<CedarAnalysis> {
  const res = await fetch('/api/naip-export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ coordinates }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || (err as { error?: string }).error || 'NAIP export failed');
  }

  const w = Number(res.headers.get('X-NAIP-Width'));
  const h = Number(res.headers.get('X-NAIP-Height'));
  const bboxStr = res.headers.get('X-Bbox-Wgs84');
  if (!bboxStr || !Number.isFinite(w) || !Number.isFinite(h)) {
    throw new Error('Missing NAIP export metadata');
  }
  const parts = bboxStr.split(',').map(Number);
  if (parts.length !== 4) throw new Error('Invalid bbox header');
  const bbox: [number, number, number, number] = [parts[0], parts[1], parts[2], parts[3]];

  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);

  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');
  ctx.drawImage(bmp, 0, 0);
  bmp.close();

  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const mPerPx = metersPerPixel(minLng, maxLng, minLat, maxLat, canvas.width, canvas.height);

  const blobs = extractCirBlobFeaturesFromRgba(imgData.data, canvas.width, canvas.height, mPerPx, {
    minPixels: 3,
    maxPixelFrac: 0.16,
    contextCellM: 20,
  });

  return buildCedarAnalysisFromCirBlobs(
    blobs,
    coordinates,
    pastureAcreage,
    canvas.width,
    canvas.height,
    bbox,
    calibration
  );
}
