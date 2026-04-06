import { NextRequest, NextResponse } from 'next/server';
import * as turf from '@turf/turf';

export const maxDuration = 55; // Vercel function timeout

const NAIP_IDENTIFY =
  'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/identify';
const NAIP_EXPORT =
  'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage';
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

type VegClass = 'cedar' | 'oak' | 'mixed_brush' | 'grass' | 'bare';

interface SampleResult {
  lng: number;
  lat: number;
  ndvi: number;
  classification: VegClass;
  confidence: number;
}

// ── Classification logic ──

function classifyVegetation(
  r: number,
  g: number,
  b: number,
  nir: number | null,
  ndvi: number
): { classification: VegClass; confidence: number } {
  // RGB-only fallback (no NIR band)
  if (nir === null) {
    const brightness = (r + g + b) / 3;
    if (brightness < 80 && g > r) return { classification: 'cedar', confidence: 0.4 };
    if (brightness < 120 && g > b) return { classification: 'mixed_brush', confidence: 0.35 };
    if (g > r && g > b) return { classification: 'grass', confidence: 0.4 };
    return { classification: 'bare', confidence: 0.45 };
  }

  // 4-band NAIP classification (RGB + NIR)

  // Bare ground / rock / road
  if (ndvi < 0.12) {
    return { classification: 'bare', confidence: 0.85 };
  }

  // Grass / sparse vegetation
  if (ndvi >= 0.12 && ndvi < 0.28) {
    return { classification: 'grass', confidence: 0.7 };
  }

  // Dense vegetation zone (NDVI >= 0.28)
  const brightness = (r + g + b) / 3;
  const nirRatio = nir / Math.max(brightness, 1);
  const redGreenRatio = r / Math.max(g, 1);

  // Ashe Juniper (cedar) in Texas Hill Country:
  //   - Evergreen → high NDVI year-round
  //   - Dense dark canopy → low visible brightness
  //   - High NIR reflectance → high NIR/brightness ratio
  //   - Low red channel (strong chlorophyll absorption)
  if (ndvi > 0.35 && brightness < 95 && r < 90 && nirRatio > 1.8) {
    const conf = Math.min(0.85, 0.6 + (ndvi - 0.35) * 0.5 + (1 - brightness / 150) * 0.15);
    return { classification: 'cedar', confidence: conf };
  }

  if (ndvi > 0.28 && brightness < 110 && r < 100 && g > 50) {
    const conf = Math.min(0.75, 0.5 + (ndvi - 0.28) * 0.3);
    return { classification: 'cedar', confidence: conf };
  }

  // Brighter vegetation with higher red → deciduous (oak, etc.)
  if (ndvi > 0.28 && brightness >= 95 && redGreenRatio > 0.85) {
    return { classification: 'oak', confidence: 0.6 };
  }

  return { classification: 'mixed_brush', confidence: 0.5 };
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

// ── Claude Vision prompt ──

const CEDAR_VISION_PROMPT = `You are an expert arborist and vegetation analyst specializing in Texas Hill Country vegetation, particularly Ashe Juniper (cedar) identification.

You are looking at two aerial images of the same ranch pasture in the Texas Hill Country:
1. FIRST IMAGE: Natural color (RGB) aerial photo at 0.6m resolution from NAIP
2. SECOND IMAGE: Color Infrared (CIR) — bands are NIR/Red/Green. In CIR:
   - Bright pink/red = healthy broadleaf vegetation (live oak, deciduous trees)
   - Dark maroon/brown-red = evergreen conifers (Ashe Juniper/cedar)
   - Light pink = grass/pasture
   - White/cyan = bare ground, roads, rock

Key identification features for Ashe Juniper (cedar):
- In RGB: Dark green, dense dome/conical canopy, grows in clusters
- In CIR: Dark maroon/brown (NOT bright pink — that's oak)
- Evergreen year-round (stays dark green even in winter)
- Often found on hillsides, along fence lines, in draws

Key identification features for Live Oak:
- In RGB: Lighter green, broad spreading canopy, larger individual crowns
- In CIR: Bright pink/red (high NIR reflectance)
- Semi-evergreen in Texas (may thin in late winter)

Analyze both images and estimate vegetation percentages. Return ONLY valid JSON:
{
  "cedarPct": <number 0-100>,
  "oakPct": <number 0-100>,
  "brushPct": <number 0-100>,
  "grassPct": <number 0-100>,
  "barePct": <number 0-100>,
  "cedarDensity": "<light|moderate|heavy|extreme>",
  "confidence": <number 0-100>,
  "notes": "<2-3 sentence professional assessment of vegetation pattern, cedar distribution, and any clearing recommendations>"
}`;

// ── Claude Vision analysis ──

interface ClaudeVisionResult {
  cedarPct: number;
  oakPct: number;
  brushPct: number;
  grassPct: number;
  barePct: number;
  cedarDensity: string;
  confidence: number;
  notes: string;
}

async function runClaudeVision(
  bbox: number[],
  claudeKey: string
): Promise<ClaudeVisionResult | null> {
  try {
    const bboxStr = `${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]}`;
    const rgbUrl = `${NAIP_EXPORT}?bbox=${bboxStr}&bboxSR=4326&imageSR=4326&size=1024,1024&format=png&f=image`;
    const cirUrl = `${NAIP_EXPORT}?bbox=${bboxStr}&bboxSR=4326&imageSR=4326&size=1024,1024&format=png&bandIds=3,0,1&f=image`;

    // Fetch both images in parallel
    const [rgbRes, cirRes] = await Promise.all([
      fetch(rgbUrl, { signal: AbortSignal.timeout(15000) }),
      fetch(cirUrl, { signal: AbortSignal.timeout(15000) }),
    ]);

    if (!rgbRes.ok || !cirRes.ok) return null;

    const [rgbBuf, cirBuf] = await Promise.all([
      rgbRes.arrayBuffer(),
      cirRes.arrayBuffer(),
    ]);

    const rgbB64 = Buffer.from(rgbBuf).toString('base64');
    const cirB64 = Buffer.from(cirBuf).toString('base64');

    // Call Claude API with both images
    const claudeRes = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'x-api-key': claudeKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/png', data: rgbB64 },
              },
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/png', data: cirB64 },
              },
              { type: 'text', text: CEDAR_VISION_PROMPT },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!claudeRes.ok) return null;

    const claudeData = await claudeRes.json();
    const text: string = claudeData?.content?.[0]?.text || '';

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      cedarPct: Number(parsed.cedarPct) || 0,
      oakPct: Number(parsed.oakPct) || 0,
      brushPct: Number(parsed.brushPct) || 0,
      grassPct: Number(parsed.grassPct) || 0,
      barePct: Number(parsed.barePct) || 0,
      cedarDensity: parsed.cedarDensity || 'moderate',
      confidence: Number(parsed.confidence) || 50,
      notes: String(parsed.notes || ''),
    };
  } catch {
    return null;
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
              return { lng, lat, ndvi: 0, classification: 'bare', confidence: 0.3 };
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

            const { classification, confidence } = classifyVegetation(r, g, b, nir, ndvi);
            return { lng, lat, ndvi, classification, confidence };
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
          confidence: Math.round(s.confidence * 100) / 100,
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

    const summary = {
      totalSamples: total,
      cedar: { count: cedarCount, pct: Math.round(cedarPct * 100) },
      oak: { count: oakCount, pct: Math.round((oakCount / total) * 100) },
      mixedBrush: { count: mixedCount, pct: Math.round((mixedCount / total) * 100) },
      grass: { count: grassCount, pct: Math.round((grassCount / total) * 100) },
      bare: { count: bareCount, pct: Math.round((bareCount / total) * 100) },
      estimatedCedarAcres: Math.round(cedarPct * ac * 10) / 10,
      averageNDVI: Math.round(avgNdvi * 1000) / 1000,
      confidence: Math.round(avgConf * 100),
      gridSpacingM: Math.round(spacingKm * 1000),
    };

    // Step 2: Claude Vision analysis (if API key available)
    let claudeVision: ClaudeVisionResult | null = null;
    const claudeKey = process.env.CLAUDE_VISION;
    if (claudeKey) {
      claudeVision = await runClaudeVision(bbox, claudeKey);
    }

    return NextResponse.json(
      { gridCells, summary, claudeVision },
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
