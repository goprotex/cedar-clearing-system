import { create } from 'zustand';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import type { Bid, BidSummary, CedarAnalysis, CustomLineItem, Pasture, RateCard, SeasonalAnalysis, MarkedTree, AIRecommendation } from '@/types';
import {
  calculatePastureCost,
  calculateBidTotal,
  estimateDuration,
  calculateSoilDifficulty,
  DEFAULT_RATE_CARD,
} from '@/lib/rates';
import { extractTreesFromAnalysis } from '@/lib/cedar-tree-data';
import {
  estimateCedarSampleCount,
  getCedarAnalysisChunkPolygons,
  polygonAcreage,
  CEDAR_GRID_SPACING_M,
  WHOLE_PASTURE_STAGE_SAMPLE_LIMIT,
} from '@/lib/cedar-analysis-chunks';
import { mergeCedarAnalyses } from '@/lib/merge-cedar-analysis';
import { fetchCedarDetectChunkWithRetry, scaledChunkProgress } from '@/lib/cedar-detect-stream-client';
import { createClient as createSupabaseBrowser, isSupabaseConfigured } from '@/utils/supabase/client';
import { saveBidToSupabase, loadBidFromSupabase, loadBidListFromSupabase, deleteBidFromSupabase, getAuthUserId, migrateBidsToSupabase, BIDS_MIGRATION_FLAG } from '@/lib/db';
import {
  clearCedarChunkResumeHybrid,
  hashPasturePolygon,
  hashChunkPolygonCoords,
  loadCedarChunkResumeHybrid,
  saveCedarChunkResumeHybrid,
  chunkKeysEqual,
  CEDAR_RESUME_VERSION,
} from '@/lib/cedar-analysis-resume';

function generateBidNumber(): string {
  const now = new Date();
  const y = String(now.getFullYear()).slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const seq = String(Math.floor(Math.random() * 900) + 100);
  return `CCC-${y}${m}-${seq}`;
}

function bboxFromCoords(coords: number[][][]): [number, number, number, number] {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  for (const ring of coords) {
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
    }
  }

  return [minLng, minLat, maxLng, maxLat];
}

function activeProcessIndexForPhase(phase: string): number {
  switch (phase) {
    case 'init':
      return 0;
    case 'grid':
    case 'sampling':
      return 1;
    case 'indices':
      return 2;
    case 'hires':
      return 3;
    case 'classify':
      return 4;
    case 'sentinel':
    case 'refining':
    case 'consensus':
      return 5;
    case 'building':
    case 'applying':
    case 'trees':
      return 6;
    case 'done':
      return 6;
    default:
      return 0;
  }
}

function createDefaultPasture(sortOrder: number): Pasture {
  return {
    id: uuidv4(),
    name: `Pasture ${sortOrder + 1}`,
    sortOrder,
    polygon: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: {} },
    acreage: 0,
    centroid: [-99.1403, 30.0469],
    vegetationType: 'cedar',
    density: 'moderate',
    terrain: 'rolling',
    clearingMethod: 'rough_mulch',
    disposalMethod: 'mulch_in_place',
    soilData: null,
    soilMultiplier: 1.0,
    soilMultiplierOverride: null,
    elevationFt: null,
    cedarAnalysis: null,
    seasonalAnalysis: null,
    adders: [],
    savedTrees: [],
    subtotal: 0,
    methodMultiplier: 1.0,
    estimatedHrsPerAcre: 1.0,
    notes: '',
  };
}

