import type {
  ClearingMethodConfig,
  DensityClass,
  DisposalMethod,
  Pasture,
  RateCard,
  SoilData,
  TerrainClass,
  VegetationType,
} from '@/types';

// ──── Default Rate Card ────

export const DEFAULT_RATE_CARD: RateCard = {
  baseRates: {
    cedar: 850,
    oak: 650,
    mixed: 750,
    mesquite: 700,
    brush: 500,
  },
  densityMultipliers: {
    light: 0.75,
    moderate: 1.0,
    heavy: 1.35,
    extreme: 1.65,
  },
  terrainMultipliers: {
    flat: 1.0,
    rolling: 1.15,
    steep: 1.35,
    rugged: 1.6,
  },
  methodConfigs: [
    { id: 'fine_mulch', label: 'Fine Mulch (Premium)', rateMultiplier: 1.4, timeMultiplier: 1.6, equipment: 'Forestry mulcher, multi-pass', result: 'Park-like finish, stumps flush' },
    { id: 'rough_mulch', label: 'Rough Mulch (Standard)', rateMultiplier: 1.0, timeMultiplier: 1.0, equipment: 'Forestry mulcher, single pass', result: 'Functional, some stumps' },
    { id: 'chainsaw_pile', label: 'Chainsaw + Grapple Pile', rateMultiplier: 0.75, timeMultiplier: 1.3, equipment: 'Chainsaws, skid steer grapple', result: 'Cut and stacked, stumps remain' },
    { id: 'chainsaw_haul', label: 'Chainsaw + Haul Off', rateMultiplier: 1.15, timeMultiplier: 1.5, equipment: 'Chainsaws, grapple, dump trailer', result: 'Debris removed, stumps remain' },
    { id: 'dozer_push', label: 'Dozer Push and Pile', rateMultiplier: 0.6, timeMultiplier: 0.5, equipment: 'D6+ dozer', result: 'Fastest, disturbs soil' },
    { id: 'selective_thin', label: 'Selective Thin', rateMultiplier: 1.3, timeMultiplier: 1.8, equipment: 'Mulcher + chainsaws', result: 'Precision, keep desirable trees' },
    { id: 'cedar_only', label: 'Cedar Only, Protect Oaks', rateMultiplier: 1.15, timeMultiplier: 1.3, equipment: 'Mulcher + chainsaws', result: 'Most common Hill Country request' },
    { id: 'row_fence_line', label: 'Right of Way / Fence Line', rateMultiplier: 1.1, timeMultiplier: 1.0, equipment: 'Mulcher', result: 'Linear corridor' },
  ],
  disposalAdders: {
    mulch_in_place: 0,
    pile_and_burn: 25,
    haul_off: 175,
    chip_and_spread: 50,
    stack_for_customer: 15,
  },
  minimumBid: 2500,
  mobilizationFee: 500,
};

// ──── Soil Difficulty Multiplier ────

export function calculateSoilDifficulty(soil: SoilData): number {
  let m = 1.0;

  if (soil.slope_r > 20) m *= 1.5;
  else if (soil.slope_r > 12) m *= 1.25;
  else if (soil.slope_r > 5) m *= 1.1;

  if (soil.fragvol_r > 50) m *= 1.4;
  else if (soil.fragvol_r > 25) m *= 1.2;

  if (soil.drainagecl === 'Poorly drained') m *= 1.3;
  if (soil.resdept_r !== null && soil.resdept_r < 25) m *= 1.3;

  return Math.round(m * 100) / 100;
}

// ──── Pasture Cost Calculation ────

