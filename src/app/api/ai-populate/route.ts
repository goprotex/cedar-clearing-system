import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 30;

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

const SYSTEM_PROMPT = `You are an expert Texas Hill Country cedar/brush clearing estimator.
Given terrain, soil, vegetation analysis, and spectral data for a pasture, recommend the best bid parameters.

You MUST return ONLY valid JSON with these exact fields:
{
  "vegetationType": "cedar" | "oak" | "mixed" | "mesquite" | "brush",
  "density": "light" | "moderate" | "heavy" | "extreme",
  "terrain": "flat" | "rolling" | "steep" | "rugged",
  "clearingMethod": "fine_mulch" | "rough_mulch" | "chainsaw_pile" | "chainsaw_haul" | "dozer_push" | "selective_thin" | "cedar_only" | "row_fence_line",
  "disposalMethod": "mulch_in_place" | "pile_and_burn" | "haul_off" | "chip_and_spread" | "stack_for_customer",
  "notes": "string - concise field notes for this pasture",
  "reasoning": "string - one paragraph explaining your choices",
  "estimatedDifficulty": number 1-10,
  "suggestedAdders": ["stump_grinding" | "haul_off" | "burn_pile" | "reseeding" | "oak_protection" | "fence_line"]
}

Guidelines:
- Cedar >50%: use "cedar" vegetation, consider "cedar_only" method if oaks present
- Mixed cedar/oak: use "mixed" vegetation, consider "selective_thin"
- High soil slope (>12%): bump terrain to "steep" or "rugged"
- High rock fragment volume (>25%): increases difficulty, consider "chainsaw_pile"
- Elevation >1800ft typical Hill Country: more cedar expected
- NDVI <0.2: sparse/bare, minimal clearing needed
- NDVI >0.4: dense canopy
- If cedar density >60%, recommend "heavy" or "extreme"
- Suggest "oak_protection" adder when oak percentage is significant (>15%)
- Suggest "reseeding" when grass coverage is low (<20%)
- Suggest "stump_grinding" for fine_mulch or when premium finish requested
- mulch_in_place is default for mulching methods; pile_and_burn for chainsaw methods
- Difficulty 1-3: easy flat open land; 4-6: moderate; 7-8: difficult terrain/density; 9-10: extremely challenging`;

interface PopulateRequest {
  acreage: number;
  centroid: [number, number];
  elevationFt: number | null;
  soilData: {
    series: string;
    slope_r: number;
    fragvol_r: number;
    drainagecl: string;
    resdept_r: number | null;
  } | null;
  soilMultiplier: number;
  cedarAnalysis: {
    summary: {
      cedar: { pct: number };
      oak: { pct: number };
      mixedBrush: { pct: number };
      grass: { pct: number };
      bare: { pct: number };
      estimatedCedarAcres: number;
      averageNDVI: number;
      confidence: number;
    };
    claudeVision: {
      cedarPct: number;
      oakPct: number;
      brushPct: number;
      grassPct: number;
      barePct: number;
      cedarDensity: string;
      notes: string;
    } | null;
  } | null;
  seasonalAnalysis: {
    winterNDVI: number | null;
    summerNDVI: number | null;
    ndviChange: number | null;
    cedarPct: number;
    evergreenPct: number;
    deciduousPct: number;
    dormantPct: number;
  } | null;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.CLAUDE_VISION;
  if (!apiKey) {
    return NextResponse.json({ error: 'API key not configured' }, { status: 500 });
  }

  let data: PopulateRequest;
  try {
    data = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!data.acreage || data.acreage <= 0) {
    return NextResponse.json({ error: 'Valid acreage required' }, { status: 400 });
  }

  // Build user prompt with all available data
  const parts: string[] = [];
  parts.push(`Pasture: ${data.acreage.toFixed(1)} acres`);
  parts.push(`Location: ${data.centroid[1].toFixed(4)}°N, ${Math.abs(data.centroid[0]).toFixed(4)}°W`);

  if (data.elevationFt) {
    parts.push(`Elevation: ${data.elevationFt} ft`);
  }

