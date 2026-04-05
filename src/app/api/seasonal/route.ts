import { NextRequest, NextResponse } from 'next/server';
import * as turf from '@turf/turf';
import { fromUrl, type GeoTIFF as GeoTIFFType } from 'geotiff';

export const maxDuration = 55;

const STAC_SEARCH = 'https://earth-search.aws.element84.com/v1/search';

// ── WGS84 → UTM forward projection (standard geodetic formulas) ──

function wgs84ToUtm(
  lat: number,
  lng: number,
  forceZone?: number
): { easting: number; northing: number; zone: number } {
  const zone = forceZone ?? Math.floor((lng + 180) / 6) + 1;
  const cm = (zone - 1) * 6 - 180 + 3;

  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const e2 = 2 * f - f * f;
  const ep2 = e2 / (1 - e2);
  const k0 = 0.9996;

  const phi = (lat * Math.PI) / 180;
  const dlam = ((lng - cm) * Math.PI) / 180;

  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const tanPhi = Math.tan(phi);

  const N = a / Math.sqrt(1 - e2 * sinPhi * sinPhi);
  const T = tanPhi * tanPhi;
  const C = ep2 * cosPhi * cosPhi;
  const A = cosPhi * dlam;

  const M =
    a *
    ((1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256) * phi -
      ((3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * e2 * e2 * e2) / 1024) *
        Math.sin(2 * phi) +
      ((15 * e2 * e2) / 256 + (45 * e2 * e2 * e2) / 1024) * Math.sin(4 * phi) -
      ((35 * e2 * e2 * e2) / 3072) * Math.sin(6 * phi));

  const easting =
    k0 *
      N *
      (A +
        ((1 - T + C) * A * A * A) / 6 +
        ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120) +
    500000;

  const northing =
    k0 *
      (M +
        N *
          tanPhi *
          ((A * A) / 2 +
            ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 +
            ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720)) +
    (lat < 0 ? 10000000 : 0);

  return { easting, northing, zone };
}

// ── STAC search ──

interface STACItem {
  id: string;
  properties: {
    datetime: string;
    'eo:cloud_cover': number;
    'proj:epsg'?: number;
  };
  assets: Record<string, { href: string }>;
}

async function findScene(
  bbox: number[],
  dateRange: string,
  maxCloud: number = 25
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
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.features?.[0] || null;
  } catch {
    return null;
  }
}

// ── Read NDVI from Sentinel-2 COGs ──

async function readNdviFromScene(
  item: STACItem,
  bbox: number[]
): Promise<{ values: number[]; mean: number } | null> {
  try {
    const b04Url = item.assets.red?.href || item.assets.B04?.href;
    const b08Url = item.assets.nir?.href || item.assets.B08?.href;
    if (!b04Url || !b08Url) return null;

    // Determine UTM zone from the image CRS or centroid
    const epsg = item.properties['proj:epsg'];
    let utmZone: number;
    if (epsg && epsg >= 32601 && epsg <= 32660) {
      utmZone = epsg - 32600;
    } else if (epsg && epsg >= 32701 && epsg <= 32760) {
      utmZone = epsg - 32700;
    } else {
      utmZone = Math.floor(((bbox[0] + bbox[2]) / 2 + 180) / 6) + 1;
    }

    const sw = wgs84ToUtm(bbox[1], bbox[0], utmZone);
    const ne = wgs84ToUtm(bbox[3], bbox[2], utmZone);

    // Open B04 COG (Red band)
    const b04Tiff: GeoTIFFType = await fromUrl(b04Url);
    const b04Image = await b04Tiff.getImage(0);
    const [originX, originY] = b04Image.getOrigin();
    const [resX, resY] = b04Image.getResolution(); // resY is negative

    // Pixel window for our bbox
    const x0 = Math.max(0, Math.floor((sw.easting - originX) / resX));
    const y0 = Math.max(0, Math.floor((ne.northing - originY) / resY));
    const x1 = Math.min(b04Image.getWidth(), Math.ceil((ne.easting - originX) / resX));
    const y1 = Math.min(b04Image.getHeight(), Math.ceil((sw.northing - originY) / resY));

    if (x1 <= x0 || y1 <= y0) return null;

    // Cap pixel count for performance
    const pixelCount = (x1 - x0) * (y1 - y0);
    if (pixelCount > 100000) return null; // too large, skip

    const window: [number, number, number, number] = [x0, y0, x1, y1];

    // Read both bands in parallel
    const [b04Rasters, b08Rasters] = await Promise.all([
      b04Image.readRasters({ window }),
      (async () => {
        const b08Tiff: GeoTIFFType = await fromUrl(b08Url);
        const b08Image = await b08Tiff.getImage(0);
        return b08Image.readRasters({ window });
      })(),
    ]);

    const red = b04Rasters[0] as unknown as ArrayLike<number>;
    const nir = b08Rasters[0] as unknown as ArrayLike<number>;

    const ndviValues: number[] = [];
    for (let i = 0; i < red.length; i++) {
      const r = Number(red[i]);
      const n = Number(nir[i]);
      if (r + n > 0 && r < 10000 && n < 10000) {
        ndviValues.push((n - r) / (n + r));
      }
    }

    if (ndviValues.length === 0) return null;

    const mean = ndviValues.reduce((a, b) => a + b, 0) / ndviValues.length;
    return { values: ndviValues, mean };
  } catch {
    return null;
  }
}

