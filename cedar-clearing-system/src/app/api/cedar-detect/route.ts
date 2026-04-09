import { NextRequest, NextResponse } from 'next/server';
import * as turf from '@turf/turf';

export const maxDuration = 300; // 5 min — thorough spectral analysis

const NAIP_IDENTIFY =
  'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/identify';

/** At most 2 NAIP identify calls in flight; pause between pairs to avoid rate limits */
const CONCURRENCY = 2;
/** Delay between completing one pair and starting the next (ms) */
const DELAY_BETWEEN_PAIRS_MS = 550;
const IDENTIFY_TIMEOUT_MS = 18000;
const MAX_RETRIES = 4;

type VegClass = 'cedar' | 'oak' | 'mixed_brush' | 'grass' | 'bare';

interface BandIndices {
  ndvi: number;
  gndvi: number;
  savi: number;
  exg: number;
  nirRatio: number;
}

interface SampleResult {
  lng: number;
  lat: number;
  ndvi: number;
  gndvi: number;
  savi: number;
  classification: VegClass;
  confidence: number;
  bandVotes: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function computeIndices(r: number, g: number, b: number, nir: number): BandIndices {
  const brightness = (r + g + b) / 3;
  const L = 0.5;
  return {
    ndvi: (nir + r) > 0 ? (nir - r) / (nir + r) : 0,
    gndvi: (nir + g) > 0 ? (nir - g) / (nir + g) : 0,
    savi: (nir + r + L) > 0 ? ((nir - r) / (nir + r + L)) * (1 + L) : 0,
    exg: brightness > 0 ? (2 * g - r - b) / (r + g + b) : 0,
    nirRatio: brightness > 0 ? nir / brightness : 0,
  };
}

function classifyVegetation(
  r: number,
  g: number,
  b: number,
  nir: number | null,
  ndvi: number
): { classification: VegClass; confidence: number; bandVotes: number; gndvi: number; savi: number } {
  if (nir === null) {
    const brightness = (r + g + b) / 3;
    if (brightness < 80 && g > r) return { classification: 'cedar', confidence: 0.3, bandVotes: 0, gndvi: 0, savi: 0 };
    if (brightness < 120 && g > b) return { classification: 'mixed_brush', confidence: 0.25, bandVotes: 0, gndvi: 0, savi: 0 };
    if (g > r && g > b) return { classification: 'grass', confidence: 0.3, bandVotes: 0, gndvi: 0, savi: 0 };
    return { classification: 'bare', confidence: 0.35, bandVotes: 0, gndvi: 0, savi: 0 };
  }

  const idx = computeIndices(r, g, b, nir);
  const brightness = (r + g + b) / 3;

  if (idx.ndvi < 0.08 && brightness > 120) {
    let votes = 1;
    if (idx.savi < 0.1) votes++;
    if (idx.exg < 0.02) votes++;
    if (idx.gndvi < 0.1) votes++;
    if (nir < 90) votes++;
    const conf = Math.min(0.95, 0.7 + votes * 0.05);
    return { classification: 'bare', confidence: conf, bandVotes: votes, gndvi: idx.gndvi, savi: idx.savi };
  }

  if (idx.ndvi < 0.08 && brightness <= 100) {
    let votes = 1;
    if (brightness < 80) votes++;
    if (nir > 60) votes++;
    if (r < 80) votes++;
    const conf = Math.min(0.7, 0.35 + votes * 0.1);
    return { classification: 'cedar', confidence: conf, bandVotes: votes, gndvi: idx.gndvi, savi: idx.savi };
  }

  if (idx.ndvi < 0.08) {
    return { classification: 'grass', confidence: 0.45, bandVotes: 1, gndvi: idx.gndvi, savi: idx.savi };
  }

  if (idx.ndvi >= 0.08 && idx.ndvi < 0.22) {
    if (brightness < 95) {
      let votes = 1;
      if (idx.nirRatio > 1.1) votes++;
      if (r < 80) votes++;
      if (brightness < 70) votes++;
      if (nir > 60) votes++;
      const conf = Math.min(0.75, 0.35 + votes * 0.08);
      return { classification: 'cedar', confidence: conf, bandVotes: votes, gndvi: idx.gndvi, savi: idx.savi };
    }
    let votes = 1;
    if (idx.savi >= 0.05 && idx.savi < 0.25) votes++;
    if (idx.exg > 0 && idx.exg < 0.15) votes++;
    if (brightness >= 110) votes++;
    const conf = Math.min(0.8, 0.5 + votes * 0.07);
    return { classification: 'grass', confidence: conf, bandVotes: votes, gndvi: idx.gndvi, savi: idx.savi };
  }

  if (idx.ndvi >= 0.22 && idx.ndvi < 0.35) {
    let cedarVotes = 0;
    if (brightness < 95) cedarVotes++;
    if (nir < 145) cedarVotes++;
    if (r < 85) cedarVotes++;
    if (idx.gndvi / Math.max(idx.ndvi, 0.01) < 0.9) cedarVotes++;
    if (idx.savi > 0.18) cedarVotes++;

    if (nir >= 140 && brightness >= 90) {
      let oakVotes = 1;
      if (nir >= 160) oakVotes++;
      if (idx.gndvi / Math.max(idx.ndvi, 0.01) > 0.85) oakVotes++;
      if (brightness >= 105) oakVotes++;
      if (oakVotes >= 2) {
        const conf = Math.min(0.75, 0.4 + oakVotes * 0.1);
        return { classification: 'oak', confidence: conf, bandVotes: oakVotes, gndvi: idx.gndvi, savi: idx.savi };
      }
    }

    if (cedarVotes >= 2) {
      const conf = Math.min(0.8, 0.35 + cedarVotes * 0.1 + (idx.ndvi - 0.22) * 0.5);
      return { classification: 'cedar', confidence: conf, bandVotes: cedarVotes, gndvi: idx.gndvi, savi: idx.savi };
    }

    if (cedarVotes === 1 && brightness < 90) {
      return { classification: 'cedar', confidence: 0.4, bandVotes: 1, gndvi: idx.gndvi, savi: idx.savi };
    }

    return { classification: 'grass', confidence: 0.5, bandVotes: 1, gndvi: idx.gndvi, savi: idx.savi };
  }

  if (nir >= 140 && brightness >= 85) {
    let oakVotes = 0;
    if (nir >= 170) oakVotes++;
    if (nir >= 140) oakVotes++;
    if (idx.gndvi / Math.max(idx.ndvi, 0.01) > 0.8) oakVotes++;
    if (brightness >= 100) oakVotes++;
    if (r >= 80) oakVotes++;
    if (oakVotes >= 3) {
      const conf = Math.min(0.85, 0.4 + oakVotes * 0.08);
      return { classification: 'oak', confidence: conf, bandVotes: oakVotes, gndvi: idx.gndvi, savi: idx.savi };
    }
  }

  let cedarVotes = 0;
  const totalChecks = 5;
  if (nir < 140) cedarVotes++;
  if (brightness < 95) cedarVotes++;
  if (idx.gndvi > 0.1 && idx.gndvi / Math.max(idx.ndvi, 0.01) < 0.85) cedarVotes++;
  if (idx.savi > 0.28) cedarVotes++;
  if (r < 80) cedarVotes++;

  if (cedarVotes >= 2) {
    const voteRatio = cedarVotes / totalChecks;
    const conf = Math.min(0.95, 0.5 + voteRatio * 0.3 + (idx.ndvi - 0.35) * 0.3);
    return { classification: 'cedar', confidence: conf, bandVotes: cedarVotes, gndvi: idx.gndvi, savi: idx.savi };
  }

  if (nir >= 130 && brightness >= 85) {
    return { classification: 'oak', confidence: 0.45, bandVotes: 1, gndvi: idx.gndvi, savi: idx.savi };
  }

  return { classification: 'mixed_brush', confidence: 0.45, bandVotes: 1, gndvi: idx.gndvi, savi: idx.savi };
}

function getClassColor(classification: VegClass, ndvi: number): string {
  switch (classification) {
    case 'cedar':
      if (ndvi > 0.5) return '#dc2626';
      if (ndvi > 0.4) return '#ea580c';
      return '#f97316';
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

async function fetchIdentifyPixel(lng: number, lat: number, attempt = 0): Promise<SampleResult | null> {
  const geom = JSON.stringify({
    x: lng,
    y: lat,
    spatialReference: { wkid: 4326 },
  });
  const url = `${NAIP_IDENTIFY}?geometry=${encodeURIComponent(geom)}&geometryType=esriGeometryPoint&returnGeometry=false&returnCatalogItems=false&f=json`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(IDENTIFY_TIMEOUT_MS),
    });

    if (res.status === 429 || res.status === 503) {
      if (attempt < MAX_RETRIES) {
        await sleep(2500 * Math.pow(2, attempt));
        return fetchIdentifyPixel(lng, lat, attempt + 1);
      }
      return null;
    }

    if (!res.ok) {
      if (attempt < MAX_RETRIES && res.status >= 500) {
        await sleep(1200 * (attempt + 1));
        return fetchIdentifyPixel(lng, lat, attempt + 1);
      }
      return null;
    }

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
    if (attempt < MAX_RETRIES) {
      await sleep(1000 * (attempt + 1));
      return fetchIdentifyPixel(lng, lat, attempt + 1);
    }
    return null;
  }
}

