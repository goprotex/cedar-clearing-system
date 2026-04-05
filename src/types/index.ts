// Core domain types for Cactus Creek Clearing System

// ──── Vegetation & Density ────

export type VegetationType = 'cedar' | 'oak' | 'mixed' | 'mesquite' | 'brush';
export type DensityClass = 'light' | 'moderate' | 'heavy' | 'extreme';
export type TerrainClass = 'flat' | 'rolling' | 'steep' | 'rugged';

export type ClearingMethod =
  | 'fine_mulch'
  | 'rough_mulch'
  | 'chainsaw_pile'
  | 'chainsaw_haul'
  | 'dozer_push'
  | 'selective_thin'
  | 'cedar_only'
  | 'row_fence_line';

export type DisposalMethod =
  | 'mulch_in_place'
  | 'pile_and_burn'
  | 'haul_off'
  | 'chip_and_spread'
  | 'stack_for_customer';

export type BidStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'expired';

// ──── Clearing Method Config ────

export interface ClearingMethodConfig {
  id: ClearingMethod;
  label: string;
  rateMultiplier: number;
  timeMultiplier: number;
  equipment: string;
  result: string;
}

// ──── Rate Card ────

export interface RateCard {
  baseRates: Record<VegetationType, number>; // $/acre
  densityMultipliers: Record<DensityClass, number>;
  terrainMultipliers: Record<TerrainClass, number>;
  methodConfigs: ClearingMethodConfig[];
  disposalAdders: Record<DisposalMethod, number>; // $/acre
  minimumBid: number;
  mobilizationFee: number;
}

// ──── Soil Data ────

export interface SoilData {
  series: string;
  mapUnit: string;
  slope_r: number;
  fragvol_r: number;
  drainagecl: string;
  resdept_r: number | null;
  flodfreqcl: string;
  component_pct: number;
}

// ──── Pasture ────

export interface Pasture {
  id: string;
  name: string;
  sortOrder: number;
  polygon: GeoJSON.Feature<GeoJSON.Polygon>;
  acreage: number;
  centroid: [number, number]; // [lng, lat]
  vegetationType: VegetationType;
  density: DensityClass;
  terrain: TerrainClass;
  clearingMethod: ClearingMethod;
  disposalMethod: DisposalMethod;
  // Soil
  soilData: SoilData | null;
  soilMultiplier: number;
  soilMultiplierOverride: number | null;
  // Elevation
  elevationFt: number | null;
  // Cedar analysis
  cedarAnalysis: CedarAnalysis | null;
  seasonalAnalysis: SeasonalAnalysis | null;
  // Calculated
  subtotal: number;
  methodMultiplier: number;
  estimatedHrsPerAcre: number;
  notes: string;
}

// ──── Cedar Analysis ────

export type CedarVegClass = 'cedar' | 'oak' | 'mixed_brush' | 'grass' | 'bare';

export interface CedarClassCount {
  count: number;
  pct: number;
}

export interface CedarAnalysisSummary {
  totalSamples: number;
  cedar: CedarClassCount;
  oak: CedarClassCount;
  mixedBrush: CedarClassCount;
  grass: CedarClassCount;
  bare: CedarClassCount;
  estimatedCedarAcres: number;
  averageNDVI: number;
  confidence: number;
  gridSpacingM: number;
}

export interface CedarAnalysis {
  gridCells: GeoJSON.FeatureCollection;
  summary: CedarAnalysisSummary;
  claudeVision: ClaudeVisionAnalysis | null;
}

export interface ClaudeVisionAnalysis {
  cedarPct: number;
  oakPct: number;
  brushPct: number;
  grassPct: number;
  barePct: number;
  cedarDensity: string;
  confidence: number;
  notes: string;
}

// ──── Seasonal Analysis ────

export interface SeasonalScene {
  id: string;
  date: string;
  cloudCover: number;
}

export interface SeasonalAnalysis {
  winterScene: SeasonalScene | null;
  summerScene: SeasonalScene | null;
  winterNDVI: number | null;
  summerNDVI: number | null;
  ndviChange: number | null;
  evergreenPct: number;
  deciduousPct: number;
  dormantPct: number;
  confidence: number;
}

// ──── Method-Specific Adders ────

export interface MethodAdder {
  id: string;
  label: string;
  unit: 'acre' | 'tree' | 'pile' | 'linear_foot';
  minCost: number;
  maxCost: number;
  defaultCost: number;
}

// ──── Bid ────

export interface Bid {
  id: string;
  bidNumber: string;
  status: BidStatus;
  // Client
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  clientAddress: string;
  // Property
  propertyName: string;
  propertyAddress: string;
  propertyCenter: [number, number]; // [lng, lat]
  mapZoom: number;
  // Pastures
  pastures: Pasture[];
  // Financials
  totalAcreage: number;
  totalAmount: number;
  estimatedDaysLow: number;
  estimatedDaysHigh: number;
  mobilizationFee: number;
  burnPermitFee: number;
  customLineItems: CustomLineItem[];
  contingencyPct: number;
  discountPct: number;
  // Meta
  notes: string;
  validUntil: string; // ISO date
  rateCardSnapshot: RateCard;
  createdAt: string;
  updatedAt: string;
}

export interface CustomLineItem {
  id: string;
  description: string;
  amount: number;
}

// ──── Bid Summary (for list view) ────

export interface BidSummary {
  id: string;
  bidNumber: string;
  status: BidStatus;
  clientName: string;
  propertyName: string;
  totalAcreage: number;
  totalAmount: number;
  createdAt: string;
  updatedAt: string;
}

// ──── Bid Options (multi-option pricing) ────

export interface BidOption {
  id: string;
  label: string; // e.g. "Option A: Premium", "Option B: Standard"
  clearingMethod: ClearingMethod;
  disposalMethod: DisposalMethod;
  totalAmount: number;
  perAcreCost: number;
  estimatedDaysLow: number;
  estimatedDaysHigh: number;
  pastureBreakdown: {
    pastureId: string;
    pastureName: string;
    acreage: number;
    subtotal: number;
  }[];
  recommended: boolean;
}
