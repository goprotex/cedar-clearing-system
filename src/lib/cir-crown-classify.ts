/**
 * Fuse fine-scale crown metrics + ~20 m NDVI neighborhood context into cedar / oak / mixed labels.
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
 * Isolation: crown NDVI much higher than ~20 m neighborhood mean → scattered juniper in open pasture.
 * Cast-shadow asymmetry (shadowSideContrast): dark band on one side of the crown → woody tree vs symmetric turf.
 */
export function classifyCrownFromCirFeatures(
  f: CirBlobFeatures,
  cal: CirClassifierCalibration = DEFAULT_CIR_CALIBRATION
): CrownClassification {
  const broad = f.gndvi - f.ndvi;
  const iso = f.isolationVs20m;
  const ctx = f.cellNdvi20m;
  const ar = f.aspectRatio;
  const tex = f.ndviStd;
  const sh = f.shadowSideContrast;

  /** Uniform turf: symmetric brightness (no strong cast shadow). */
  const turfLike =
    sh < 0.125 &&
    f.ndvi < 0.38 &&
    tex < 0.095 &&
    broad < 0.024 &&
    f.ndvi + broad * 4 < 0.42;

  let cedarScore = 0;
  let oakScore = 0;
  let mixedScore = 0;

  if (ctx < cal.scatteredCedarCtxLt && f.ndvi > cal.scatteredCedarNdviGt && iso > cal.scatteredCedarIsoGt) {
    if (!turfLike) cedarScore += 2.5;
  }
  if (
    ctx < cal.scatteredCedarCtxLt2 &&
    iso > cal.scatteredCedarIsoGt2 &&
    f.ndvi > 0.29
  ) {
    if (!turfLike) cedarScore += 1.5;
  }

  if (ctx > cal.woodlandOakCtxGt && broad > cal.woodlandOakBroadGt) oakScore += 2.2;
  if (ctx > cal.highOakCtxGt && f.ndvi > cal.highOakNdviGt) oakScore += 1.2;

  if (ar > cal.elongateOakAspectGt && ctx > cal.elongateOakCtxGt) oakScore += 1.0;

  // Round, needle-like crowns — skip flat grass mats (low texture + very low broadleaf separation).
  if (ar < cal.roundCedarAspectLt && broad < cal.roundCedarBroadLt && !turfLike && (tex >= 0.055 || f.ndvi >= 0.38)) {
    cedarScore += 1.8;
  }

  if (tex > cal.mixedTexGt && f.ndvi > cal.mixedNdviGt) mixedScore += 1.5;

  // Cast shadow on one side (NAIP sun angle): broad spreading crowns → oak-lean; compact → cedar-lean.
  if (sh > 0.11) {
    const ramp = Math.min(1, (sh - 0.11) / 0.22);
    if (broad > 0.02 && ar >= 1.38) {
      oakScore += 0.55 + ramp * 1.05;
    } else if (ar < 1.48 && broad < 0.048) {
      cedarScore += 0.5 + ramp * 0.95;
    } else {
      oakScore += 0.35 * ramp;
      cedarScore += 0.4 * ramp;
    }
  }

  if (turfLike) {
    mixedScore += 1.6;
    cedarScore *= 0.35;
    oakScore *= 0.85;
  }

  if (cedarScore >= cal.conflictCedarMin && oakScore >= cal.conflictOakMin) {
    mixedScore += cal.conflictMixedAdd;
    cedarScore *= cal.conflictScale;
    oakScore *= cal.conflictScale;
  }

  const rawMax = Math.max(cedarScore, oakScore, mixedScore);
  const maxS = Math.max(rawMax, cal.floorScore);

  let classification: CedarVegClass = 'cedar';
  if (rawMax < 0.45) {
    classification = 'mixed_brush';
  } else if (oakScore >= cedarScore && oakScore >= mixedScore) classification = 'oak';
  else if (mixedScore >= cedarScore && mixedScore >= oakScore) classification = 'mixed_brush';
  else if (cedarScore >= oakScore) classification = 'cedar';

  if (classification !== 'mixed_brush' && cedarScore === oakScore && mixedScore < cedarScore) classification = 'cedar';

  const confidence = Math.round(clamp01(maxS / cal.confidenceDivisor) * 100);
  const bandVotes = Math.max(1, Math.min(5, Math.round(1 + maxS)));

  return { classification, confidence, bandVotes };
}