// ── API handler ──

export async function POST(req: NextRequest) {
  try {
    const { coordinates } = await req.json();
    if (!coordinates || !Array.isArray(coordinates)) {
      return NextResponse.json({ error: 'Polygon coordinates required' }, { status: 400 });
    }

    const polygon = turf.polygon(coordinates);
    const bbox = turf.bbox(polygon);

    const now = new Date();
    const year = now.getFullYear();

    // Search for the best winter and summer Sentinel-2 scenes (last 2 years)
    const winterRange = `${year - 2}-12-01/${year}-02-28`;
    const summerRange = `${year - 2}-06-01/${year - 1}-08-31`;

    const [winterItem, summerItem] = await Promise.all([
      findScene(bbox, winterRange, 30),
      findScene(bbox, summerRange, 30),
    ]);

    if (!winterItem && !summerItem) {
      return NextResponse.json(
        { error: 'No Sentinel-2 scenes found. Area may lack recent low-cloud imagery.' },
        { status: 404 }
      );
    }

    // Compute NDVI for each season
    const [winterResult, summerResult] = await Promise.all([
      winterItem ? readNdviFromScene(winterItem, bbox) : null,
      summerItem ? readNdviFromScene(summerItem, bbox) : null,
    ]);

    const winterNDVI = winterResult?.mean ?? null;
    const summerNDVI = summerResult?.mean ?? null;

    let evergreenPct = 0;
    let deciduousPct = 0;
    let dormantPct = 0;

    if (winterResult && summerResult) {
      // Fraction of pixels above vegetation threshold (NDVI > 0.3)
      const winterGreen =
        winterResult.values.filter((v) => v > 0.3).length / winterResult.values.length;
      const summerGreen =
        summerResult.values.filter((v) => v > 0.3).length / summerResult.values.length;

      // Pixels green in winter ≈ evergreen (cedar / juniper)
      evergreenPct = Math.round(winterGreen * 100);
      // Green in summer but not winter ≈ deciduous (oak, elm, etc.)
      deciduousPct = Math.round(Math.max(0, summerGreen - winterGreen) * 100);
      dormantPct = Math.max(0, 100 - evergreenPct - deciduousPct);
    } else if (winterResult) {
      const winterGreen =
        winterResult.values.filter((v) => v > 0.3).length / winterResult.values.length;
      evergreenPct = Math.round(winterGreen * 100);
      dormantPct = 100 - evergreenPct;
    } else if (summerResult) {
      const summerGreen =
        summerResult.values.filter((v) => v > 0.3).length / summerResult.values.length;
      // Can only say "total green", can't distinguish evergreen vs deciduous
      evergreenPct = 0;
      deciduousPct = 0;
      dormantPct = Math.round((1 - summerGreen) * 100);
    }

    const ndviChange =
      winterNDVI !== null && summerNDVI !== null
        ? Math.round((summerNDVI - winterNDVI) * 1000) / 1000
        : null;

    let confidence = 0;
    if (winterResult && summerResult) confidence = 75;
    else if (winterResult || summerResult) confidence = 35;

    return NextResponse.json(
      {
        winterScene: winterItem
          ? {
              id: winterItem.id,
              date: winterItem.properties.datetime?.split('T')[0] || '',
              cloudCover: Math.round(winterItem.properties['eo:cloud_cover']),
            }
          : null,
        summerScene: summerItem
          ? {
              id: summerItem.id,
              date: summerItem.properties.datetime?.split('T')[0] || '',
              cloudCover: Math.round(summerItem.properties['eo:cloud_cover']),
            }
          : null,
        winterNDVI: winterNDVI !== null ? Math.round(winterNDVI * 1000) / 1000 : null,
        summerNDVI: summerNDVI !== null ? Math.round(summerNDVI * 1000) / 1000 : null,
        ndviChange,
        evergreenPct,
        deciduousPct,
        dormantPct,
        confidence,
      },
      { headers: { 'Cache-Control': 'private, max-age=7200' } }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: 'Seasonal analysis failed',
        detail: err instanceof Error ? err.message : 'Unknown',
      },
      { status: 500 }
    );
  }
}
