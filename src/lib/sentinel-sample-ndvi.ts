/**
 * Sentinel-2 L2A STAC search + per-pixel NDVI sampling (shared with seasonal analysis).
 * Used as a 2nd opinion for cedar vs oak fusion with NAIP.
 */

const STAC_SEARCH = 'https://earth-search.aws.element84.com/v1/search';

export interface SentinelSceneMeta {
  id: string;
  datetime: string;
  cloudCover: number;
}

export interface STACItem {
  id: string;
  properties: {
    datetime: string;
    'eo:cloud_cover': number;
    'proj:epsg'?: number;
    'proj:transform'?: number[];
    'proj:shape'?: number[];
  };
  assets: Record<string, { href: string; 'proj:transform'?: number[]; 'proj:shape'?: number[] }>;
}

export async function findSentinelScene(
  bbox: number[],
  dateRange: string,
  maxCloud: number = 28
): Promise<STACItem | null> {
  try {
    const res = await fetch(STAC_SEARCH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collections: ['sentinel-2-l2a'],
        bbox,
        datetime: dateRange,
        query: { 'eo:cloud_cover': { lt: maxCloud } },
        sortby: [{ field: 'properties.eo:cloud_cover', direction: 'asc' }],
        limit: 1,
      }),
      signal: AbortSignal.timeout(14000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.features?.[0] || null;
  } catch {
    return null;
  }
}

export function sceneMeta(item: STACItem): SentinelSceneMeta {
  return {
    id: item.id,
    datetime: item.properties.datetime?.split('T')[0] || '',
    cloudCover: Math.round(item.properties['eo:cloud_cover'] ?? 0),
  };
}

function toUtm(lat: number, lng: number, zone: number): { easting: number; northing: number } {
  const cm = (zone - 1) * 6 - 180 + 3;
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const e2 = 2 * f - f * f;
  const ep2 = e2 / (1 - e2);
  const k0 = 0.9996;
  const phi = (lat * Math.PI) / 180;
  const dlam = ((lng - cm) * Math.PI) / 180;
  const sinP = Math.sin(phi);
  const cosP = Math.cos(phi);
  const tanP = Math.tan(phi);
  const N = a / Math.sqrt(1 - e2 * sinP * sinP);
  const T = tanP * tanP;
  const C = ep2 * cosP * cosP;
  const A = cosP * dlam;
  const M =
    a *
    ((1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256) * phi -
      ((3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi) +
      ((15 * e2 * e2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));
  const easting =
    k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120) + 500000;
  const northing =
    k0 *
      (M +
        N * tanP * ((A * A) / 2 + ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720)) +
    (lat < 0 ? 10000000 : 0);
  return { easting, northing };
}

/** NDVI at each sample point; null if read failed for that point. */
export async function sampleNdviFromSceneItem(
  item: STACItem,
  samplePoints: GeoJSON.Feature<GeoJSON.Point>[],
  bbox: number[]
): Promise<{ values: (number | null)[]; mean: number | null } | null> {
  try {
    const b04Url = item.assets.red?.href || item.assets.B04?.href;
    const b08Url = item.assets.nir?.href || item.assets.B08?.href;
    if (!b04Url || !b08Url) return null;

    const epsg = item.properties['proj:epsg'];
    let utmZone: number;
    if (epsg && epsg >= 32601 && epsg <= 32660) utmZone = epsg - 32600;
    else if (epsg && epsg >= 32701 && epsg <= 32760) utmZone = epsg - 32700;
    else utmZone = Math.floor(((bbox[0] + bbox[2]) / 2 + 180) / 6) + 1;

    const transform =
      item.assets.red?.['proj:transform'] ||
      item.assets.B04?.['proj:transform'] ||
      item.properties['proj:transform'];
    const shape =
      item.assets.red?.['proj:shape'] ||
      item.assets.B04?.['proj:shape'] ||
      item.properties['proj:shape'];

    if (!transform || !shape) return null;

    const [scaleX, , originX, , scaleY, originY] = transform;
    const [imgH, imgW] = shape;

    const bytesPerPixel = 2;
    const rowBytes = imgW * bytesPerPixel;

    const headerRes = await fetch(b04Url, {
      headers: { Range: 'bytes=0-8191' },
      signal: AbortSignal.timeout(10000),
    });
    if (!headerRes.ok) return null;
    const headerBuf = await headerRes.arrayBuffer();
    const headerView = new DataView(headerBuf);

    const byteOrder = headerView.getUint16(0);
    const isLE = byteOrder === 0x4949;
    const magic = headerView.getUint16(2, isLE);

    let dataOffset = 0;
    let isTiled = false;

    if (magic === 43) {
      const ifdOffset = Number(headerView.getBigUint64(8, isLE));
      if (ifdOffset < headerBuf.byteLength - 8) {
        const numEntries = Number(headerView.getBigUint64(ifdOffset, isLE));
        for (let i = 0; i < Math.min(Number(numEntries), 30); i++) {
          const entryOff = Number(ifdOffset) + 8 + i * 20;
          if (entryOff + 20 > headerBuf.byteLength) break;
          const tag = headerView.getUint16(entryOff, isLE);
          if (tag === 273) {
            dataOffset = Number(headerView.getBigUint64(entryOff + 12, isLE));
          } else if (tag === 324) {
            isTiled = true;
          }
        }
      }
    }

    if (isTiled || dataOffset <= 0) return null;

    const ndviValues: (number | null)[] = [];
    const batchSize = 8;

    for (let b = 0; b < samplePoints.length; b += batchSize) {
      const batch = samplePoints.slice(b, b + batchSize);
      const batchRes = await Promise.all(
        batch.map(async (pt) => {
          try {
            const [lng, lat] = pt.geometry.coordinates;
            const utm = toUtm(lat, lng, utmZone);
            const px = Math.floor((utm.easting - originX) / scaleX);
            const py = Math.floor((utm.northing - originY) / scaleY);

            if (px < 0 || px >= imgW || py < 0 || py >= imgH) return null;

            const pixelOffset = dataOffset + py * rowBytes + px * bytesPerPixel;

            const [r4, r8] = await Promise.all([
              fetch(b04Url, {
                headers: { Range: `bytes=${pixelOffset}-${pixelOffset + 1}` },
                signal: AbortSignal.timeout(6000),
              }),
              fetch(b08Url, {
                headers: { Range: `bytes=${pixelOffset}-${pixelOffset + 1}` },
                signal: AbortSignal.timeout(6000),
              }),
            ]);

            if (!r4.ok || !r8.ok) return null;

            const buf4 = await r4.arrayBuffer();
            const buf8 = await r8.arrayBuffer();
            const red = new DataView(buf4).getUint16(0, true);
            const nir = new DataView(buf8).getUint16(0, true);

            if (red + nir === 0 || red > 10000 || nir > 10000) return null;
            return (nir - red) / (nir + red);
          } catch {
            return null;
          }
        })
      );
      ndviValues.push(...batchRes);
    }

    const valid = ndviValues.filter((v): v is number => v !== null);
    const mean =
      valid.length > 0 ? valid.reduce((a, x) => a + x, 0) / valid.length : null;
    return { values: ndviValues, mean };
  } catch {
    return null;
  }
}
