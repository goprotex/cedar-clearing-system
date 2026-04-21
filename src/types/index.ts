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
  methodAdders: MethodAdder[];
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
  // Method-specific adders
  adders: PastureAdder[];
  // Marked trees (save/remove)
  savedTrees: MarkedTree[];
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

export interface TileConsensusStats {
  tileCount: number;
  tileOverlapPct: number;
  tileSizePixels: number;
  tileSizeM: number;
  stridePixels: number;
  strideM: number;
  consensusImprovedCells: number;
  consensusImprovedPct: number;
}

export interface CedarChunkRunStats {
  chunkCount: number;
  maxSamplesPerChunk: number;
}

export interface CrownSegmentationStats {
  used: boolean;
  source: string;
  totalCrowns: number;
  cedarCrowns: number;
  oakCrowns: number;
  averageCanopyDiameter: number;
}

export interface CedarCalibrationStats {
  exampleCount: number;
  cedarExamples: number;
  oakExamples: number;
  source: string;
}

export interface CedarNaipDiagnostics {
  requestedSamples: number;
  successfulSamples: number;
  noDataSamples: number;
  invalidPixelSamples: number;
  rateLimitedSamples: number;
  timeoutSamples: number;
  httpErrorSamples: number;
  parseErrorSamples: number;
  networkErrorSamples: number;
  degradedFallbackUsed: boolean;
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
  averageGNDVI: number;
  averageSAVI: number;
  confidence: number;
  avgBandVotes: number;
  highConfidenceCedarCells: number;
  gridSpacingM: number;
  /** Half cell width in degrees (from spectral API) — used to rebuild grid from compact `samples`. */
  cellHalfLngDeg?: number;
  cellHalfLatDeg?: number;
  tileConsensus?: TileConsensusStats;
  /** Cells where NAIP + texture + Sentinel fusion scored trust below threshold */
  lowTrustCells?: number;
  lowTrustPct?: number;
  hiResImagery?: {
    used: boolean;
    source?: string;
  };
  naipDiagnostics?: CedarNaipDiagnostics;
  sentinelFusion?: {
    used: boolean;
    pairedSamples: number;
    winterDate?: string;
    summerDate?: string;
    winterSceneId?: string;
    summerSceneId?: string;
  };
  crownSegmentation?: CrownSegmentationStats;
  calibration?: CedarCalibrationStats;
  /** Present when analysis was split into multiple API requests and merged client-side. */
  chunkedRun?: CedarChunkRunStats;
}

export interface CrownDetection {
  id: string;
  lng: number;
  lat: number;
  species: 'cedar' | 'oak' | 'mixed';
  confidence: number;
  canopyDiameter: number;
  height: number;
  source: 'hi_res_segmentation' | 'hi_res_connected_components';
}

export interface CrownMaskFeatureProperties {
  id: string;
  species: 'cedar' | 'oak';
  confidence: number;
  supportCount: number;
  source: 'hi_res_connected_components';
}

export interface CedarAnalysis {
  gridCells: GeoJSON.FeatureCollection;
  summary: CedarAnalysisSummary;
  crowns?: CrownDetection[];
  crownMasks?: GeoJSON.FeatureCollection<GeoJSON.Polygon, CrownMaskFeatureProperties>;
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
  cedarPct: number;
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

export interface PastureAdder {
  adderId: string;
  quantity: number;
  costPerUnit: number;
}

// ──── Marked Trees (save/skip) ────

export type MarkedTreeAction = 'save' | 'remove' | 'calibrate_cedar' | 'calibrate_oak';

export interface MarkedTree {
  id: string;
  lng: number;
  lat: number;
  species: 'cedar' | 'oak' | 'mixed';
  action: MarkedTreeAction;
  label: string; // e.g. "Heritage Oak #1", "Customer requested"
  height: number;
  canopyDiameter: number;
  crownPolygon?: GeoJSON.Polygon;
  source?: 'auto' | 'manual';
}

// ──── AI Recommendation ────

export interface AIRecommendation {
  vegetationType: VegetationType;
  density: DensityClass;
  terrain: TerrainClass;
  clearingMethod: ClearingMethod;
  disposalMethod: DisposalMethod;
  notes: string;
  reasoning: string;
  estimatedDifficulty: number; // 1-10
  suggestedAdders: string[]; // adder IDs
}

// ──── Bid ────

export interface Bid {
  id: string;
  bidNumber: string;
  status: BidStatus;
  /**
   * Optional Supabase-backed job created from this bid.
   * Stored client-side in Phase 1; server is source of truth once jobs are enabled.
   */
  jobId?: string;
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

// ──── Jobs (multi-user, multi-day progress) ────

export type JobStatus = 'active' | 'paused' | 'completed' | 'cancelled';

export interface Job {
  id: string;
  bid_id: string;
  title: string;
  status: JobStatus;
  created_at: string;
  bid_snapshot: Bid;
  cedar_total_cells: number;
  cedar_cleared_cells: number;
  work_started_at?: string | null;
  work_completed_at?: string | null;
  manual_machine_hours?: number | null;
  manual_fuel_gallons?: number | null;
}

export interface JobEvent {
  id: string;
  job_id: string;
  created_at: string;
  created_by: string;
  type: string;
  data: unknown;
}
