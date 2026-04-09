import { NextRequest, NextResponse } from 'next/server';
import * as turf from '@turf/turf';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 min — thorough spectral analysis

/** Cap grid points so large pastures stay within serverless time limits (stride-subsample). */
const MAX_SAMPLE_POINTS = 2800;

const NAIP_IDENTIFY =
  'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/identify';

/** Throttle NAIP `identify` calls to reduce burst traffic and rate-limit / HTTP 429 risk. */
const NAIP_WAVE_CONCURRENCY = 9;
/** Pause after each wave completes (before starting the next wave). */
const NAIP_WAVE_COOLDOWN_MS = 320;
/** Random extra delay so concurrent users don’t retry in lockstep. */
const NAIP_COOLDOWN_JITTER_MS = 120;
/** Stagger start times within a wave so connections don’t open in one tick. */
const NAIP_STAGGER_MS = 48;
const NAIP_IDENTIFY_TIMEOUT_MS = 18_000;

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
  if (idx.ndvi < 0.08 && brightness > 130) {
    let votes = 1;
    if (idx.savi < 0.1) votes++;
    if (idx.exg < 0.02) votes++;
    if (idx.gndvi < 0.1) votes++;
    if (nir < 90) votes++;
    const conf = Math.min(0.95, 0.7 + votes * 0.05);
    return { classification: 'bare', confidence: conf, bandVotes: votes, gndvi: idx.gndvi, savi: idx.savi };
  }

  // Low NDVI but not very bright → could be cedar shadow or oak understory
  if (idx.ndvi < 0.08 && brightness <= 130) {
    // Check for oak first: high NIR + moderate brightness = deciduous canopy even at low NDVI
    if (nir >= 130 && brightness >= 95) {
      let oakVotes = 0;
      if (nir >= 160) oakVotes++;
      if (nir >= 130) oakVotes++;
      if (r >= 80) oakVotes++;
      if (brightness >= 110) oakVotes++;
      if (oakVotes >= 2) {
        const conf = Math.min(0.65, 0.35 + oakVotes * 0.08);
        return { classification: 'oak', confidence: conf, bandVotes: oakVotes, gndvi: idx.gndvi, savi: idx.savi };
      }
    }
    let votes = 1;
    if (brightness < 90) votes++;
    if (nir > 60) votes++;
    if (r < 100) votes++;
    const conf = Math.min(0.7, 0.35 + votes * 0.1);
    return { classification: 'cedar', confidence: conf, bandVotes: votes, gndvi: idx.gndvi, savi: idx.savi };
  }

  // ── Pass 2: Low-moderate NDVI (0.08-0.22) ──
  if (idx.ndvi >= 0.08 && idx.ndvi < 0.22) {
    // Oak check: bright NIR + moderate-bright canopy = deciduous hardwood
    if (nir >= 130 && brightness >= 100) {
      let oakVotes = 0;
      if (nir >= 160) oakVotes++;
      if (nir >= 130) oakVotes++;
      if (idx.gndvi / Math.max(idx.ndvi, 0.01) > 0.80) oakVotes++;
      if (brightness >= 110) oakVotes++;
      if (r >= 80) oakVotes++;
      if (oakVotes >= 3) {
        const conf = Math.min(0.75, 0.4 + oakVotes * 0.08);
        return { classification: 'oak', confidence: conf, bandVotes: oakVotes, gndvi: idx.gndvi, savi: idx.savi };
      }
    }
    if (brightness < 115) {
      let votes = 1;
      if (idx.nirRatio > 1.1) votes++;
      if (r < 90) votes++;
      if (brightness < 80) votes++;
      if (nir > 60) votes++;
      const conf = Math.min(0.75, 0.35 + votes * 0.08);
      return { classification: 'cedar', confidence: conf, bandVotes: votes, gndvi: idx.gndvi, savi: idx.savi };
    }
    let votes = 1;
    if (idx.savi >= 0.05 && idx.savi < 0.25) votes++;
    if (idx.exg > 0 && idx.exg < 0.15) votes++;
    if (brightness >= 130) votes++;
    const conf = Math.min(0.8, 0.5 + votes * 0.07);
    return { classification: 'grass', confidence: conf, bandVotes: votes, gndvi: idx.gndvi, savi: idx.savi };
  }

  // ── Pass 3: Moderate NDVI (0.22-0.35) — transitional zone ──
  if (idx.ndvi >= 0.22 && idx.ndvi < 0.35) {
    let cedarVotes = 0;
    if (brightness < 110) cedarVotes++;
    if (nir < 160) cedarVotes++;
    if (r < 100) cedarVotes++;
    if (idx.gndvi / Math.max(idx.ndvi, 0.01) < 0.95) cedarVotes++;
    if (idx.savi > 0.15) cedarVotes++;

    // Oak escape hatch FIRST
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

  // ── Pass 4: High NDVI (>= 0.35) — dense vegetation ──
  // CHECK OAK FIRST
  if (nir >= 140 && brightness >= 85) {
    let oakVotes = 0;
    if (nir >= 170) oakVotes++;
    if (nir >= 140) oakVotes++;
    if (idx.gndvi / Math.max(idx.ndvi, 0.01) > 0.80) oakVotes++;
    if (brightness >= 100) oakVotes++;
    if (r >= 80) oakVotes++;
    if (oakVotes >= 3) {
      const conf = Math.min(0.85, 0.4 + oakVotes * 0.08);
      return { classification: 'oak', confidence: conf, bandVotes: oakVotes, gndvi: idx.gndvi, savi: idx.savi };
    }
  }

  // Cedar vote accumulator
  let cedarVotes = 0;
  const totalChecks = 5;

  if (nir < 150) cedarVotes++;
  if (brightness < 110) cedarVotes++;
  if (idx.gndvi > 0.10 && (idx.gndvi / Math.max(idx.ndvi, 0.01)) < 0.88) cedarVotes++;
  if (idx.savi > 0.25) cedarVotes++;
  if (r < 90) cedarVotes++;

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

// ── Overlapping tile consensus ──
// Overlays a grid of 5×5-pixel tiles (75m) at 2-pixel stride (30m) = 60% overlap.
// Each pixel is covered by up to 9 tiles. Tiles vote on classification via
// confidence-weighted consensus; final pixel classification is the weighted
// majority across all covering tiles. This eliminates salt-and-pepper noise
// from single-pixel misclassification without any extra API calls.

function applyTileConsensus(
  results: SampleResult[],
  spacingKm: number,
  bbox: number[],
): { refined: SampleResult[]; tileCount: number; consensusImprovedCells: number } {
  if (results.length < 4) {
    return { refined: results, tileCount: 0, consensusImprovedCells: 0 };
  }

  const centerLat = (bbox[1] + bbox[3]) / 2;
  const kmPerDegLng = 111.32 * Math.cos((centerLat * Math.PI) / 180);
  const kmPerDegLat = 111.32;
  const spacingLng = spacingKm / kmPerDegLng;
  const spacingLat = spacingKm / kmPerDegLat;

  const minLng = bbox[0];
  const minLat = bbox[1];

  interface IndexedResult extends SampleResult {
    col: number;
    row: number;
    originalIdx: number;
  }

  const indexed: IndexedResult[] = results.map((r, i) => ({
    ...r,
    col: Math.round((r.lng - minLng) / spacingLng),
    row: Math.round((r.lat - minLat) / spacingLat),
    originalIdx: i,
  }));

  const gridMap = new Map<string, IndexedResult>();
  let maxCol = 0;
  let maxRow = 0;
  for (const ir of indexed) {
    gridMap.set(`${ir.col},${ir.row}`, ir);
    if (ir.col > maxCol) maxCol = ir.col;
    if (ir.row > maxRow) maxRow = ir.row;
  }

  const tileRadius = 2; // 5×5 tile: center ± 2
  const stride = 2;     // 60% overlap: (5 - 2) / 5 = 0.6

  const pixelVotes: Array<Array<{ classification: VegClass; weight: number }>> =
    results.map(() => []);

  let tileCount = 0;

  for (let tc = 0; tc <= maxCol; tc += stride) {
    for (let tr = 0; tr <= maxRow; tr += stride) {
      const tilePixels: IndexedResult[] = [];
      for (let dc = -tileRadius; dc <= tileRadius; dc++) {
        for (let dr = -tileRadius; dr <= tileRadius; dr++) {
          const px = gridMap.get(`${tc + dc},${tr + dr}`);
          if (px) tilePixels.push(px);
        }
      }

      if (tilePixels.length < 2) continue;
      tileCount++;

      const classWeight: Record<VegClass, number> = {
        cedar: 0, oak: 0, mixed_brush: 0, grass: 0, bare: 0,
      };
      for (const px of tilePixels) {
        classWeight[px.classification] += px.confidence * (1 + px.bandVotes * 0.2);
      }

      let winner: VegClass = 'bare';
      let maxW = -1;
      for (const cls of Object.keys(classWeight) as VegClass[]) {
        if (classWeight[cls] > maxW) {
          maxW = classWeight[cls];
          winner = cls;
        }
      }

      const agreeing = tilePixels.filter((p) => p.classification === winner).length;
      const agreement = agreeing / tilePixels.length;
      const agreeConf =
        tilePixels
          .filter((p) => p.classification === winner)
          .reduce((s, p) => s + p.confidence, 0) / agreeing;

      const voteWeight = agreeConf * agreement;
      for (const px of tilePixels) {
        pixelVotes[px.originalIdx].push({ classification: winner, weight: voteWeight });
      }
    }
  }

  let consensusImprovedCells = 0;
  const refined = results.map((original, idx) => {
    const votes = pixelVotes[idx];
    if (votes.length === 0) return original;

    const cw: Record<VegClass, number> = {
      cedar: 0, oak: 0, mixed_brush: 0, grass: 0, bare: 0,
    };
    for (const v of votes) {
      cw[v.classification] += v.weight;
    }

    let bestClass: VegClass = original.classification;
    let bestWeight = -1;
    for (const cls of Object.keys(cw) as VegClass[]) {
      if (cw[cls] > bestWeight) {
        bestWeight = cw[cls];
        bestClass = cls;
      }
    }

    const totalWeight = Object.values(cw).reduce((a, b) => a + b, 0);
    const winFraction = totalWeight > 0 ? bestWeight / totalWeight : 0;

    if (bestClass !== original.classification) {
      consensusImprovedCells++;
      const newConf = Math.min(0.95, original.confidence * 0.3 + winFraction * 0.7);
      return { ...original, classification: bestClass, confidence: Math.round(newConf * 100) / 100 };
    }

    const boostedConf = Math.min(0.95, original.confidence + winFraction * 0.15);
    return { ...original, confidence: Math.round(boostedConf * 100) / 100 };
  });

  return { refined, tileCount, consensusImprovedCells };
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

    const spacingKm = 0.015;

    const grid = turf.pointGrid(bbox, spacingKm, { units: 'kilometers' });
    const pointsInPoly = grid.features.filter((pt) =>
      turf.booleanPointInPolygon(pt, polygon)
    );
    let samplePoints = pointsInPoly;
    let subsampleNote = '';
    if (samplePoints.length > MAX_SAMPLE_POINTS) {
      const stride = Math.ceil(samplePoints.length / MAX_SAMPLE_POINTS);
      samplePoints = samplePoints.filter((_, i) => i % stride === 0);
      subsampleNote = ` (subsampled ${samplePoints.length} of ${pointsInPoly.length} grid points for speed)`;
    }

    if (samplePoints.length === 0) {
      return NextResponse.json(
        { error: 'No sample points generated. Polygon may be too small.' },
        { status: 400 }
      );
    }

    function naipWaveCooldown(): Promise<void> {
      const ms =
        NAIP_WAVE_COOLDOWN_MS + Math.floor(Math.random() * (NAIP_COOLDOWN_JITTER_MS + 1));
      return new Promise((r) => setTimeout(r, ms));
    }

    // Fetch a single NAIP pixel with retry; backs off on HTTP 429 / 503 (rate limits / overload).
    async function fetchPixel(lng: number, lat: number): Promise<SampleResult> {
      const geom = JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } });
      const url = `${NAIP_IDENTIFY}?geometry=${encodeURIComponent(geom)}&geometryType=esriGeometryPoint&returnGeometry=false&returnCatalogItems=false&f=json`;

      const maxAttempts = 6;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(NAIP_IDENTIFY_TIMEOUT_MS) });

          if (res.status === 429 || res.status === 503) {
            const ra = res.headers.get('retry-after');
            const sec =
              ra && /^\d+$/.test(ra.trim())
                ? Math.min(60, parseInt(ra.trim(), 10))
                : Math.min(45, 4 + attempt * 3);
            await new Promise((r) => setTimeout(r, sec * 1000 + Math.random() * 600));
            continue;
          }

          if (!res.ok) {
            if (attempt < maxAttempts - 1) {
              await new Promise((r) => setTimeout(r, 450 * (attempt + 1) + Math.random() * 200));
            }
            continue;
          }

          const data = await res.json();
          const pixelStr: string = data?.value || '';

          if (!pixelStr || pixelStr === 'NoData') {
            return { lng, lat, ndvi: 0, gndvi: 0, savi: 0, classification: 'bare', confidence: 0.3, bandVotes: 0 };
          }

          const vals = pixelStr.split(/[\s,]+/).map(Number).filter((n) => !isNaN(n));
          if (vals.length < 3) continue;

          const [r, g, b] = vals;
          const nir = vals.length >= 4 ? vals[3] : null;
          let ndvi = 0;
          if (nir !== null && nir + r > 0) ndvi = (nir - r) / (nir + r);

          const { classification, confidence, bandVotes, gndvi, savi } = classifyVegetation(r, g, b, nir, ndvi);
          return { lng, lat, ndvi, gndvi, savi, classification, confidence, bandVotes };
        } catch {
          if (attempt < maxAttempts - 1) {
            await new Promise((r) => setTimeout(r, 550 * (attempt + 1) + Math.random() * 250));
          }
        }
      }
      return { lng, lat, ndvi: 0, gndvi: 0, savi: 0, classification: 'bare', confidence: 0.1, bandVotes: 0 };
    }

    const totalPoints = samplePoints.length;
    const totalWaves = Math.ceil(totalPoints / NAIP_WAVE_CONCURRENCY);

    // Stream progress via SSE
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        function send(event: string, data: unknown) {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        }

        try {
        send('progress', {
          phase: 'grid',
          message: `Generated ${totalPoints} sample points at 15m resolution`,
          detail: subsampleNote || undefined,
          totalPoints,
          completed: 0,
          pct: 3,
        });

        const results: SampleResult[] = [];
        let cedarSoFar = 0;
        let oakSoFar = 0;

        for (let w = 0; w < totalWaves; w++) {
          const start = w * NAIP_WAVE_CONCURRENCY;
          const wave = samplePoints.slice(start, start + NAIP_WAVE_CONCURRENCY);
          const waveResults = await Promise.all(
            wave.map((pt, i) =>
              (async () => {
                if (NAIP_STAGGER_MS > 0 && i > 0) {
                  await new Promise((r) => setTimeout(r, i * NAIP_STAGGER_MS));
                }
                return fetchPixel(pt.geometry.coordinates[0], pt.geometry.coordinates[1]);
              })()
            )
          );
          results.push(...waveResults);

          for (const r of waveResults) {
            if (r.classification === 'cedar') cedarSoFar++;
            if (r.classification === 'oak') oakSoFar++;
          }

          const completed = results.length;
          // Map sampling to ~4–88% so later phases can advance smoothly (avoids 88→95 jumps).
          const pct = Math.min(88, 4 + Math.round((completed / totalPoints) * 84));
          send('progress', {
            phase: 'sampling',
            message: `Sampling NAIP imagery — ${completed}/${totalPoints} points`,
            detail: `Cedar: ${cedarSoFar} | Oak: ${oakSoFar} | Wave ${w + 1}/${totalWaves} (${NAIP_WAVE_CONCURRENCY}/wave, throttled)`,
            totalPoints,
            completed,
            pct,
            cedarCount: cedarSoFar,
            oakCount: oakSoFar,
          });

          if (w < totalWaves - 1) {
            await naipWaveCooldown();
          }
        }

        send('progress', {
          phase: 'consensus',
          message: 'Running tile consensus refinement...',
          totalPoints,
          completed: totalPoints,
          pct: 90,
        });


        const { refined, tileCount, consensusImprovedCells } =
          applyTileConsensus(results, spacingKm, bbox);

        send('progress', {
          phase: 'building',
          message: 'Building classification grid...',
          totalPoints,
          completed: totalPoints,
          pct: 94,
        });

        const centerLat = (bbox[1] + bbox[3]) / 2;
        const halfLngDeg = spacingKm / 2 / (111.32 * Math.cos((centerLat * Math.PI) / 180));
        const halfLatDeg = spacingKm / 2 / 111.32;

        const total = refined.length;
        if (total === 0) {
          send('error', { message: 'No spectral samples after processing.' });
          controller.close();
          return;
        }

        const cedarCount = refined.filter((r) => r.classification === 'cedar').length;
        const oakCount = refined.filter((r) => r.classification === 'oak').length;
        const mixedCount = refined.filter((r) => r.classification === 'mixed_brush').length;
        const grassCount = refined.filter((r) => r.classification === 'grass').length;
        const bareCount = refined.filter((r) => r.classification === 'bare').length;

        const cedarPct = total > 0 ? cedarCount / total : 0;
        const avgNdvi = refined.reduce((sum, r) => sum + r.ndvi, 0) / total;
        const avgConf = refined.reduce((sum, r) => sum + r.confidence, 0) / total;
        const avgBandVotes = refined.reduce((sum, r) => sum + r.bandVotes, 0) / total;
        const avgGndvi = refined.reduce((sum, r) => sum + r.gndvi, 0) / total;
        const avgSavi = refined.reduce((sum, r) => sum + r.savi, 0) / total;
        const highConfCedar = refined.filter((r) => r.classification === 'cedar' && r.bandVotes >= 3).length;

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
          cellHalfLngDeg: halfLngDeg,
          cellHalfLatDeg: halfLatDeg,
          tileConsensus: {
            tileCount,
            tileOverlapPct: 60,
            tileSizePixels: 5,
            tileSizeM: Math.round(spacingKm * 5 * 1000),
            stridePixels: 2,
            strideM: Math.round(spacingKm * 2 * 1000),
            consensusImprovedCells,
            consensusImprovedPct: total > 0 ? Math.round((consensusImprovedCells / total) * 100) : 0,
          },
        };

        // Compact `samples` keeps the final SSE line small (full GeoJSON grid was exceeding serverless limits).
        const samples = refined.map((s) => ({
          lng: s.lng,
          lat: s.lat,
          ndvi: s.ndvi,
          gndvi: s.gndvi,
          savi: s.savi,
          classification: s.classification,
          confidence: s.confidence,
          bandVotes: s.bandVotes,
        }));

        send('result', { summary, samples });
        controller.close();
        } catch (streamErr) {
          const message = streamErr instanceof Error ? streamErr.message : 'Spectral stream failed';
          try {
            controller.enqueue(
              encoder.encode(`event: error\ndata: ${JSON.stringify({ message })}\n\n`)
            );
          } catch {
            /* ignore */
          }
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Analysis failed', detail: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
