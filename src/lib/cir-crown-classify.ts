/**
 * Fuse fine-scale crown metrics + 10 m / 60 m NDVI context into cedar / oak / mixed labels.
 * Heuristic — not a trained model; thresholds come from CirClassifierCalibration (defaults + localStorage).
 */

import type { CedarVegClass } from '@/types';
import type { CirBlobFeatures } from '@/lib/cir-blob-features';
import type { CirClassifierCalibration } from '@/lib/cir-calibration';
import { DEFAULT_CIR_CALIBRATION } from '@/lib/cir-calibration';

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
export function classifyCrownFromCirFeatures(
  f: CirBlobFeatures,
  cal: CirClassifierCalibration = DEFAULT_CIR_CALIBRATION
): CrownClassification {
  const broad = f.gndvi - f.ndvi;
  const iso = f.isolationVs60m;
  const ctx = f.cellNdvi60m;
  const ar = f.aspectRatio;
  const tex = f.ndviStd;

  let cedarScore = 0;
  let oakScore = 0;
  let mixedScore = 0;

  if (ctx < cal.scatteredCedarCtxLt && f.ndvi > cal.scatteredCedarNdviGt && iso > cal.scatteredCedarIsoGt) {
    cedarScore += 2.5;
  }
  if (ctx < cal.scatteredCedarCtxLt2 && iso > cal.scatteredCedarIsoGt2) {
    cedarScore += 1.5;
  }

  if (ctx > cal.woodlandOakCtxGt && broad > cal.woodlandOakBroadGt) oakScore += 2.2;
  if (ctx > cal.highOakCtxGt && f.ndvi > cal.highOakNdviGt) oakScore += 1.2;

  if (ar > cal.elongateOakAspectGt && ctx > cal.elongateOakCtxGt) oakScore += 1.0;

  if (ar < cal.roundCedarAspectLt && broad < cal.roundCedarBroadLt) cedarScore += 1.8;

  if (tex > cal.mixedTexGt && f.ndvi > cal.mixedNdviGt) mixedScore += 1.5;

  if (cedarScore >= cal.conflictCedarMin && oakScore >= cal.conflictOakMin) {
    mixedScore += cal.conflictMixedAdd;
    cedarScore *= cal.conflictScale;
    oakScore *= cal.conflictScale;
  }

  const maxS = Math.max(cedarScore, oakScore, mixedScore, cal.floorScore);

  let classification: CedarVegClass = 'cedar';
  if (oakScore >= cedarScore && oakScore >= mixedScore) classification = 'oak';
  else if (mixedScore >= cedarScore && mixedScore >= oakScore) classification = 'mixed_brush';
  else if (cedarScore >= oakScore) classification = 'cedar';

  if (cedarScore === oakScore && mixedScore < cedarScore) classification = 'cedar';

  const confidence = Math.round(clamp01(maxS / cal.confidenceDivisor) * 100);
  const bandVotes = Math.max(1, Math.min(5, Math.round(1 + maxS)));

  return { classification, confidence, bandVotes };
}
