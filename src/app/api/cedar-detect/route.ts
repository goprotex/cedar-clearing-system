import { NextRequest, NextResponse } from 'next/server';
import * as turf from '@turf/turf';

export const maxDuration = 55; // Vercel function timeout

const NAIP_IDENTIFY =
  'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/identify';

type VegClass = 'cedar' | 'oak' | 'mixed_brush' | 'grass' | 'bare';

interface BandIndices {
  ndvi: number;   // (NIR-R)/(NIR+R) — vegetation greenness
  gndvi: number;  // (NIR-G)/(NIR+G) — chlorophyll content
  savi: number;   // ((NIR-R)/(NIR+R+0.5))*1.5 — soil-adjusted vegetation
  exg: number;    // 2*G - R - B (normalized) — excess green
  nirRatio: number; // NIR / brightness — canopy density indicator
}

interface SampleResult {
  lng: number;
  lat: number;
  ndvi: number;
  gndvi: number;
  savi: number;
  classification: VegClass;
  confidence: number;
  bandVotes: number; // how many indices agreed on classification (0-4)
}

// ── Band index computation ──

function computeIndices(r: number, g: number, b: number, nir: number): BandIndices {
  const brightness = (r + g + b) / 3;
  const L = 0.5; // SAVI soil adjustment factor
  return {
    ndvi: (nir + r) > 0 ? (nir - r) / (nir + r) : 0,
    gndvi: (nir + g) > 0 ? (nir - g) / (nir + g) : 0,
    savi: (nir + r + L) > 0 ? ((nir - r) / (nir + r + L)) * (1 + L) : 0,
    exg: brightness > 0 ? (2 * g - r - b) / (r + g + b) : 0,
    nirRatio: brightness > 0 ? nir / brightness : 0,
  };
}

// ── Multi-band classification with cross-verification ──

function classifyVegetation(
  r: number,
  g: number,
  b: number,
  nir: number | null,
  ndvi: number
): { classification: VegClass; confidence: number; bandVotes: number; gndvi: number; savi: number } {
  // RGB-only fallback (no NIR band)
  if (nir === null) {
    const brightness = (r + g + b) / 3;
    if (brightness < 80 && g > r) return { classification: 'cedar', confidence: 0.3, bandVotes: 0, gndvi: 0, savi: 0 };
    if (brightness < 120 && g > b) return { classification: 'mixed_brush', confidence: 0.25, bandVotes: 0, gndvi: 0, savi: 0 };
    if (g > r && g > b) return { classification: 'grass', confidence: 0.3, bandVotes: 0, gndvi: 0, savi: 0 };
    return { classification: 'bare', confidence: 0.35, bandVotes: 0, gndvi: 0, savi: 0 };
  }

  const idx = computeIndices(r, g, b, nir);
  const brightness = (r + g + b) / 3;
  const redGreenRatio = r / Math.max(g, 1);

  // ── Pass 1: Primary classification from NDVI ──

  // Bare ground / rock / road
  if (idx.ndvi < 0.12) {
    // Cross-verify: SAVI should also be low, ExG near zero
    let votes = 1; // NDVI says bare
    if (idx.savi < 0.15) votes++;
    if (idx.exg < 0.05) votes++;
    if (idx.gndvi < 0.15) votes++;
    const conf = Math.min(0.95, 0.7 + votes * 0.05);
    return { classification: 'bare', confidence: conf, bandVotes: votes, gndvi: idx.gndvi, savi: idx.savi };
  }

  // Grass / sparse vegetation
  if (idx.ndvi >= 0.12 && idx.ndvi < 0.28) {
    let votes = 1; // NDVI says grass
    if (idx.savi >= 0.1 && idx.savi < 0.35) votes++;
    if (idx.exg > 0 && idx.exg < 0.15) votes++;
    if (idx.nirRatio < 1.6) votes++;
    const conf = Math.min(0.85, 0.55 + votes * 0.07);
    return { classification: 'grass', confidence: conf, bandVotes: votes, gndvi: idx.gndvi, savi: idx.savi };
  }

  // ── Pass 2: Dense vegetation zone (NDVI >= 0.28) — multi-band cedar detection ──

  // Cedar vote accumulator: each index independently votes "cedar"
  let cedarVotes = 0;
  const totalChecks = 5;

  // Vote 1: NDVI high (dense evergreen canopy)
  if (idx.ndvi > 0.35) cedarVotes++;

  // Vote 2: GNDVI moderate-to-high but LOWER than NDVI
  //   Cedar has less chlorophyll variation than deciduous → GNDVI/NDVI ratio < 0.85
  //   Deciduous oak has GNDVI nearly equal to NDVI
  if (idx.gndvi > 0.2 && (idx.gndvi / Math.max(idx.ndvi, 0.01)) < 0.85) cedarVotes++;

  // Vote 3: Low visible brightness with high NIR (dense dark canopy)
  if (brightness < 100 && idx.nirRatio > 1.7) cedarVotes++;

  // Vote 4: SAVI confirms dense vegetation even accounting for soil
  if (idx.savi > 0.35) cedarVotes++;

  // Vote 5: Low red reflectance (strong red absorption from chlorophyll)
  if (r < 90 && redGreenRatio < 0.9) cedarVotes++;

  // Cedar classification: need at least 3 of 5 votes
  if (cedarVotes >= 3) {
    const voteRatio = cedarVotes / totalChecks;
    const conf = Math.min(0.95, 0.5 + voteRatio * 0.35 + (idx.ndvi - 0.28) * 0.2);
    return { classification: 'cedar', confidence: conf, bandVotes: cedarVotes, gndvi: idx.gndvi, savi: idx.savi };
  }

  // 2-vote cedar: possible cedar but lower confidence
  if (cedarVotes === 2 && idx.ndvi > 0.28 && brightness < 110) {
    return { classification: 'cedar', confidence: 0.5, bandVotes: cedarVotes, gndvi: idx.gndvi, savi: idx.savi };
  }

  // Deciduous (oak): brighter canopy, GNDVI close to NDVI (high chlorophyll), higher red
  if (idx.ndvi > 0.28 && brightness >= 95 && redGreenRatio > 0.85) {
    let oakVotes = 1;
    if (idx.gndvi / Math.max(idx.ndvi, 0.01) > 0.8) oakVotes++; // GNDVI ≈ NDVI → deciduous
    if (idx.nirRatio < 1.8) oakVotes++;
    const conf = Math.min(0.8, 0.45 + oakVotes * 0.1);
    return { classification: 'oak', confidence: conf, bandVotes: oakVotes, gndvi: idx.gndvi, savi: idx.savi };
  }

  return { classification: 'mixed_brush', confidence: 0.45, bandVotes: 1, gndvi: idx.gndvi, savi: idx.savi };
}

