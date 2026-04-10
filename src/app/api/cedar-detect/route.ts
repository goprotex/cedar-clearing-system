import { NextRequest, NextResponse } from 'next/server';
import * as turf from '@turf/turf';
import { SPECTRAL_GRID_SPACING_KM } from '@/lib/spectral-grid';

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
  /** GNDVI − NDVI: broadleaf (oak) usually ≥ small positive; juniper needles often flatter or lower */
  broadleafIndex: number;
  /** (G−R)/(G+R): oak canopies lean greener vs red than juniper */
  greenRedBalance: number;
}

/** Tunable separation — Ashe juniper (“cedar”) vs live oak in NAIP RGB+NIR (single date). */
const CEDAR_OAK = {
  /** Oak lean when broadleafIndex exceeds this (GNDVI runs ahead of NDVI). */
  oakBroadleafMin: 0.028,
  /** Cedar lean when broadleafIndex is below this. */
  cedarBroadleafMax: 0.012,
  /** Oak lean when visible green clearly exceeds red (normalized). */
  oakGreenRedMin: 0.045,
  /** Cedar lean when canopy looks reddish vs green. */
  cedarGreenRedMax: -0.02,
  /** |oakMinusCedarScore| must exceed this to label oak/cedar (else mixed_brush in treed cells). */
  tieMargin: 0.075,
} as const;

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
  const ndvi = (nir + r) > 0 ? (nir - r) / (nir + r) : 0;
  const gndvi = (nir + g) > 0 ? (nir - g) / (nir + g) : 0;
  const gr = g + r;
  return {
    ndvi,
    gndvi,
    savi: (nir + r + L) > 0 ? ((nir - r) / (nir + r + L)) * (1 + L) : 0,
    exg: brightness > 0 ? (2 * g - r - b) / (r + g + b) : 0,
    nirRatio: brightness > 0 ? nir / brightness : 0,
    broadleafIndex: gndvi - ndvi,
    greenRedBalance: gr > 0 ? (g - r) / gr : 0,
  };
}

/**
 * Oak vs juniper (“cedar”) score difference in roughly −1…1.
 * Positive ⇒ oak; negative ⇒ cedar. Uses traits that separate broadleaf from needle/scale foliage in 4-band NAIP.
 */
function oakMinusCedarScore(
  idx: BandIndices,
  r: number,
  g: number,
  nir: number,
  brightness: number,
): number {
  const { ndvi, gndvi, broadleafIndex, greenRedBalance, exg, nirRatio } = idx;
  let s = 0;
  // Primary: chlorophyll structure — oaks typically show higher GNDVI relative to NDVI than juniper.
  s += broadleafIndex * 5.5;
  // Visible green vs red — oak crowns are often greener; juniper can read more gray–red.
  s += greenRedBalance * 3.5;
  // Excess green (normalized) reinforces broadleaf signal when NDVI is already in the treed range.
  s += (exg - 0.08) * 2.0;
  // NIR density: both can be high; slight lean to oak when NIR is strong with moderate greenness ratio.
  s += (nirRatio - 1.35) * 0.3;
  // Very dark canopies (low brightness) with moderate NDVI often read as juniper thickets in NAIP.
  if (brightness < 100 && ndvi >= 0.12) s -= 0.14;
  // High red channel relative to green pushes toward juniper.
  const rg = r / Math.max(g, 1);
  if (rg > 1.02) s -= (rg - 1.0) * 0.5;
  else if (rg < 0.92) s += 0.1;
  // Mature oak: high NIR with measurably higher GNDVI than NDVI.
  if (nir >= 155 && gndvi > ndvi + 0.02) s += 0.12;
  return Math.max(-1, Math.min(1, s));
}

function classifyTreedOakVsCedar(
  idx: BandIndices,
  r: number,
  g: number,
  nir: number,
  brightness: number,
): { classification: Extract<VegClass, 'cedar' | 'oak' | 'mixed_brush'>; confidence: number; bandVotes: number } {
  const diff = oakMinusCedarScore(idx, r, g, nir, brightness);
  let bandVotes = 1;
  if (idx.broadleafIndex > CEDAR_OAK.oakBroadleafMin) bandVotes++;
  if (idx.broadleafIndex < CEDAR_OAK.cedarBroadleafMax) bandVotes++;
  if (idx.greenRedBalance > CEDAR_OAK.oakGreenRedMin) bandVotes++;
  if (idx.greenRedBalance < CEDAR_OAK.cedarGreenRedMax) bandVotes++;

  const mag = Math.min(1, Math.abs(diff));
  if (diff > CEDAR_OAK.tieMargin) {
    const conf = Math.min(0.92, 0.44 + mag * 0.38 + (bandVotes >= 3 ? 0.06 : 0));
    return { classification: 'oak', confidence: conf, bandVotes };
  }
  if (diff < -CEDAR_OAK.tieMargin) {
    const conf = Math.min(0.92, 0.44 + mag * 0.38 + (bandVotes >= 3 ? 0.06 : 0));
    return { classification: 'cedar', confidence: conf, bandVotes };
  }
  return { classification: 'mixed_brush', confidence: 0.48, bandVotes: Math.max(1, bandVotes - 1) };
}

// ── Multi-band classification with cross-verification ──

