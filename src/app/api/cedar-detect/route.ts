import { NextRequest, NextResponse } from 'next/server';
import * as turf from '@turf/turf';

export const maxDuration = 300; // 5 min — thorough spectral analysis

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

  // ── Pass 1: Bare ground — must be VERY BRIGHT + low NDVI ──
  // Real bare ground (soil, rock, caliche, roads) has brightness > 130 in NAIP.
  // Cedar canopy & shadow is dark-to-moderate (50-130). Don't mis-classify it.
  if (idx.ndvi < 0.08 && brightness > 130) {
    let votes = 1;
    if (idx.savi < 0.1) votes++;
    if (idx.exg < 0.02) votes++;
    if (idx.gndvi < 0.1) votes++;
    if (nir < 90) votes++; // very low NIR = no vegetation at all
    const conf = Math.min(0.95, 0.7 + votes * 0.05);
    return { classification: 'bare', confidence: conf, bandVotes: votes, gndvi: idx.gndvi, savi: idx.savi };
  }

  // Low NDVI but not very bright → cedar shadow/understory/dark canopy
  if (idx.ndvi < 0.08 && brightness <= 130) {
    let votes = 1;
    if (brightness < 90) votes++;   // very dark = dense cedar shadow
    if (nir > 60) votes++;          // some NIR = vegetation present
    if (r < 100) votes++;           // low red = not bare soil
    const conf = Math.min(0.7, 0.35 + votes * 0.1);
    return { classification: 'cedar', confidence: conf, bandVotes: votes, gndvi: idx.gndvi, savi: idx.savi };
  }

  // ── Pass 2: Low-moderate NDVI (0.08-0.22) ──
  // Cedar canopy/edges produce NDVI 0.08-0.22. Real grass/pasture is brighter.
  if (idx.ndvi >= 0.08 && idx.ndvi < 0.22) {
    // Dark-to-moderate pixel → cedar canopy or edge
    if (brightness < 115) {
      let votes = 1;
      if (idx.nirRatio > 1.1) votes++; // NIR penetrates shadow/canopy
      if (r < 90) votes++;             // low red = not soil
      if (brightness < 80) votes++;    // very dark = dense canopy
      if (nir > 60) votes++;           // some NIR = vegetation
      const conf = Math.min(0.75, 0.35 + votes * 0.08);
      return { classification: 'cedar', confidence: conf, bandVotes: votes, gndvi: idx.gndvi, savi: idx.savi };
    }
    // Very bright pixel with low NDVI → actual grass/sparse vegetation
    let votes = 1;
    if (idx.savi >= 0.05 && idx.savi < 0.25) votes++;
    if (idx.exg > 0 && idx.exg < 0.15) votes++;
    if (brightness >= 130) votes++;
    const conf = Math.min(0.8, 0.5 + votes * 0.07);
    return { classification: 'grass', confidence: conf, bandVotes: votes, gndvi: idx.gndvi, savi: idx.savi };
  }

  // ── Pass 3: Moderate NDVI (0.22-0.35) — transitional zone ──
  if (idx.ndvi >= 0.22 && idx.ndvi < 0.35) {
    // Cedar vote accumulator for transitional zone
    let cedarVotes = 0;
    if (brightness < 110) cedarVotes++;          // dark-to-moderate canopy
    if (nir < 160) cedarVotes++;                 // cedar has moderate NIR, oak has high NIR
    if (r < 100) cedarVotes++;                   // moderate-to-low red reflectance
    if (idx.gndvi / Math.max(idx.ndvi, 0.01) < 0.95) cedarVotes++; // GNDVI < NDVI → evergreen tendency
    if (idx.savi > 0.15) cedarVotes++;           // soil-adjusted veg present

    // Only need 1 vote — in this NDVI range, dark/moderate pixels are almost always cedar
    if (cedarVotes >= 1) {
      const conf = Math.min(0.8, 0.35 + cedarVotes * 0.1 + (idx.ndvi - 0.22) * 0.5);
      return { classification: 'cedar', confidence: conf, bandVotes: cedarVotes, gndvi: idx.gndvi, savi: idx.savi };
    }

    // Bright red in CIR (high NIR + brightness) → oak
    if (nir >= 150 && brightness >= 90) {
      return { classification: 'oak', confidence: 0.55, bandVotes: 2, gndvi: idx.gndvi, savi: idx.savi };
    }
    return { classification: 'grass', confidence: 0.5, bandVotes: 1, gndvi: idx.gndvi, savi: idx.savi };
  }

  // ── Pass 4: High NDVI (>= 0.35) — dense vegetation ──
  // CIR signature is the primary discriminator:
  //   Cedar = dark maroon/grey in CIR → moderate NIR (80-150), low brightness
  //   Oak   = bright red/pink in CIR  → high NIR (150+), higher brightness

  // Cedar vote accumulator
  let cedarVotes = 0;
  const totalChecks = 5;

  // Vote 1: Moderate NIR (cedar's dark maroon CIR signature)
  // Oak reflects strongly in NIR (bright red in CIR), cedar does not
  if (nir < 170) cedarVotes++;

  // Vote 2: Dark-to-moderate brightness (dense canopy)
  if (brightness < 115) cedarVotes++;

  // Vote 3: GNDVI lower than NDVI → evergreen signature
  if (idx.gndvi > 0.10 && (idx.gndvi / Math.max(idx.ndvi, 0.01)) < 0.90) cedarVotes++;

  // Vote 4: SAVI confirms vegetation even accounting for soil
  if (idx.savi > 0.25) cedarVotes++;

  // Vote 5: Moderate-to-low red reflectance (chlorophyll absorption)
  if (r < 100) cedarVotes++;

  // Cedar classification: need at least 2 of 5 votes at high NDVI
  if (cedarVotes >= 2) {
    const voteRatio = cedarVotes / totalChecks;
    const conf = Math.min(0.95, 0.5 + voteRatio * 0.3 + (idx.ndvi - 0.35) * 0.3);
    return { classification: 'cedar', confidence: conf, bandVotes: cedarVotes, gndvi: idx.gndvi, savi: idx.savi };
  }

  // Oak: high NIR (bright red in CIR) + brighter visible canopy
  if (nir >= 150 && brightness >= 85) {
    let oakVotes = 1;
    if (nir >= 170) oakVotes++;                                     // very bright red in CIR
    if (idx.gndvi / Math.max(idx.ndvi, 0.01) > 0.8) oakVotes++;    // GNDVI ≈ NDVI → deciduous
    if (brightness >= 100) oakVotes++;                               // bright canopy
    const conf = Math.min(0.85, 0.4 + oakVotes * 0.1);
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

    // 15m uniform grid — dense wall-to-wall coverage, no gaps
    const spacingKm = 0.015; // 15m between sample points

    const grid = turf.pointGrid(bbox, spacingKm, { units: 'kilometers' });
    const pointsInPoly = grid.features.filter((pt) =>
      turf.booleanPointInPolygon(pt, polygon)
    );

    // Use all points — 15m grid is dense but manageable within 300s timeout
    const samplePoints = pointsInPoly;

    if (samplePoints.length === 0) {
      return NextResponse.json(
        { error: 'No sample points generated. Polygon may be too small.' },
        { status: 400 }
      );
    }

    // Batch identify requests against NAIP ImageServer
    const batchSize = 50;
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

    // Build cell polygons for map overlay (15m cells = 7.5m half-size)
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