function getClassColor(classification: VegClass, ndvi: number): string {
  switch (classification) {
    case 'cedar':
      if (ndvi > 0.5) return '#dc2626'; // dense
      if (ndvi > 0.4) return '#ea580c'; // moderate
      return '#f97316'; // light
    case 'oak':
      return '#92400e';
    case 'mixed_brush':
      return '#d97706';
    case 'grass':
      return '#65a30d';
    case 'bare':
      return '#9ca3af';
  }
}

// ── API handler ──

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { coordinates, acreage } = body;

    if (!coordinates || !Array.isArray(coordinates) || coordinates.length === 0) {
      return NextResponse.json({ error: 'Polygon coordinates required' }, { status: 400 });
    }

    const polygon = turf.polygon(coordinates);
    const bbox = turf.bbox(polygon);
    const ac = acreage || turf.area(polygon) / 4047;

    // Auto-scale grid spacing based on acreage (keep total points manageable)
    let spacingKm: number;
    if (ac < 10) spacingKm = 0.015; // 15m
    else if (ac < 30) spacingKm = 0.02; // 20m
    else if (ac < 80) spacingKm = 0.03; // 30m
    else if (ac < 200) spacingKm = 0.04; // 40m
    else spacingKm = 0.06; // 60m

    const grid = turf.pointGrid(bbox, spacingKm, { units: 'kilometers' });
    const pointsInPoly = grid.features.filter((pt) =>
      turf.booleanPointInPolygon(pt, polygon)
    );

    // Cap at 300 to prevent excessive API calls
    const samplePoints = pointsInPoly.slice(0, 300);

    if (samplePoints.length === 0) {
      return NextResponse.json(
        { error: 'No sample points generated. Polygon may be too small.' },
        { status: 400 }
      );
    }

    // Batch identify requests against NAIP ImageServer
    const batchSize = 15;
    const results: SampleResult[] = [];

    for (let i = 0; i < samplePoints.length; i += batchSize) {
      const batch = samplePoints.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (pt): Promise<SampleResult | null> => {
          const [lng, lat] = pt.geometry.coordinates;
          try {
            const geom = JSON.stringify({
              x: lng,
              y: lat,
              spatialReference: { wkid: 4326 },
            });
            const url = `${NAIP_IDENTIFY}?geometry=${encodeURIComponent(geom)}&geometryType=esriGeometryPoint&returnGeometry=false&returnCatalogItems=false&f=json`;

            const res = await fetch(url, {
              signal: AbortSignal.timeout(10000),
            });
            if (!res.ok) return null;

            const data = await res.json();
            const pixelStr: string = data?.value || '';

            if (!pixelStr || pixelStr === 'NoData') {
              return { lng, lat, ndvi: 0, gndvi: 0, savi: 0, classification: 'bare', confidence: 0.3, bandVotes: 0 };
            }

            const vals = pixelStr
              .split(/[\s,]+/)
              .map(Number)
              .filter((n) => !isNaN(n));
            if (vals.length < 3) return null;

            const [r, g, b] = vals;
            const nir = vals.length >= 4 ? vals[3] : null;

            let ndvi = 0;
            if (nir !== null && nir + r > 0) {
              ndvi = (nir - r) / (nir + r);
            }

            const { classification, confidence, bandVotes, gndvi, savi } = classifyVegetation(r, g, b, nir, ndvi);
            return { lng, lat, ndvi, gndvi, savi, classification, confidence, bandVotes };
          } catch {
            return null;
          }
        })
      );

      results.push(...batchResults.filter((r): r is SampleResult => r !== null));
    }

    if (results.length === 0) {
      return NextResponse.json(
        { error: 'No NAIP data available for this area' },
        { status: 404 }
      );
    }

    // Build cell polygons for map overlay
    const centerLat = (bbox[1] + bbox[3]) / 2;
    const halfLngDeg = spacingKm / 2 / (111.32 * Math.cos((centerLat * Math.PI) / 180));
    const halfLatDeg = spacingKm / 2 / 111.32;

    const gridCells: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: results.map((s) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [
            [
              [s.lng - halfLngDeg, s.lat - halfLatDeg],
              [s.lng + halfLngDeg, s.lat - halfLatDeg],
              [s.lng + halfLngDeg, s.lat + halfLatDeg],
              [s.lng - halfLngDeg, s.lat + halfLatDeg],
              [s.lng - halfLngDeg, s.lat - halfLatDeg],
            ],
          ],
        },
        properties: {
          classification: s.classification,
          ndvi: Math.round(s.ndvi * 1000) / 1000,
          gndvi: Math.round(s.gndvi * 1000) / 1000,
          savi: Math.round(s.savi * 1000) / 1000,
          confidence: Math.round(s.confidence * 100) / 100,
          bandVotes: s.bandVotes,
          color: getClassColor(s.classification, s.ndvi),
        },
      })),
    };

    // Summary statistics
    const total = results.length;
    const cedarCount = results.filter((r) => r.classification === 'cedar').length;
    const oakCount = results.filter((r) => r.classification === 'oak').length;
    const mixedCount = results.filter((r) => r.classification === 'mixed_brush').length;
    const grassCount = results.filter((r) => r.classification === 'grass').length;
    const bareCount = results.filter((r) => r.classification === 'bare').length;

    const cedarPct = total > 0 ? cedarCount / total : 0;
    const avgNdvi = results.reduce((sum, r) => sum + r.ndvi, 0) / total;
    const avgConf = results.reduce((sum, r) => sum + r.confidence, 0) / total;
    const avgBandVotes = results.reduce((sum, r) => sum + r.bandVotes, 0) / total;
    const avgGndvi = results.reduce((sum, r) => sum + r.gndvi, 0) / total;
    const avgSavi = results.reduce((sum, r) => sum + r.savi, 0) / total;

    // High-confidence cedar: cells where ≥3 bands agreed
    const highConfCedar = results.filter((r) => r.classification === 'cedar' && r.bandVotes >= 3).length;

    const summary = {
      totalSamples: total,
      cedar: { count: cedarCount, pct: Math.round(cedarPct * 100) },
      oak: { count: oakCount, pct: Math.round((oakCount / total) * 100) },
      mixedBrush: { count: mixedCount, pct: Math.round((mixedCount / total) * 100) },
      grass: { count: grassCount, pct: Math.round((grassCount / total) * 100) },
      bare: { count: bareCount, pct: Math.round((bareCount / total) * 100) },
      estimatedCedarAcres: Math.round(cedarPct * ac * 10) / 10,
      averageNDVI: Math.round(avgNdvi * 1000) / 1000,
      averageGNDVI: Math.round(avgGndvi * 1000) / 1000,
      averageSAVI: Math.round(avgSavi * 1000) / 1000,
      confidence: Math.round(avgConf * 100),
      avgBandVotes: Math.round(avgBandVotes * 10) / 10,
      highConfidenceCedarCells: highConfCedar,
      gridSpacingM: Math.round(spacingKm * 1000),
    };

    return NextResponse.json(
      { gridCells, summary },
      { headers: { 'Cache-Control': 'private, max-age=3600' } }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: 'Analysis failed',
        detail: err instanceof Error ? err.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