function classifyVegetation(
  r: number,
  g: number,
  b: number,
  nir: number | null,
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

  // Low NDVI, not bare: shadow / sparse canopy — use same oak–cedar score when NIR is informative
  if (idx.ndvi < 0.08 && brightness <= 130) {
    if (nir >= 115) {
      const t = classifyTreedOakVsCedar(idx, r, g, nir, brightness);
      if (t.classification !== 'mixed_brush') {
        return { ...t, gndvi: idx.gndvi, savi: idx.savi };
      }
    }
    let votes = 1;
    if (brightness < 90) votes++;
    if (nir > 60) votes++;
    if (r < 100) votes++;
    const conf = Math.min(0.68, 0.34 + votes * 0.09);
    return { classification: 'cedar', confidence: conf, bandVotes: votes, gndvi: idx.gndvi, savi: idx.savi };
  }

  // ── Pass 2: Low-moderate NDVI (0.08–0.22) — grass vs sparse trees ──
  if (idx.ndvi >= 0.08 && idx.ndvi < 0.22) {
    // Require genuinely low NDVI for “turf / herbaceous” — sparse woody can sit 0.14–0.20
    const likelyGrass =
      idx.ndvi < 0.165 &&
      brightness >= 125 &&
      idx.exg > 0.04 &&
      idx.exg < 0.18 &&
      idx.savi >= 0.05 &&
      idx.savi < 0.28 &&
      nir < 145;

    if (likelyGrass) {
      let votes = 1;
      if (idx.savi >= 0.05 && idx.savi < 0.25) votes++;
      if (idx.exg > 0 && idx.exg < 0.15) votes++;
      if (brightness >= 130) votes++;
      const conf = Math.min(0.8, 0.5 + votes * 0.07);
      return { classification: 'grass', confidence: conf, bandVotes: votes, gndvi: idx.gndvi, savi: idx.savi };
    }

    const t = classifyTreedOakVsCedar(idx, r, g, nir, brightness);
    return { ...t, gndvi: idx.gndvi, savi: idx.savi };
  }

  // ── Pass 3: “Bright turf” only in a narrow NDVI band — avoid labeling scattered juniper / oak as lawn
  if (
    idx.ndvi >= 0.22 &&
    idx.ndvi < 0.31 &&
    brightness >= 132 &&
    idx.exg > 0.11 &&
    nir < 148 &&
    idx.nirRatio < 1.4 &&
    idx.broadleafIndex < 0.028
  ) {
    let votes = 2;
    if (idx.savi >= 0.08 && idx.savi < 0.32) votes++;
    const conf = Math.min(0.78, 0.48 + votes * 0.06);
    return { classification: 'grass', confidence: conf, bandVotes: votes, gndvi: idx.gndvi, savi: idx.savi };
  }

  const t = classifyTreedOakVsCedar(idx, r, g, nir, brightness);
  return { ...t, gndvi: idx.gndvi, savi: idx.savi };
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

    // ~10 m grid — better crown sampling than 15 m (sparse trees were blending to grass/bare)
    const spacingKm = SPECTRAL_GRID_SPACING_KM;

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

    // Fetch a single NAIP pixel with retry
    async function fetchPixel(lng: number, lat: number, retries = 2): Promise<SampleResult> {
      const geom = JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } });
      const url = `${NAIP_IDENTIFY}?geometry=${encodeURIComponent(geom)}&geometryType=esriGeometryPoint&returnGeometry=false&returnCatalogItems=false&f=json`;

      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
          if (!res.ok) continue;

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

          const { classification, confidence, bandVotes, gndvi, savi } = classifyVegetation(r, g, b, nir);
          return { lng, lat, ndvi, gndvi, savi, classification, confidence, bandVotes };
        } catch {
          if (attempt < retries) await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        }
      }
      // All retries failed — return as bare with low confidence rather than dropping
      return { lng, lat, ndvi: 0, gndvi: 0, savi: 0, classification: 'bare', confidence: 0.1, bandVotes: 0 };
    }

    // Batch identify requests against NAIP ImageServer
    const batchSize = 40;
    const results: SampleResult[] = [];

    for (let i = 0; i < samplePoints.length; i += batchSize) {
      const batch = samplePoints.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((pt) => {
          const [lng, lat] = pt.geometry.coordinates;
          return fetchPixel(lng, lat);
        })
      );
      results.push(...batchResults);
    }

    if (results.length === 0) {
      return NextResponse.json(
        { error: 'No NAIP data available for this area' },
        { status: 404 }
      );
    }

    // Overlapping tile consensus: refine classifications using spatial context
    const { refined, tileCount, consensusImprovedCells } =
      applyTileConsensus(results, spacingKm, bbox);

    // Build cell polygons for map overlay (15m cells = 7.5m half-size)
    const centerLat = (bbox[1] + bbox[3]) / 2;
    const halfLngDeg = spacingKm / 2 / (111.32 * Math.cos((centerLat * Math.PI) / 180));
    const halfLatDeg = spacingKm / 2 / 111.32;

    const gridCells: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: refined.map((s) => ({
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

    // Summary statistics (computed from consensus-refined results)
    const total = refined.length;
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

    // High-confidence cedar: cells where ≥3 bands agreed
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
