import { NextRequest, NextResponse } from 'next/server';

// UC Davis SoilWeb proxy — returns soil series detail for a point
// Free, no key required, public federal data

const SOILWEB_URL = 'https://casoilresource.lawr.ucdavis.edu/soil_web/query.php';

function isValidCoord(lon: number, lat: number): boolean {
  return lon >= -125 && lon <= -66 && lat >= 24 && lat <= 50;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const lonStr = searchParams.get('lon');
  const latStr = searchParams.get('lat');

  if (!lonStr || !latStr) {
    return NextResponse.json({ error: 'lon and lat are required' }, { status: 400 });
  }

  const lon = parseFloat(lonStr);
  const lat = parseFloat(latStr);

  if (isNaN(lon) || isNaN(lat) || !isValidCoord(lon, lat)) {
    return NextResponse.json({ error: 'Invalid coordinates' }, { status: 400 });
  }

  try {
    const res = await fetch(`${SOILWEB_URL}?lon=${lon}&lat=${lat}`, {
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      return NextResponse.json({ error: 'SoilWeb service unavailable' }, { status: 502 });
    }

    const text = await res.text();

    // SoilWeb can return HTML or JSON depending on the query
    // Try to parse as JSON first
    try {
      const data = JSON.parse(text);
      return NextResponse.json(data, {
        headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=604800' },
      });
    } catch {
      // If not JSON, return the raw text wrapped
      return NextResponse.json({ raw: text }, {
        headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=604800' },
      });
    }
  } catch {
    return NextResponse.json({ error: 'Failed to query SoilWeb' }, { status: 500 });
  }
}
