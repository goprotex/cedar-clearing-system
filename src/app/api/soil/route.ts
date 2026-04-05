import { NextRequest, NextResponse } from 'next/server';

// USDA Soil Data Access REST proxy with SoilWeb fallback
// Queries SSURGO for soil properties at a point (centroid of pasture polygon)

export const maxDuration = 25;

const SDA_URL = 'https://SDMDataAccess.sc.egov.usda.gov/Tabular/post.rest';
const SOILWEB_URL = 'https://casoilresource.lawr.ucdavis.edu/soil_web/query.php';

function isValidCoord(lon: number, lat: number): boolean {
  return lon >= -125 && lon <= -66 && lat >= 24 && lat <= 50;
}

function buildSoilQuery(lon: number, lat: number): string {
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

interface SoilResult {
  series: string;
  mapUnit: string;
  slope_r: number;
  fragvol_r: number;
  drainagecl: string;
  resdept_r: number | null;
  flodfreqcl: string;
  component_pct: number;
}

/** Try USDA SDA first (8s timeout) */
async function trySDA(lon: number, lat: number): Promise<SoilResult | null> {
  try {
    const query = buildSoilQuery(lon, lat);
    const response = await fetch(SDA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, format: 'JSON' }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;

    const data = await response.json();
    if (!data?.Table || data.Table.length === 0) return null;

    const row = data.Table[0];
    return {
      series: row.compname || 'Unknown',
      mapUnit: row.muname || '',
      slope_r: row.slope_r ?? 0,
      fragvol_r: row.fragvol_r ?? 0,
      drainagecl: row.drainagecl || 'Well drained',
      resdept_r: row.resdepth_r ?? null,
      flodfreqcl: row.flodfreqcl || 'None',
      component_pct: row.comppct_r ?? 0,
    };
  } catch {
    return null;
  }
}

/** Fallback: UC Davis SoilWeb (faster, same SSURGO data) */
async function trySoilWeb(lon: number, lat: number): Promise<SoilResult | null> {
  try {
    const res = await fetch(
      `${SOILWEB_URL}?lon=${lon}&lat=${lat}`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return null;
    const text = await res.text();
    const data = JSON.parse(text);

    // SoilWeb returns various formats; try to extract what we need
    const compname = data.component?.compname || data.compname || data.series || '';
    const muname = data.mapunit?.muname || data.muname || '';

    if (!compname && !muname) return null;

    return {
      series: compname || 'Unknown',
      mapUnit: muname || '',
      slope_r: data.component?.slope_r ?? data.slope_r ?? 0,
      fragvol_r: data.chorizon?.fragvol_r ?? data.fragvol_r ?? 0,
      drainagecl: data.component?.drainagecl ?? data.drainagecl ?? 'Well drained',
      resdept_r: data.corestrictions?.resdepth_r ?? data.resdept_r ?? null,
      flodfreqcl: data.component?.flodfreqcl ?? data.flodfreqcl ?? 'None',
      component_pct: data.component?.comppct_r ?? data.comppct_r ?? 0,
    };
  } catch {
    return null;
  }
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

  // Try SDA first (fast timeout), then fall back to SoilWeb
  const soil = await trySDA(lon, lat) ?? await trySoilWeb(lon, lat);

  if (!soil) {
    return NextResponse.json({ soil: null, message: 'No soil data found for this location' });
  }

  return NextResponse.json({ soil }, {
    headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=604800' },
  });
}