/** Two identifies at a time, then a fixed pause before the next pair (reduces NAIP rate-limit pressure). */
async function sampleNaipThrottled(
  samplePoints: GeoJSON.Feature<GeoJSON.Point>[],
  onProgress: (done: number, total: number) => void
): Promise<Array<SampleResult | null>> {
  const out: Array<SampleResult | null> = new Array(samplePoints.length).fill(null);
  let completed = 0;
  const total = samplePoints.length;

  for (let i = 0; i < samplePoints.length; i += CONCURRENCY) {
    const slice = samplePoints.slice(i, i + CONCURRENCY);
    const indices = slice.map((_, j) => i + j);

    const batchResults = await Promise.all(
      slice.map(async (pt, j) => {
        const [lng, lat] = pt.geometry.coordinates;
        return fetchIdentifyPixel(lng, lat);
      })
    );

    for (let j = 0; j < batchResults.length; j++) {
      out[indices[j]] = batchResults[j];
      completed++;
      onProgress(completed, total);
    }

    if (i + CONCURRENCY < samplePoints.length) {
      await sleep(DELAY_BETWEEN_PAIRS_MS);
    }
  }

  return out;
}

// ── API handler — NDJSON stream with real progress ──

export async function POST(req: NextRequest) {
  const accept = req.headers.get('accept') || '';
  const wantsStream = accept.includes('application/x-ndjson') || accept.includes('application/ndjson');

  if (!wantsStream) {
    return NextResponse.json(
      { error: 'Client must request streaming', hint: 'Send Accept: application/x-ndjson' },
      { status: 400 }
    );
  }

  let body: { coordinates?: number[][][]; acreage?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { coordinates, acreage } = body;
  if (!coordinates || !Array.isArray(coordinates) || coordinates.length === 0) {
    return NextResponse.json({ error: 'Polygon coordinates required' }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (obj: object) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      };

      try {
        const polygon = turf.polygon(coordinates);
        const bbox = turf.bbox(polygon);
        const ac = acreage || turf.area(polygon) / 4047;
        const spacingKm = 0.015;

        const grid = turf.pointGrid(bbox, spacingKm, { units: 'kilometers' });
        const samplePoints = grid.features.filter((pt) => turf.booleanPointInPolygon(pt, polygon));

        if (samplePoints.length === 0) {
          push({ type: 'error', status: 400, message: 'No sample points generated. Polygon may be too small.' });
          controller.close();
          return;
        }

        push({
          type: 'progress',
          percent: 2,
          step: 'Sample grid ready',
          detail: `${samplePoints.length} cells at 15m spacing — throttled NAIP requests (2 concurrent, ${DELAY_BETWEEN_PAIRS_MS}ms pause between pairs)`,
        });

        let lastEmittedPct = -1;
        const raw = await sampleNaipThrottled(samplePoints, (done, total) => {
          const pct = 2 + Math.round((done / total) * 82);
          const capped = Math.min(pct, 84);
          if (done === total || capped !== lastEmittedPct) {
            lastEmittedPct = capped;
            push({
              type: 'progress',
              percent: capped,
              step: 'Sampling NAIP imagery',
              detail: `${done} / ${total} cells`,
            });
          }
        });

        const results = raw.filter((r): r is SampleResult => r !== null);

        if (results.length === 0) {
          push({
            type: 'error',
            status: 404,
            message: 'No NAIP data available for this area (all samples failed or timed out)',
          });
          controller.close();
          return;
        }

        push({ type: 'progress', percent: 88, step: 'Building map overlay', detail: 'Rasterizing classification grid' });

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

        const totalN = results.length;
        const cedarCount = results.filter((r) => r.classification === 'cedar').length;
        const oakCount = results.filter((r) => r.classification === 'oak').length;
        const mixedCount = results.filter((r) => r.classification === 'mixed_brush').length;
        const grassCount = results.filter((r) => r.classification === 'grass').length;
        const bareCount = results.filter((r) => r.classification === 'bare').length;
        const cedarPct = totalN > 0 ? cedarCount / totalN : 0;
        const avgNdvi = results.reduce((sum, r) => sum + r.ndvi, 0) / totalN;
        const avgConf = results.reduce((sum, r) => sum + r.confidence, 0) / totalN;
        const avgBandVotes = results.reduce((sum, r) => sum + r.bandVotes, 0) / totalN;
        const avgGndvi = results.reduce((sum, r) => sum + r.gndvi, 0) / totalN;
        const avgSavi = results.reduce((sum, r) => sum + r.savi, 0) / totalN;
        const highConfCedar = results.filter((r) => r.classification === 'cedar' && r.bandVotes >= 3).length;

        const summary = {
          totalSamples: totalN,
          cedar: { count: cedarCount, pct: Math.round(cedarPct * 100) },
          oak: { count: oakCount, pct: Math.round((oakCount / totalN) * 100) },
          mixedBrush: { count: mixedCount, pct: Math.round((mixedCount / totalN) * 100) },
          grass: { count: grassCount, pct: Math.round((grassCount / totalN) * 100) },
          bare: { count: bareCount, pct: Math.round((bareCount / totalN) * 100) },
          estimatedCedarAcres: Math.round(cedarPct * ac * 10) / 10,
          averageNDVI: Math.round(avgNdvi * 1000) / 1000,
          averageGNDVI: Math.round(avgGndvi * 1000) / 1000,
          averageSAVI: Math.round(avgSavi * 1000) / 1000,
          confidence: Math.round(avgConf * 100),
          avgBandVotes: Math.round(avgBandVotes * 10) / 10,
          highConfidenceCedarCells: highConfCedar,
          gridSpacingM: Math.round(spacingKm * 1000),
        };

        push({ type: 'progress', percent: 98, step: 'Finalizing', detail: 'Packaging results' });
        push({
          type: 'complete',
          data: { gridCells, summary },
        });
      } catch (err) {
        push({
          type: 'error',
          status: 500,
          message: err instanceof Error ? err.message : 'Analysis failed',
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