function createDefaultBid(): Bid {
  return {
    id: uuidv4(),
    bidNumber: generateBidNumber(),
    status: 'draft',
    clientName: '',
    clientEmail: '',
    clientPhone: '',
    clientAddress: '',
    propertyName: '',
    propertyAddress: '',
    propertyCenter: [-99.1403, 30.0469],
    mapZoom: 14,
    pastures: [],
    totalAcreage: 0,
    totalAmount: 0,
    estimatedDaysLow: 0,
    estimatedDaysHigh: 0,
    mobilizationFee: DEFAULT_RATE_CARD.mobilizationFee,
    burnPermitFee: 0,
    customLineItems: [],
    contingencyPct: 0,
    discountPct: 0,
    notes: '',
    validUntil: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
    rateCardSnapshot: DEFAULT_RATE_CARD,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

interface BidStore {
  // Current bid being edited
  currentBid: Bid;
  rateCard: RateCard;
  selectedPastureId: string | null;
  drawingMode: boolean;

  // Analysis progress (`pct` is canonical; `percent` optional alias for UI that reads `percent`)
  analysisProgress: {
    active: boolean;
    pastureId?: string;
    step: string;
    detail: string;
    pct: number;
    percent?: number;
    phase: string;
    phaseLabel?: string;
    startedAt?: number;
    focusBbox?: [number, number, number, number];
    focusKey?: string;
    cedarCount?: number;
    oakCount?: number;
    estimatedCedarAcres?: number;
    totalPoints?: number;
    completed?: number;
    /** Extra pipeline description (large pastures / multi-region runs) */
    processLines?: string[];
    activeProcessIndex?: number;
    debugLines?: string[];
  } | null;

  // All saved bids (Supabase primary, localStorage fallback)
  savedBids: BidSummary[];

  // Actions
  setCurrentBid: (bid: Bid) => void;
  updateBidField: <K extends keyof Bid>(field: K, value: Bid[K]) => void;
  newBid: () => void;
  /** Fresh bid but keep this id (for routes like `/operate` or deep-linked UUIDs). */
  newBidWithId: (id: string) => void;

  // Pasture
  addPasture: () => void;
  updatePasture: (id: string, updates: Partial<Pasture>) => void;
  removePasture: (id: string) => void;
  selectPasture: (id: string | null) => void;
  setPasturePolygon: (id: string, polygon: GeoJSON.Feature<GeoJSON.Polygon>, acreage: number, centroid: [number, number]) => void;

  // Drawing
  setDrawingMode: (active: boolean) => void;

  // Custom line items
  addCustomLineItem: () => void;
  updateCustomLineItem: (id: string, updates: Partial<CustomLineItem>) => void;
  removeCustomLineItem: (id: string) => void;

  // Recalculate
  recalculate: () => void;

  // Soil
  fetchSoilData: (pastureId: string, lon: number, lat: number) => Promise<void>;

  // Elevation
  fetchElevation: (pastureId: string, lon: number, lat: number) => Promise<void>;

  // Cedar detection
  analyzeCedar: (pastureId: string) => Promise<void>;

  // Seasonal analysis
  analyzeSeasonal: (pastureId: string) => Promise<void>;

  // Tree marking
  markTree: (pastureId: string, tree: MarkedTree) => void;
  unmarkTree: (pastureId: string, treeId: string) => void;
  updateMarkedTree: (pastureId: string, treeId: string, updates: Partial<MarkedTree>) => void;

  // AI auto-populate
  aiPopulate: (pastureId: string) => Promise<AIRecommendation | null>;

  // Rate card
  updateRateCard: (updates: Partial<RateCard>) => void;

  // Persistence (Supabase primary, localStorage offline fallback)
  saveBid: () => void;
  loadBid: (id: string) => Promise<void>;
  deleteBid: (id: string) => Promise<void>;
  loadBidList: () => Promise<void>;

  // Auth state
  isAuthenticated: boolean;
  setAuthenticated: (val: boolean) => void;
}

export const useBidStore = create<BidStore>((set, get) => ({
  currentBid: createDefaultBid(),
  rateCard: DEFAULT_RATE_CARD,
  selectedPastureId: null,
  drawingMode: false,
  analysisProgress: null,
  savedBids: [],
  isAuthenticated: false,

  setAuthenticated: (val) => set({ isAuthenticated: val }),

  setCurrentBid: (bid) => set({ currentBid: bid }),

  updateBidField: (field, value) => {
    set((state) => ({
      currentBid: { ...state.currentBid, [field]: value, updatedAt: new Date().toISOString() },
    }));
    get().recalculate();
  },

  newBid: () => set({
    currentBid: createDefaultBid(),
    selectedPastureId: null,
    drawingMode: false,
  }),

  newBidWithId: (id) => {
    const fresh = createDefaultBid();
    set({
      currentBid: { ...fresh, id },
      selectedPastureId: null,
      drawingMode: false,
    });
  },

  addPasture: () => {
    set((state) => {
      const newPasture = createDefaultPasture(state.currentBid.pastures.length);
      return {
        currentBid: {
          ...state.currentBid,
          pastures: [...state.currentBid.pastures, newPasture],
          updatedAt: new Date().toISOString(),
        },
        selectedPastureId: newPasture.id,
        drawingMode: true,
      };
    });
  },

  updatePasture: (id, updates) => {
    set((state) => ({
      currentBid: {
        ...state.currentBid,
        pastures: state.currentBid.pastures.map((p) =>
          p.id === id ? { ...p, ...updates } : p
        ),
        updatedAt: new Date().toISOString(),
      },
    }));
    get().recalculate();
  },

  removePasture: (id) => {
    void clearCedarChunkResumeHybrid(get().currentBid.id, id);
    set((state) => ({
      currentBid: {
        ...state.currentBid,
        pastures: state.currentBid.pastures.filter((p) => p.id !== id),
        updatedAt: new Date().toISOString(),
      },
      selectedPastureId: state.selectedPastureId === id ? null : state.selectedPastureId,
    }));
    get().recalculate();
  },

  selectPasture: (id) => set({ selectedPastureId: id }),

  setPasturePolygon: (id, polygon, acreage, centroid) => {
    void clearCedarChunkResumeHybrid(get().currentBid.id, id);
    set((state) => ({
      currentBid: {
        ...state.currentBid,
        pastures: state.currentBid.pastures.map((p) =>
          p.id === id ? { ...p, polygon, acreage, centroid } : p
        ),
        updatedAt: new Date().toISOString(),
      },
      drawingMode: false,
    }));
    get().recalculate();
    // Auto-fetch soil data for the new polygon's centroid
    set({ analysisProgress: { active: true, phase: 'soil', step: 'Fetching soil data...', detail: 'Querying USDA SSURGO database', pct: 0, percent: 0 } });
    get().fetchSoilData(id, centroid[0], centroid[1]);
    set({ analysisProgress: { active: true, phase: 'elevation', step: 'Fetching elevation...', detail: 'Querying USGS elevation data', pct: 0, percent: 0 } });
    get().fetchElevation(id, centroid[0], centroid[1]);
    // Auto-run cedar spectral analysis
    get().analyzeCedar(id);
  },

  setDrawingMode: (active) => set({ drawingMode: active }),

  addCustomLineItem: () => {
    set((state) => ({
      currentBid: {
        ...state.currentBid,
        customLineItems: [
          ...state.currentBid.customLineItems,
          { id: uuidv4(), description: '', amount: 0 },
        ],
        updatedAt: new Date().toISOString(),
      },
    }));
  },

  updateCustomLineItem: (id, updates) => {
    set((state) => ({
      currentBid: {
        ...state.currentBid,
        customLineItems: state.currentBid.customLineItems.map((li) =>
          li.id === id ? { ...li, ...updates } : li
        ),
        updatedAt: new Date().toISOString(),
      },
    }));
    get().recalculate();
  },

  removeCustomLineItem: (id) => {
    set((state) => ({
      currentBid: {
        ...state.currentBid,
        customLineItems: state.currentBid.customLineItems.filter((li) => li.id !== id),
        updatedAt: new Date().toISOString(),
      },
    }));
    get().recalculate();
  },

  recalculate: () => {
    set((state) => {
      const { rateCard, currentBid } = state;
      const livePricingPastureId = state.analysisProgress?.active ? state.analysisProgress.pastureId : undefined;
      const livePricingCedarAcres = state.analysisProgress?.active ? state.analysisProgress.estimatedCedarAcres : undefined;
      const updatedPastures = currentBid.pastures.map((p) => {
        if (p.acreage === 0) return p;
        const cedarAcresOverride = p.id === livePricingPastureId ? livePricingCedarAcres : undefined;
        const { subtotal, methodMultiplier, estimatedHrsPerAcre } = calculatePastureCost(p, rateCard, cedarAcresOverride);
        return { ...p, subtotal, methodMultiplier, estimatedHrsPerAcre };
      });

      const { totalAmount } = calculateBidTotal(
        updatedPastures,
        currentBid.mobilizationFee,
        currentBid.burnPermitFee,
        currentBid.customLineItems,
        currentBid.contingencyPct,
        currentBid.discountPct,
        rateCard.minimumBid
      );

      const totalAcreage = updatedPastures.reduce((s, p) => s + p.acreage, 0);
      const { low, high } = estimateDuration(updatedPastures);

      return {
        currentBid: {
          ...currentBid,
          pastures: updatedPastures,
          totalAcreage: Math.round(totalAcreage * 100) / 100,
          totalAmount: isNaN(totalAmount) ? 0 : totalAmount,
          estimatedDaysLow: low,
          estimatedDaysHigh: high,
        },
      };
    });
  },

  saveBid: () => {
    const { currentBid } = get();
    if (typeof window === 'undefined') return;

    // Always save to localStorage as offline cache
    const key = `ccc_bid_${currentBid.id}`;
    localStorage.setItem(key, JSON.stringify(currentBid));
    const listKey = 'ccc_bid_list';
    const existingList: BidSummary[] = JSON.parse(localStorage.getItem(listKey) || '[]');
    const summary: BidSummary = {
      id: currentBid.id,
      bidNumber: currentBid.bidNumber,
      status: currentBid.status,
      clientName: currentBid.clientName,
      propertyName: currentBid.propertyName,
      totalAcreage: currentBid.totalAcreage,
      totalAmount: currentBid.totalAmount,
      createdAt: currentBid.createdAt,
      updatedAt: currentBid.updatedAt,
    };
    const updated = existingList.filter((b) => b.id !== currentBid.id);
    updated.unshift(summary);
    localStorage.setItem(listKey, JSON.stringify(updated));
    set({ savedBids: updated });

    // Persist to Supabase as primary data source
    if (isSupabaseConfigured) {
      const sb = createSupabaseBrowser();
      (async () => {
        const userId = await getAuthUserId(sb);
        if (!userId) return;
        set({ isAuthenticated: true });
        const { error } = await saveBidToSupabase(sb, currentBid, userId);
        if (error) {
          console.warn('[db] Supabase save failed, localStorage is still valid:', error);
        }
      })();
    }
  },

  loadBid: async (id) => {
    if (typeof window === 'undefined') return;

    // Try Supabase first (primary data source)
    if (isSupabaseConfigured) {
      try {
        const sb = createSupabaseBrowser();
        const userId = await getAuthUserId(sb);
        if (userId) {
          set({ isAuthenticated: true });
          const { bid, error } = await loadBidFromSupabase(sb, id);
          if (!error && bid) {
            set({ currentBid: bid, selectedPastureId: null, drawingMode: false });
            // Update localStorage cache
            localStorage.setItem(`ccc_bid_${id}`, JSON.stringify(bid));
            return;
          }

          // Bid not in Supabase — check localStorage and push it up
          if (!error && !bid) {
            const data = localStorage.getItem(`ccc_bid_${id}`);
            if (data) {
              const localBid = JSON.parse(data) as Bid;
              set({ currentBid: localBid, selectedPastureId: null, drawingMode: false });
              // Push local-only bid to Supabase (fire-and-forget; user already sees local data)
              saveBidToSupabase(sb, localBid, userId).catch((e) => {
                console.warn('[db] Failed to push local bid to Supabase:', e);
              });
              return;
            }
          }
        }
      } catch {
        // Fall through to localStorage
      }
    }

    // Fallback to localStorage
    const data = localStorage.getItem(`ccc_bid_${id}`);
    if (data) {
      set({ currentBid: JSON.parse(data), selectedPastureId: null, drawingMode: false });
    }
  },

  deleteBid: async (id) => {
    if (typeof window === 'undefined') return;

    // Remove from localStorage cache
    localStorage.removeItem(`ccc_bid_${id}`);
    const listKey = 'ccc_bid_list';
    const existingList: BidSummary[] = JSON.parse(localStorage.getItem(listKey) || '[]');
    const updatedList = existingList.filter((b) => b.id !== id);
    localStorage.setItem(listKey, JSON.stringify(updatedList));
    set({ savedBids: updatedList });

    // Remove from Supabase (primary data source)
    if (isSupabaseConfigured) {
      try {
        const sb = createSupabaseBrowser();
        const userId = await getAuthUserId(sb);
        if (userId) {
          const { error } = await deleteBidFromSupabase(sb, id);
          if (error) console.warn('[db] Supabase delete failed:', error);
        }
      } catch (e) {
        console.warn('[db] Supabase delete error:', e);
      }
    }
  },

  loadBidList: async () => {
    if (typeof window === 'undefined') return;

    // Try Supabase first (primary data source)
    if (isSupabaseConfigured) {
      try {
        const sb = createSupabaseBrowser();
        const userId = await getAuthUserId(sb);
        if (userId) {
          set({ isAuthenticated: true });

          // One-time migration: push localStorage bids into Supabase
          const alreadyMigrated = localStorage.getItem(BIDS_MIGRATION_FLAG) === '1';
          if (!alreadyMigrated) {
            const { migrated, failed, error: migErr } = await migrateBidsToSupabase(sb, userId);
            if (migrated > 0) {
              console.info(`[db] Migrated ${migrated} bids from localStorage to Supabase`);
            }
            if (failed > 0) {
              console.warn(`[db] ${failed} bids failed to migrate:`, migErr);
            }
          }

          const { bids, error } = await loadBidListFromSupabase(sb);
          if (!error) {
            // Merge with any local-only bids not yet in Supabase (e.g. created offline)
            const localData = localStorage.getItem('ccc_bid_list');
            const localBids: BidSummary[] = localData ? JSON.parse(localData) : [];
            const supabaseIds = new Set(bids.map((b) => b.id));
            const localOnly = localBids.filter((b) => !supabaseIds.has(b.id));
            const merged = [...bids, ...localOnly];

            // Update localStorage cache to reflect Supabase truth
            localStorage.setItem('ccc_bid_list', JSON.stringify(merged));
            set({ savedBids: merged });
            return;
          }
        }
      } catch {
        // Fall through to localStorage
      }
    }

    // Fallback to localStorage
    const data = localStorage.getItem('ccc_bid_list');
    set({ savedBids: data ? JSON.parse(data) : [] });
  },

  fetchSoilData: async (pastureId, lon, lat) => {
    try {
      const res = await fetch(`/api/soil?lon=${lon}&lat=${lat}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.soil) {
        const soilMultiplier = calculateSoilDifficulty(data.soil);
        get().updatePasture(pastureId, {
          soilData: data.soil,
          soilMultiplier,
        });
      }
    } catch {
      // Soil lookup is best-effort; don't block the user
    }
  },

  fetchElevation: async (pastureId, lon, lat) => {
    try {
      const res = await fetch(`/api/elevation?lon=${lon}&lat=${lat}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.elevationFt !== null && data.elevationFt !== undefined) {
        get().updatePasture(pastureId, { elevationFt: data.elevationFt });
      }
    } catch {
      // Elevation lookup is best-effort
    }
  },

  analyzeCedar: async (pastureId) => {
    const pasture = get().currentBid.pastures.find((p) => p.id === pastureId);
    if (!pasture || pasture.acreage === 0) return;
    if (pasture.polygon.geometry.coordinates.length === 0) return;

    const bidId = get().currentBid.id;
    const chunkCoords = getCedarAnalysisChunkPolygons(pasture.polygon.geometry.coordinates);
    const chunkKeys = chunkCoords.map((c) => hashChunkPolygonCoords(c[0]));
    const totalChunks = chunkCoords.length;
    const estimatedSamples = estimateCedarSampleCount(pasture.acreage * 4047);
    const runningWholePasture = totalChunks === 1;
    const spectralProcessLines = [
      runningWholePasture
        ? `Run stage 1 across the full pasture (${estimatedSamples} estimated ${CEDAR_GRID_SPACING_M} m cells) before moving to the next stage`
        : `Split only because the pasture exceeds the single-request limit (${WHOLE_PASTURE_STAGE_SAMPLE_LIMIT} cells)` ,
      `For each ${CEDAR_GRID_SPACING_M} m cell: USGS NAIP identify (red, green, blue, near-infrared)`,
      'Spectral indices: NDVI, GNDVI, SAVI, excess green, NIR ratio',
      'Refine every cell with hi-res winter RGB imagery from World Imagery',
      'Multi-rule classification: cedar vs oak vs mixed brush vs grass vs bare',
      'Seasonal fusion + overlapping-tile consensus smooth class boundaries when enough cells exist',
      'Build the cedar layer and place 3D tree positions',
    ];
    const polygonHash = hashPasturePolygon(pasture.polygon.geometry.coordinates);
    const analysisStartedAt = Date.now();
    const pastureBbox = bboxFromCoords(pasture.polygon.geometry.coordinates);

    const setSpectralProgress = (progress: Omit<NonNullable<BidStore['analysisProgress']>, 'active'>) => {
      set({
        analysisProgress: {
          active: true,
          ...progress,
          activeProcessIndex:
            progress.activeProcessIndex ?? activeProcessIndexForPhase(progress.phase),
        },
      });
      get().recalculate();
    };

    const clearSpectralProgress = () => {
      set({ analysisProgress: null });
      get().recalculate();
    };

    // Sparse array: null = not yet attempted or failed; CedarAnalysis = success
    const parts: (CedarAnalysis | null)[] = new Array(totalChunks).fill(null);
    let failedIndices: number[] = [];
    // Indices we still need to process
    let pendingIndices: number[] = Array.from({ length: totalChunks }, (_, i) => i);

    // --- Restore checkpoint (Supabase-first, then localStorage) ---
    const saved = await loadCedarChunkResumeHybrid(bidId, pastureId);
    if (
      saved &&
      saved.bidId === bidId &&
      saved.pastureId === pastureId &&
      saved.polygonHash === polygonHash &&
      Math.abs(saved.acreage - pasture.acreage) < 0.02 &&
      chunkKeysEqual(saved.chunkKeys, chunkKeys)
    ) {
      // Restore completed chunks from checkpoint
      for (let i = 0; i < Math.min(saved.parts.length, totalChunks); i++) {
        if (saved.parts[i] !== null) {
          parts[i] = saved.parts[i];
        }
      }
      // Determine which chunks still need work
      pendingIndices = [];
      for (let i = 0; i < totalChunks; i++) {
        if (parts[i] === null) pendingIndices.push(i);
      }

      const completedCount = totalChunks - pendingIndices.length;
      if (completedCount > 0 && pendingIndices.length > 0) {
        setSpectralProgress({
          phase: 'init',
          pastureId,
          step: 'Resuming spectral analysis…',
          detail: `${completedCount} of ${totalChunks} regions restored — continuing where you left off`,
          pct: Math.round((completedCount / totalChunks) * 90),
          percent: Math.round((completedCount / totalChunks) * 90),
          startedAt: analysisStartedAt,
          processLines: spectralProcessLines,
          focusBbox: pastureBbox,
          focusKey: `pasture-${pastureId}`,
          debugLines: [`resume restored ${completedCount}/${totalChunks} completed regions`],
        });
      } else if (completedCount === totalChunks) {
        // All chunks already done — re-apply (edge case: user re-ran after complete)
        pendingIndices = [];
      }
    }

    if (pendingIndices.length > 0) {
      const completedCount = totalChunks - pendingIndices.length;
      if (completedCount === 0) {
        setSpectralProgress({
          phase: 'init',
          pastureId,
          step: 'Initializing spectral analysis…',
          detail:
            totalChunks > 1
              ? `${totalChunks} fallback regions (~${Math.round(pasture.acreage)} ac total). This field is large enough that it still has to be processed in multiple requests.`
              : `Scanning the full pasture in one staged run (~${Math.round(pasture.acreage)} ac, ${estimatedSamples} estimated cells at ${CEDAR_GRID_SPACING_M} m)`,
          pct: 0,
          percent: 0,
          startedAt: analysisStartedAt,
          processLines: spectralProcessLines,
          focusBbox: pastureBbox,
          focusKey: `pasture-${pastureId}`,
          debugLines: [
            runningWholePasture
              ? `full-pasture mode (${estimatedSamples} estimated cells)`
              : `${totalChunks} fallback region(s) queued`,
            `polygon hash ${polygonHash.slice(0, 8)}`,
          ],
        });
      }
    }

    /**
     * Process a single chunk. Returns true on success, false on failure.
     * On failure the chunk is left as null in the parts array.
     */
    const processChunk = async (i: number): Promise<boolean> => {
      const coords = chunkCoords[i];
      const chunkAcres = polygonAcreage(coords);
      const chunkBbox = bboxFromCoords(coords);
      console.log(`[analyzeCedar] chunk ${i + 1}/${totalChunks}: ${chunkAcres.toFixed(1)} ac`);

      setSpectralProgress({
        phase: 'sampling',
        pastureId,
        step: totalChunks > 1 ? `Scanning region ${i + 1} of ${totalChunks}` : 'Scanning pasture cells',
        detail: `${chunkAcres.toFixed(1)} acres in view — fetching NAIP, hi-res imagery, and seasonal cues`,
        pct: Math.round((parts.filter((p) => p !== null).length / totalChunks) * 90),
        percent: Math.round((parts.filter((p) => p !== null).length / totalChunks) * 90),
        startedAt: analysisStartedAt,
        processLines: spectralProcessLines,
        focusBbox: chunkBbox,
        focusKey: `chunk-${i}`,
        debugLines: [`region ${i + 1}/${totalChunks}`, `${chunkAcres.toFixed(1)} ac`],
      });

      try {
        const chunkData = await fetchCedarDetectChunkWithRetry(
          coords,
          chunkAcres,
          new Date().getMonth() + 1,
          pasture.centroid[1],
          (payload) => {
            const innerPct = Number(payload.pct ?? payload.percent ?? 0);
            const completedSoFar = parts.filter((p) => p !== null).length;
            const effectiveIndex = completedSoFar;
            const pct = scaledChunkProgress(effectiveIndex, totalChunks, innerPct);
            const msg = (payload.message as string) || 'Processing…';
            const phase = (payload.phase as string) || 'sampling';
            setSpectralProgress({
              phase,
              pastureId,
              step: totalChunks > 1 ? `[Region ${i + 1}/${totalChunks}] ${msg}` : msg,
              detail: (payload.detail as string) || '',
              pct,
              percent: pct,
              startedAt: analysisStartedAt,
              cedarCount: payload.cedarCount as number | undefined,
              oakCount: payload.oakCount as number | undefined,
              estimatedCedarAcres: payload.estimatedCedarAcres as number | undefined,
              totalPoints: payload.totalPoints as number | undefined,
              completed: payload.completed as number | undefined,
              processLines: spectralProcessLines,
              focusBbox: chunkBbox,
              focusKey: `chunk-${i}`,
              debugLines: [
                `region ${i + 1}/${totalChunks}`,
                `phase ${phase}`,
                `progress ${Math.round(innerPct)}%`,
              ],
            });
          }
        );
        console.log(`[analyzeCedar] chunk ${i + 1}/${totalChunks} complete: ${chunkData.summary?.totalSamples ?? '?'} samples, cedar=${chunkData.summary?.cedar?.pct ?? '?'}%`);
        parts[i] = chunkData;

        const chunkSummary = chunkData.summary;
        const completedCount = parts.filter((p) => p !== null).length;
        const completedPct = Math.round((completedCount / totalChunks) * 90);
        const sentinelUsed = Boolean(chunkSummary.sentinelFusion?.used);
        const hiResUsed = Boolean(chunkSummary.hiResImagery?.used);
        const consensusTiles = chunkSummary.tileConsensus?.tileCount ?? 0;
        const consensusImproved = chunkSummary.tileConsensus?.consensusImprovedCells ?? 0;
        const pairedSamples = chunkSummary.sentinelFusion?.pairedSamples ?? 0;

        setSpectralProgress({
          phase: 'refining',
          pastureId,
          phaseLabel: 'REFINEMENT_CONFIRMED',
          step: totalChunks > 1 ? `Region ${i + 1} refinement complete` : 'Refinement steps complete',
          detail:
            `Applied spectral indices, hi-res RGB refinement, multi-rule classification, ` +
            `${sentinelUsed ? 'seasonal fusion' : 'seasonal fallback'} and ` +
            `${consensusTiles > 0 ? 'tile consensus' : 'consensus fallback'} for this region`,
          pct: Math.min(95, Math.max(completedPct, scaledChunkProgress(completedCount - 1, totalChunks, 92))),
          percent: Math.min(95, Math.max(completedPct, scaledChunkProgress(completedCount - 1, totalChunks, 92))),
          startedAt: analysisStartedAt,
          processLines: spectralProcessLines,
          activeProcessIndex: 5,
          focusBbox: chunkBbox,
          focusKey: `chunk-${i}`,
          debugLines: [
            'indices NDVI/GNDVI/SAVI active',
            `hi-res imagery ${hiResUsed ? 'used' : 'unavailable'}`,
            `seasonal fusion ${sentinelUsed ? `used (${pairedSamples} paired)` : 'unavailable'}`,
            `consensus ${consensusImproved} cells / ${consensusTiles} tiles`,
          ],
          cedarCount: chunkSummary.cedar.count,
          oakCount: chunkSummary.oak.count,
          estimatedCedarAcres: chunkSummary.estimatedCedarAcres,
          totalPoints: chunkSummary.totalSamples,
          completed: chunkSummary.totalSamples,
        });

        // Persist after every successful chunk
        await saveCedarChunkResumeHybrid({
          v: CEDAR_RESUME_VERSION,
          bidId,
          pastureId,
          polygonHash,
          acreage: pasture.acreage,
          chunkKeys,
          parts: [...parts],
          failedChunkIndices: failedIndices,
          updatedAt: Date.now(),
        });
        return true;
      } catch (chunkErr) {
        const msg = chunkErr instanceof Error ? chunkErr.message : 'Spectral analysis failed';
        console.error(`[analyzeCedar] chunk ${i + 1}/${totalChunks} FAILED: ${msg}`);
        setSpectralProgress({
          phase: 'retry',
          pastureId,
          step: `Region ${i + 1} failed — preparing retry`,
          detail: msg,
          pct: Math.round((parts.filter((p) => p !== null).length / totalChunks) * 90),
          percent: Math.round((parts.filter((p) => p !== null).length / totalChunks) * 90),
          startedAt: analysisStartedAt,
          processLines: spectralProcessLines,
          focusBbox: chunkBbox,
          focusKey: `chunk-${i}`,
          debugLines: [`region ${i + 1}/${totalChunks}`, msg],
        });
        return false;
      }
    };

    try {
      console.log(`[analyzeCedar] starting: ${totalChunks} chunk(s), ${Math.round(pasture.acreage)} ac, centroid=[${pasture.centroid.map(n => n.toFixed(4))}]`);

      // --- First pass: process all pending chunks ---
      const firstPassFailed: number[] = [];
      for (const i of pendingIndices) {
        const ok = await processChunk(i);
        if (!ok) firstPassFailed.push(i);
      }

      // --- Retry pass: retry failed chunks with increasing backoff ---
      // Two retry rounds strikes a balance between user wait time and recovery
      // probability for transient NAIP/network issues.
      const CHUNK_RETRY_ROUNDS = 2;
      const RETRY_BASE_MS = 3000;       // initial wait before first retry
      const RETRY_INCREMENT_MS = 3000;  // additional wait per subsequent round
      const RETRY_JITTER_MS = 2000;     // randomised spread to avoid thundering-herd
      let retryQueue = [...firstPassFailed];
      for (let round = 0; round < CHUNK_RETRY_ROUNDS && retryQueue.length > 0; round++) {
        const backoffMs = RETRY_BASE_MS + round * RETRY_INCREMENT_MS + Math.random() * RETRY_JITTER_MS;
        console.log(`[analyzeCedar] retry round ${round + 1}: ${retryQueue.length} chunks, backoff ${Math.round(backoffMs)}ms`);

        setSpectralProgress({
          phase: 'retry',
          pastureId,
          step: `Retrying ${retryQueue.length} failed region(s)…`,
          detail: `Retry round ${round + 1} of ${CHUNK_RETRY_ROUNDS} — waiting ${Math.round(backoffMs / 1000)}s before retrying`,
          pct: Math.round((parts.filter((p) => p !== null).length / totalChunks) * 90),
          percent: Math.round((parts.filter((p) => p !== null).length / totalChunks) * 90),
          startedAt: analysisStartedAt,
          processLines: spectralProcessLines,
          focusBbox: pastureBbox,
          focusKey: `pasture-${pastureId}`,
          debugLines: retryQueue.map((idx) => `retry pending region ${idx + 1}/${totalChunks}`),
        });

        await new Promise((r) => setTimeout(r, backoffMs));

        const stillFailed: number[] = [];
        for (const i of retryQueue) {
          const ok = await processChunk(i);
          if (!ok) stillFailed.push(i);
        }
        retryQueue = stillFailed;
      }

      failedIndices = retryQueue;

      // Save final state with failed indices
      await saveCedarChunkResumeHybrid({
        v: CEDAR_RESUME_VERSION,
        bidId,
        pastureId,
        polygonHash,
        acreage: pasture.acreage,
        chunkKeys,
        parts: [...parts],
        failedChunkIndices: failedIndices,
        updatedAt: Date.now(),
      });

      // --- Merge successful chunks ---
      const successParts = parts.filter((p): p is CedarAnalysis => p !== null);
      if (successParts.length === 0) {
        throw new Error(
          `All ${totalChunks} spectral analysis regions failed. Check your network connection and try again.`
        );
      }

      const resultData: CedarAnalysis =
        successParts.length === 1 ? successParts[0] : mergeCedarAnalyses(successParts, pasture.acreage);
      console.log(`[analyzeCedar] done: ${successParts.length}/${totalChunks} chunks succeeded, ${resultData.summary?.totalSamples ?? '?'} total samples, cedar=${resultData.summary?.cedar?.pct ?? '?'}%`);

      // Only clear checkpoint if ALL chunks succeeded
      if (failedIndices.length === 0) {
        await clearCedarChunkResumeHybrid(bidId, pastureId);
      }

      setSpectralProgress({
        phase: 'applying',
        pastureId,
        step: 'Applying results to map…',
        detail: failedIndices.length > 0
          ? `${failedIndices.length} of ${totalChunks} regions failed — partial results applied`
          : 'Building cedar grid and painting results on the map',
        pct: 96,
        percent: 96,
        startedAt: analysisStartedAt,
        processLines: spectralProcessLines,
        activeProcessIndex: 6,
        totalPoints: resultData.summary?.totalSamples,
        focusBbox: pastureBbox,
        focusKey: `pasture-${pastureId}`,
        debugLines: [`successful regions ${successParts.length}/${totalChunks}`],
        cedarCount: resultData.summary?.cedar.count,
        oakCount: resultData.summary?.oak.count,
        estimatedCedarAcres: resultData.summary?.estimatedCedarAcres,
      });
      get().updatePasture(pastureId, { cedarAnalysis: resultData });

      setSpectralProgress({
        phase: 'trees',
        pastureId,
        step: 'Generating 3D tree positions…',
        detail: 'Placing trees from spectral data',
        pct: 98,
        percent: 98,
        startedAt: analysisStartedAt,
        processLines: spectralProcessLines,
        activeProcessIndex: 6,
        focusBbox: pastureBbox,
        focusKey: `pasture-${pastureId}`,
        debugLines: [`total cells ${resultData.summary?.totalSamples ?? 0}`],
        cedarCount: resultData.summary?.cedar.count,
        oakCount: resultData.summary?.oak.count,
        estimatedCedarAcres: resultData.summary?.estimatedCedarAcres,
      });

      const updatedPasture = get().currentBid.pastures.find((p) => p.id === pastureId);
      if (updatedPasture) {
        const trees = extractTreesFromAnalysis([
          {
            cedarAnalysis: resultData,
            density: updatedPasture.density,
          },
        ]);
        const cedarTrees: MarkedTree[] = trees
          .filter((t) => t.species === 'cedar')
          .map((t) => ({
            id: `tree-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            lng: t.lng,
            lat: t.lat,
            species: t.species,
            action: 'remove' as const,
            label: 'Remove cedar',
            height: t.height,
            canopyDiameter: t.canopyDiameter,
          }));
        if (cedarTrees.length > 0) {
          setSpectralProgress({
            phase: 'trees',
            step: 'Auto-marking cedars',
            detail: `Marking ${cedarTrees.length} cedar trees for removal (adjust on the map if needed)`,
            pct: 99,
            percent: 99,
            startedAt: analysisStartedAt,
            processLines: spectralProcessLines,
            activeProcessIndex: 6,
            focusBbox: pastureBbox,
            focusKey: `pasture-${pastureId}`,
            debugLines: [`marked cedar trees ${cedarTrees.length}`],
            pastureId,
            cedarCount: resultData.summary?.cedar.count,
            oakCount: resultData.summary?.oak.count,
            estimatedCedarAcres: resultData.summary?.estimatedCedarAcres,
            totalPoints: resultData.summary?.totalSamples,
            completed: resultData.summary?.totalSamples,
          });
          get().updatePasture(pastureId, { savedTrees: cedarTrees });
        }
      }

      const s = resultData.summary;
      const doneDetail = failedIndices.length > 0
        ? `${s.cedar.pct}% cedar · ~${s.estimatedCedarAcres} cedar ac · ${s.totalSamples} cells — ⚠ ${failedIndices.length} region(s) failed. Run again to retry.`
        : `${s.cedar.pct}% cedar · ${s.oak?.pct ?? 0}% oak · ~${s.estimatedCedarAcres} cedar ac (mulch) of ${Math.round(pasture.acreage)} ac · ${s.totalSamples} cells`;

      setSpectralProgress({
        phase: 'done',
        step: failedIndices.length > 0 ? 'Analysis complete (partial)' : 'Analysis complete',
        detail: doneDetail,
        pct: 100,
        percent: 100,
        startedAt: analysisStartedAt,
        processLines: spectralProcessLines,
        activeProcessIndex: 6,
        totalPoints: s.totalSamples,
        completed: s.totalSamples,
        pastureId,
        cedarCount: s.cedar.count,
        oakCount: s.oak?.count,
        estimatedCedarAcres: s.estimatedCedarAcres,
        focusBbox: pastureBbox,
        focusKey: `pasture-${pastureId}`,
        debugLines: failedIndices.length > 0
          ? failedIndices.map((idx) => `failed region ${idx + 1}/${totalChunks}`)
          : [`cedar ${s.cedar.pct}%`, `oak ${s.oak?.pct ?? 0}%`, `cells ${s.totalSamples}`],
      });
      console.log(`[analyzeCedar] complete — displayed to user`);

      if (failedIndices.length > 0) {
        toast.warning(
          `${failedIndices.length} of ${totalChunks} regions failed — partial results applied. Run Spectral Analysis again to retry the failed regions.`,
          { duration: 10000 }
        );
      }

      setTimeout(clearSpectralProgress, failedIndices.length > 0 ? 6000 : 3200);
    } catch (e) {
      console.error(`[analyzeCedar] top-level error: ${e instanceof Error ? e.message : e}`);
      const msg = e instanceof Error ? e.message : 'Spectral analysis failed';
      toast.error(msg, { duration: 8000 });
      const successCount = parts.filter((p) => p !== null).length;
      if (successCount > 0 && successCount < totalChunks) {
        toast.info('Partial progress saved — run Spectral Analysis again to retry failed regions.', {
          duration: 9000,
        });
      } else if (successCount === 0 && totalChunks > 1) {
        toast.info('Progress saved — run Spectral Analysis again to resume.', {
          duration: 9000,
        });
      }
      const failedRegionDebug = failedIndices.length > 0
        ? failedIndices.map((idx) => `failed region ${idx + 1}/${totalChunks}`)
        : ['no chunk completed successfully'];
      setSpectralProgress({
        phase: 'error',
        step: 'Analysis failed',
        detail: msg,
        pct: Math.round((successCount / Math.max(totalChunks, 1)) * 100),
        percent: Math.round((successCount / Math.max(totalChunks, 1)) * 100),
        pastureId,
        startedAt: analysisStartedAt,
        focusBbox: pastureBbox,
        focusKey: `pasture-${pastureId}`,
        processLines: spectralProcessLines,
        debugLines: [`successful regions ${successCount}/${totalChunks}`, ...failedRegionDebug],
      });
      setTimeout(clearSpectralProgress, 12000);
    }
  },

  analyzeSeasonal: async (pastureId) => {
    const pasture = get().currentBid.pastures.find((p) => p.id === pastureId);
    if (!pasture || pasture.acreage === 0) return;
    if (pasture.polygon.geometry.coordinates.length === 0) return;

    try {
      const res = await fetch('/api/seasonal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coordinates: pasture.polygon.geometry.coordinates,
        }),
      });
      if (!res.ok) return;
      const data: SeasonalAnalysis = await res.json();
      get().updatePasture(pastureId, { seasonalAnalysis: data });
    } catch {
      // Seasonal analysis is best-effort
    }
  },

  updateRateCard: (updates) => {
    set((state) => ({
      rateCard: { ...state.rateCard, ...updates },
    }));
    get().recalculate();
  },

  markTree: (pastureId, tree) => {
    set((state) => ({
      currentBid: {
        ...state.currentBid,
        pastures: state.currentBid.pastures.map((p) =>
          p.id === pastureId
            ? { ...p, savedTrees: [...(p.savedTrees ?? []), tree] }
            : p
        ),
        updatedAt: new Date().toISOString(),
      },
    }));
  },

  unmarkTree: (pastureId, treeId) => {
    set((state) => ({
      currentBid: {
        ...state.currentBid,
        pastures: state.currentBid.pastures.map((p) =>
          p.id === pastureId
            ? { ...p, savedTrees: (p.savedTrees ?? []).filter((t) => t.id !== treeId) }
            : p
        ),
        updatedAt: new Date().toISOString(),
      },
    }));
  },

  updateMarkedTree: (pastureId, treeId, updates) => {
    set((state) => ({
      currentBid: {
        ...state.currentBid,
        pastures: state.currentBid.pastures.map((p) =>
          p.id === pastureId
            ? {
                ...p,
                savedTrees: (p.savedTrees ?? []).map((t) =>
                  t.id === treeId ? { ...t, ...updates } : t
                ),
              }
            : p
        ),
        updatedAt: new Date().toISOString(),
      },
    }));
  },

  aiPopulate: async (pastureId) => {
    const pasture = get().currentBid.pastures.find((p) => p.id === pastureId);
    if (!pasture || pasture.acreage === 0) return null;

    try {
      const res = await fetch('/api/ai-populate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acreage: pasture.acreage,
          centroid: pasture.centroid,
          elevationFt: pasture.elevationFt,
          soilData: pasture.soilData,
          soilMultiplier: pasture.soilMultiplier,
          cedarAnalysis: pasture.cedarAnalysis
            ? {
                summary: pasture.cedarAnalysis.summary,
              }
            : null,
          seasonalAnalysis: pasture.seasonalAnalysis,
        }),
      });
      if (!res.ok) return null;
      const rec: AIRecommendation = await res.json();

      // Apply AI recommendations to pasture
      const adders = rec.suggestedAdders
        .map((id) => {
          const def = get().rateCard.methodAdders.find((d) => d.id === id);
          if (!def) return null;
          const qty = def.unit === 'acre' ? pasture.acreage : 1;
          return { adderId: id, quantity: qty, costPerUnit: def.defaultCost };
        })
        .filter((a): a is NonNullable<typeof a> => a !== null);

      get().updatePasture(pastureId, {
        vegetationType: rec.vegetationType,
        density: rec.density,
        terrain: rec.terrain,
        clearingMethod: rec.clearingMethod,
        disposalMethod: rec.disposalMethod,
        notes: rec.notes,
        adders: adders.length > 0 ? adders : pasture.adders,
      });

      return rec;
    } catch {
      return null;
    }
  },
}));