  if (data.soilData) {
    parts.push(`Soil: ${data.soilData.series} series, ${data.soilData.slope_r}% slope, ${data.soilData.fragvol_r}% rock fragments, ${data.soilData.drainagecl}, depth ${data.soilData.resdept_r ?? 'unknown'} cm`);
    parts.push(`Soil difficulty multiplier: ${data.soilMultiplier}`);
  }

  if (data.cedarAnalysis) {
    const s = data.cedarAnalysis.summary;
    parts.push(`Spectral Analysis (NAIP): Cedar ${s.cedar.pct.toFixed(0)}%, Oak ${s.oak.pct.toFixed(0)}%, Mixed Brush ${s.mixedBrush.pct.toFixed(0)}%, Grass ${s.grass.pct.toFixed(0)}%, Bare ${s.bare.pct.toFixed(0)}%`);
    parts.push(`Estimated cedar acres: ${s.estimatedCedarAcres.toFixed(1)}, Avg NDVI: ${s.averageNDVI.toFixed(3)}, Confidence: ${(s.confidence * 100).toFixed(0)}%`);

    if (data.cedarAnalysis.claudeVision) {
      const cv = data.cedarAnalysis.claudeVision;
      parts.push(`Claude Vision (satellite): Cedar ${cv.cedarPct}%, Oak ${cv.oakPct}%, Brush ${cv.brushPct}%, Grass ${cv.grassPct}%, Bare ${cv.barePct}%. Density: ${cv.cedarDensity}. Notes: ${cv.notes}`);
    }
  }

  if (data.seasonalAnalysis) {
    const sa = data.seasonalAnalysis;
    parts.push(`Seasonal NDVI: Winter ${sa.winterNDVI?.toFixed(3) ?? 'N/A'}, Summer ${sa.summerNDVI?.toFixed(3) ?? 'N/A'}, Change ${sa.ndviChange?.toFixed(3) ?? 'N/A'}`);
    parts.push(`Seasonal classification: Evergreen ${sa.evergreenPct}%, Deciduous ${sa.deciduousPct}%, Cedar ${sa.cedarPct}%, Dormant ${sa.dormantPct}%`);
  }

  const userPrompt = parts.join('\n');

  try {
    const res = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Anthropic API error:', res.status, errText);
      return NextResponse.json({ error: 'AI service error' }, { status: 502 });
    }

    const result = await res.json();
    const text: string = result?.content?.[0]?.text || '';

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 502 });
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate and sanitize the response
    const validVeg = ['cedar', 'oak', 'mixed', 'mesquite', 'brush'];
    const validDensity = ['light', 'moderate', 'heavy', 'extreme'];
    const validTerrain = ['flat', 'rolling', 'steep', 'rugged'];
    const validMethod = ['fine_mulch', 'rough_mulch', 'chainsaw_pile', 'chainsaw_haul', 'dozer_push', 'selective_thin', 'cedar_only', 'row_fence_line'];
    const validDisposal = ['mulch_in_place', 'pile_and_burn', 'haul_off', 'chip_and_spread', 'stack_for_customer'];
    const validAdders = ['stump_grinding', 'haul_off', 'burn_pile', 'reseeding', 'oak_protection', 'fence_line'];

    const recommendation = {
      vegetationType: validVeg.includes(parsed.vegetationType) ? parsed.vegetationType : 'cedar',
      density: validDensity.includes(parsed.density) ? parsed.density : 'moderate',
      terrain: validTerrain.includes(parsed.terrain) ? parsed.terrain : 'rolling',
      clearingMethod: validMethod.includes(parsed.clearingMethod) ? parsed.clearingMethod : 'rough_mulch',
      disposalMethod: validDisposal.includes(parsed.disposalMethod) ? parsed.disposalMethod : 'mulch_in_place',
      notes: String(parsed.notes || '').slice(0, 500),
      reasoning: String(parsed.reasoning || '').slice(0, 1000),
      estimatedDifficulty: Math.min(10, Math.max(1, Math.round(Number(parsed.estimatedDifficulty) || 5))),
      suggestedAdders: Array.isArray(parsed.suggestedAdders)
        ? parsed.suggestedAdders.filter((a: string) => validAdders.includes(a))
        : [],
    };

    return NextResponse.json(recommendation);
  } catch (err) {
    console.error('AI populate error:', err);
    return NextResponse.json({ error: 'AI service unavailable' }, { status: 502 });
  }
}