export function calculatePastureCost(
  pasture: Pick<Pasture, 'acreage' | 'vegetationType' | 'density' | 'terrain' | 'clearingMethod' | 'disposalMethod' | 'soilMultiplier' | 'soilMultiplierOverride'>,
  rateCard: RateCard
): { subtotal: number; methodMultiplier: number; estimatedHrsPerAcre: number } {
  const baseRate = rateCard.baseRates[pasture.vegetationType];
  const densityMult = rateCard.densityMultipliers[pasture.density];
  const terrainMult = rateCard.terrainMultipliers[pasture.terrain];
  const soilMult = pasture.soilMultiplierOverride ?? pasture.soilMultiplier;

  const methodConfig = rateCard.methodConfigs.find(m => m.id === pasture.clearingMethod);
  const methodRateMult = methodConfig?.rateMultiplier ?? 1.0;
  const methodTimeMult = methodConfig?.timeMultiplier ?? 1.0;

  const disposalAdder = rateCard.disposalAdders[pasture.disposalMethod] ?? 0;

  // Use the higher of terrain or soil multiplier (they measure similar friction)
  const difficultyMult = Math.max(terrainMult, soilMult);

  const perAcre = baseRate * densityMult * difficultyMult * methodRateMult + disposalAdder;
  const subtotal = Math.round(pasture.acreage * perAcre * 100) / 100;

  // Base hours estimate: 1 hr/acre for rough mulch moderate cedar
  const baseHrs = 1.0;
  const estimatedHrsPerAcre = Math.round(
    baseHrs * densityMult * difficultyMult * methodTimeMult * 100
  ) / 100;

  return { subtotal, methodMultiplier: methodRateMult, estimatedHrsPerAcre };
}

// ──── Total Bid Calculation ────

export function calculateBidTotal(
  pastures: Pasture[],
  mobilizationFee: number,
  burnPermitFee: number,
  customLineItems: { amount: number }[],
  contingencyPct: number,
  discountPct: number,
  minimumBid: number
): {
  pastureSubtotal: number;
  totalBeforeAdjustments: number;
  contingencyAmount: number;
  discountAmount: number;
  totalAmount: number;
} {
  const pastureSubtotal = pastures.reduce((sum, p) => sum + p.subtotal, 0);
  const customTotal = customLineItems.reduce((sum, li) => sum + li.amount, 0);
  const totalBeforeAdjustments = pastureSubtotal + mobilizationFee + burnPermitFee + customTotal;

  const contingencyAmount = Math.round(totalBeforeAdjustments * (contingencyPct / 100) * 100) / 100;
  const discountAmount = Math.round(totalBeforeAdjustments * (discountPct / 100) * 100) / 100;
  const rawTotal = totalBeforeAdjustments + contingencyAmount - discountAmount;
  const totalAmount = Math.max(rawTotal, minimumBid);

  return {
    pastureSubtotal: Math.round(pastureSubtotal * 100) / 100,
    totalBeforeAdjustments: Math.round(totalBeforeAdjustments * 100) / 100,
    contingencyAmount,
    discountAmount,
    totalAmount: Math.round(totalAmount * 100) / 100,
  };
}

// ──── Estimated Duration ────

export function estimateDuration(
  pastures: Pasture[],
  hoursPerDay: number = 8
): { low: number; high: number } {
  const totalHours = pastures.reduce(
    (sum, p) => sum + p.acreage * p.estimatedHrsPerAcre,
    0
  );
  const baseDays = totalHours / hoursPerDay;
  return {
    low: Math.ceil(baseDays * 0.85),
    high: Math.ceil(baseDays * 1.25),
  };
}

// ──── Label Helpers ────

export const VEGETATION_LABELS: Record<VegetationType, string> = {
  cedar: 'Cedar',
  oak: 'Oak',
  mixed: 'Mixed Cedar/Oak',
  mesquite: 'Mesquite',
  brush: 'Brush',
};

export const DENSITY_LABELS: Record<DensityClass, string> = {
  light: 'Light',
  moderate: 'Moderate',
  heavy: 'Heavy',
  extreme: 'Extreme',
};

export const TERRAIN_LABELS: Record<TerrainClass, string> = {
  flat: 'Flat (0-5%)',
  rolling: 'Rolling (5-12%)',
  steep: 'Steep (12-20%)',
  rugged: 'Rugged (20%+)',
};

export const DISPOSAL_LABELS: Record<DisposalMethod, string> = {
  mulch_in_place: 'Mulch in Place',
  pile_and_burn: 'Pile and Burn',
  haul_off: 'Haul Off',
  chip_and_spread: 'Chip and Spread',
  stack_for_customer: 'Stack for Customer',
};

export function getMethodConfig(method: string, rateCard: RateCard): ClearingMethodConfig | undefined {
  return rateCard.methodConfigs.find(m => m.id === method);
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatCurrencyPrecise(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
