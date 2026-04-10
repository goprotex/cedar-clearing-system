import { NextRequest, NextResponse } from 'next/server';
import * as turf from '@turf/turf';

export const maxDuration = 120;

const NAIP_EXPORT =
  'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage';

/** WGS84 → Web Mercator (EPSG:3857), meters */
const R = 6378137;
function to3857(lng: number, lat: number): [number, number] {
  const x = (R * (lng * Math.PI)) / 180;
  const y = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  return [x, y];
}

const MAX_SIDE_PX = 4096;
const MIN_SIDE_PX = 256;

/**
 * Single NAIP export: one HTTP request to USGS ImageServer (CIR: NIR, R, G as RGB).
 * Client runs object detection on the GPU-friendly bitmap (Canvas).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { coordinates } = body as { coordinates?: GeoJSON.Position[][] };

    if (!coordinates?.length) {
      return NextResponse.json({ error: 'Polygon coordinates required' }, { status: 400 });
    }

    const polygon = turf.polygon(coordinates);
    const bbox = turf.bbox(polygon);
    const [minLng, minLat, maxLng, maxLat] = bbox;

    const sw = to3857(minLng, minLat);
    const ne = to3857(maxLng, maxLat);
    const minX = Math.min(sw[0], ne[0]);
    const maxX = Math.max(sw[0], ne[0]);
    const minY = Math.min(sw[1], ne[1]);
    const maxY = Math.max(sw[1], ne[1]);

    const widthM = maxX - minX;
    const heightM = maxY - minY;
    if (widthM < 1 || heightM < 1) {
      return NextResponse.json({ error: 'Invalid bbox' }, { status: 400 });
    }

    let w = Math.ceil(widthM);
    let h = Math.ceil(heightM);
    if (w > MAX_SIDE_PX || h > MAX_SIDE_PX) {
      const s = MAX_SIDE_PX / Math.max(w, h);
      w = Math.max(MIN_SIDE_PX, Math.floor(w * s));
      h = Math.max(MIN_SIDE_PX, Math.floor(h * s));
    }

    const params = new URLSearchParams({
      bbox: `${minX},${minY},${maxX},${maxY}`,
      bboxSR: '3857',
      imageSR: '3857',
      size: `${w},${h}`,
      format: 'png',
      bandIds: '3,0,1',
      f: 'image',
    });

    const url = `${NAIP_EXPORT}?${params.toString()}`;
    const upstream = await fetch(url, { signal: AbortSignal.timeout(90_000) });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: 'NAIP export failed', detail: `USGS ${upstream.status}` },
        { status: 502 }
      );
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length < 100) {
      return NextResponse.json({ error: 'Empty NAIP image' }, { status: 502 });
    }

    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'private, max-age=3600',
        'X-NAIP-Width': String(w),
        'X-NAIP-Height': String(h),
        'X-Bbox-Wgs84': `${minLng},${minLat},${maxLng},${maxLat}`,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: 'NAIP export error', detail: e instanceof Error ? e.message : 'Unknown' },
      { status: 500 }
    );
  }
}
