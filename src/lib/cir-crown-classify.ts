/**
 * Fuse fine-scale crown metrics + 10 m / 60 m NDVI context into cedar / oak / mixed labels.
 * Heuristic — not a trained model; tuned for Ashe juniper vs oak-ish broadleaf in Texas NAIP CIR.
 */

import type { CedarVegClass } from '@/types';
import type { CirBlobFeatures } from '@/lib/cir-blob-features';

export interface CrownClassification {
  classification: CedarVegClass;
  /** 0–100 for UI / summary */
  confidence: number;
  /** 1–5 rough vote strength */
  bandVotes: number;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Broadleaf vs needle-like separation: high (gndvi - ndvi) often tracks broader leaves.
 * Isolation: local NDVI much higher than 60 m neighborhood → scattered juniper in open pasture.
 */
export function classifyCrownFromCirFeatures(f: CirBlobFeatures): CrownClassification {
  const broad = f.gndvi - f.ndvi;
  const iso = f.isolationVs60m;
  const ctx = f.cellNdvi60m;
  const ar = f.aspectRatio;
  const tex = f.ndviStd;

  let cedarScore = 0;
  let oakScore = 0;
  let mixedScore = 0;

  // Scattered cedar in grass: strong local signal, low wide-area NDVI
  if (ctx < 0.34 && f.ndvi > 0.26 && iso > 0.04) cedarScore += 2.5;
  if (ctx < 0.28 && iso > 0.07) cedarScore += 1.5;

  // Continuous canopy / riparian oak: high neighborhood NDVI + broadleaf signal
  if (ctx > 0.42 && broad > 0.03) oakScore += 2.2;
  if (ctx > 0.48 && f.ndvi > 0.35) oakScore += 1.2;

  // Elongated crowns (rows, draws) — weak oak hint
  if (ar > 1.55 && ctx > 0.36) oakScore += 1.0;

  // Roundish, low broadleaf offset — juniper-like
  if (ar < 1.42 && broad < 0.055) cedarScore += 1.8;

  // High internal texture variance — mixed / complex canopy
  if (tex > 0.12 && f.ndvi > 0.3) mixedScore += 1.5;

  // Conflicting strong signals
  if (cedarScore >= 2 && oakScore >= 2) {
    mixedScore += 2;
    cedarScore *= 0.6;
    oakScore *= 0.6;
  }

  const maxS = Math.max(cedarScore, oakScore, mixedScore, 0.4);

  let classification: CedarVegClass = 'cedar';
  if (oakScore >= cedarScore && oakScore >= mixedScore) classification = 'oak';
  else if (mixedScore >= cedarScore && mixedScore >= oakScore) classification = 'mixed_brush';
  else if (cedarScore >= oakScore) classification = 'cedar';

  // Tie-break toward cedar when clearing Ashe juniper is the product default
  if (cedarScore === oakScore && mixedScore < cedarScore) classification = 'cedar';

  const confidence = Math.round(clamp01(maxS / 4) * 100);
  const bandVotes = Math.max(1, Math.min(5, Math.round(1 + maxS)));

  return { classification, confidence, bandVotes };
}
