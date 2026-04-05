import { NextRequest, NextResponse } from 'next/server';

// USDA Soil Data Access REST proxy
// Queries SSURGO for soil properties at a point (centroid of pasture polygon)

export const maxDuration = 25; // Vercel function timeout (seconds)

const SDA_URL = 'https://SDMDataAccess.sc.egov.usda.gov/Tabular/post.rest';

// Validate coordinates are within continental US bounds
function isValidCoord(lon: number, lat: number): boolean {
  return lon >= -125 && lon <= -66 && lat >= 24 && lat <= 50;
}

function buildSoilQuery(lon: number, lat: number): string {
  // Simplified query: get mukey from point, then grab the dominant component
  return `
    SELECT TOP 1
      mu.muname,
      c.compname,
      c.comppct_r,
      c.slope_r,
      c.drainagecl,
      c.flodfreqcl,
      ch.fragvol_r,
      cr.resdepth_r
    FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('POINT(${lon} ${lat})') AS mk
    INNER JOIN mapunit AS mu ON mk.mukey = mu.mukey
    INNER JOIN component AS c ON mu.mukey = c.mukey AND c.majcompflag = 'Yes'
    LEFT JOIN chorizon AS ch ON c.cokey = ch.cokey AND ch.hzdept_r = 0
    LEFT JOIN corestrictions AS cr ON c.cokey = cr.cokey
    ORDER BY c.comppct_r DESC
  `;
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
    const query = buildSoilQuery(lon, lat);

    const response = await fetch(SDA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, format: 'JSON' }),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: 'USDA SDA service unavailable' },
        { status: 502 }
      );
    }

    const data = await response.json();

    // Parse SDA response into our soil data shape
    if (!data?.Table || data.Table.length === 0) {
      return NextResponse.json({ soil: null, message: 'No soil data found for this location' });
    }

    const row = data.Table[0];
    const soil = {
      series: row.compname || 'Unknown',
      mapUnit: row.muname || '',
      slope_r: row.slope_r ?? 0,
      fragvol_r: row.fragvol_r ?? 0,
      drainagecl: row.drainagecl || 'Well drained',
      resdept_r: row.resdepth_r ?? null,
      flodfreqcl: row.flodfreqcl || 'None',
      component_pct: row.comppct_r ?? 0,
    };

    return NextResponse.json({ soil }, {
      headers: {
        'Cache-Control': 'public, max-age=86400, s-maxage=604800',
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to query soil data' },
      { status: 500 }
    );
  }
}
