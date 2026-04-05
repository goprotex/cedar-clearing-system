import { NextRequest, NextResponse } from 'next/server';

// USGS 3DEP Elevation Point Query Service proxy
// Free, no key required

const EPQS_URL = 'https://epqs.nationalmap.gov/v1/json';

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
    const res = await fetch(
      `${EPQS_URL}?x=${lon}&y=${lat}&wkid=4326&units=Feet&includeDate=false`
    );

    if (!res.ok) {
      return NextResponse.json({ error: 'USGS elevation service unavailable' }, { status: 502 });
    }

    const data = await res.json();

    // EPQS returns { value: number, ... }
    const elevationFt = data?.value ?? null;

    return NextResponse.json(
      { elevationFt: elevationFt !== null ? Math.round(elevationFt) : null },
      { headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=604800' } }
    );
  } catch {
    return NextResponse.json({ error: 'Failed to query elevation' }, { status: 500 });
  }
}
