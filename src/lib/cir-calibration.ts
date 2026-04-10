/**
 * Browser-persisted weights/thresholds for cedar vs oak heuristic (CIR object path).
 * Re-run pasture analysis after changing values.
 */

export const CIR_CALIBRATION_STORAGE_KEY = 'ccc-cir-calibration-v1';

/** All tunable parameters used by classifyCrownFromCirFeatures. */
export interface CirClassifierCalibration {
  scatteredCedarCtxLt: number;
  scatteredCedarNdviGt: number;
  scatteredCedarIsoGt: number;
  scatteredCedarCtxLt2: number;
  scatteredCedarIsoGt2: number;
  woodlandOakCtxGt: number;
  woodlandOakBroadGt: number;
  highOakCtxGt: number;
  highOakNdviGt: number;
  elongateOakAspectGt: number;
  elongateOakCtxGt: number;
  roundCedarAspectLt: number;
  roundCedarBroadLt: number;
  mixedTexGt: number;
  mixedNdviGt: number;
  conflictCedarMin: number;
  conflictOakMin: number;
  conflictMixedAdd: number;
  conflictScale: number;
  confidenceDivisor: number;
  floorScore: number;
}

export const DEFAULT_CIR_CALIBRATION: CirClassifierCalibration = {
  scatteredCedarCtxLt: 0.34,
  scatteredCedarNdviGt: 0.26,
  scatteredCedarIsoGt: 0.052,
  scatteredCedarCtxLt2: 0.28,
  scatteredCedarIsoGt2: 0.088,
  woodlandOakCtxGt: 0.38,
  woodlandOakBroadGt: 0.025,
  highOakCtxGt: 0.44,
  highOakNdviGt: 0.33,
  elongateOakAspectGt: 1.55,
  elongateOakCtxGt: 0.36,
  roundCedarAspectLt: 1.42,
  roundCedarBroadLt: 0.055,
  mixedTexGt: 0.12,
  mixedNdviGt: 0.3,
  conflictCedarMin: 2,
  conflictOakMin: 2,
  conflictMixedAdd: 2,
  conflictScale: 0.6,
  confidenceDivisor: 4,
  floorScore: 0.4,
};

export function loadCirCalibration(): CirClassifierCalibration {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_CIR_CALIBRATION };
  }
  try {
    const raw = localStorage.getItem(CIR_CALIBRATION_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CIR_CALIBRATION };
    const parsed = JSON.parse(raw) as Partial<CirClassifierCalibration>;
    return { ...DEFAULT_CIR_CALIBRATION, ...parsed };
  } catch {
    return { ...DEFAULT_CIR_CALIBRATION };
  }
}

export function saveCirCalibration(c: CirClassifierCalibration): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(CIR_CALIBRATION_STORAGE_KEY, JSON.stringify(c));
}

export function resetCirCalibration(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(CIR_CALIBRATION_STORAGE_KEY);
}
