import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
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
  buildSpectralChunkBboxes,
  mergeCedarChunkResults,
  CEDAR_MAX_SAMPLES_PER_CHUNK,
} from '@/lib/cedar-chunk';

function generateBidNumber(): string {
  const now = new Date();
  const y = String(now.getFullYear()).slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const seq = String(Math.floor(Math.random() * 900) + 100);
  return `CCC-${y}${m}-${seq}`;
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

const CEDAR_API_MAX_ATTEMPTS = 5;
/** Must exceed server maxDuration (300s) so the client does not abort first. */
const CEDAR_FETCH_TIMEOUT_MS = 320_000;

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableCedarHttpStatus(status: number): boolean {
  return (
    status === 408 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

type CedarDetectBody = {
  coordinates: number[][][];
  acreage: number;
  clipBbox?: [number, number, number, number];
};

/**
 * POST /api/cedar-detect with retries: handles gateway timeouts, truncated JSON,
 * and transient NAIP/upstream failures. Validates a complete CedarAnalysis shape.
 */
async function fetchCedarAnalysisWithRetries(
  body: CedarDetectBody,
  onAttempt: (attempt: number, maxAttempts: number) => void
): Promise<CedarAnalysis> {
  let lastMessage = 'Spectral analysis failed';

  for (let attempt = 1; attempt <= CEDAR_API_MAX_ATTEMPTS; attempt++) {
    onAttempt(attempt, CEDAR_API_MAX_ATTEMPTS);
    try {
      const res = await fetch('/api/cedar-detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(CEDAR_FETCH_TIMEOUT_MS),
      });

      const text = await res.text();

      if (!res.ok) {
        let errDetail = `Analysis server returned ${res.status}`;
        try {
          const errJson = JSON.parse(text) as { error?: string; detail?: string };
          if (typeof errJson?.error === 'string' || typeof errJson?.detail === 'string') {
            errDetail = errJson.detail ?? errJson.error ?? errDetail;
          }
        } catch {
          /* use errDetail */
        }
        lastMessage = errDetail;
        const nonRetryable = res.status === 400 || res.status === 404;
        if (!nonRetryable && isRetryableCedarHttpStatus(res.status) && attempt < CEDAR_API_MAX_ATTEMPTS) {
          await sleepMs(1500 * 2 ** (attempt - 1));
          continue;
        }
        throw new Error(lastMessage);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        lastMessage =
          'No spectral result was received. The analysis stream may have been cut off.';
        if (attempt < CEDAR_API_MAX_ATTEMPTS) {
          await sleepMs(1500 * 2 ** (attempt - 1));
          continue;
        }
        throw new Error(lastMessage);
      }

      const errObj = parsed as { error?: string; detail?: string };
      if (typeof errObj?.error === 'string' && !('gridCells' in (parsed as object))) {
        lastMessage = errObj.detail ?? errObj.error;
        if (attempt < CEDAR_API_MAX_ATTEMPTS && (res.status >= 500 || /timeout|unavailable/i.test(lastMessage))) {
          await sleepMs(1500 * 2 ** (attempt - 1));
          continue;
        }
        throw new Error(lastMessage);
      }

      const data = parsed as Partial<CedarAnalysis>;
      if (
        !data.gridCells ||
        data.summary === undefined ||
        data.summary === null ||
        typeof data.summary.totalSamples !== 'number'
      ) {
        lastMessage =
          'No spectral result was received. The analysis stream may have been cut off.';
        if (attempt < CEDAR_API_MAX_ATTEMPTS) {
          await sleepMs(1500 * 2 ** (attempt - 1));
          continue;
        }
        throw new Error(lastMessage);
      }

      return data as CedarAnalysis;
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      const isAbort = name === 'AbortError' || name === 'TimeoutError';
      const isNetwork = e instanceof TypeError;
      lastMessage =
        isAbort
          ? 'Spectral analysis timed out — large pastures can take several minutes. Retrying…'
          : e instanceof Error
            ? e.message
            : 'Spectral analysis failed';

      if ((isAbort || isNetwork) && attempt < CEDAR_API_MAX_ATTEMPTS) {
        await sleepMs(1500 * 2 ** (attempt - 1));
        continue;
      }
      if (attempt < CEDAR_API_MAX_ATTEMPTS && e instanceof Error && /cut off|invalid|JSON/i.test(e.message)) {
        await sleepMs(1500 * 2 ** (attempt - 1));
        continue;
      }
      throw e instanceof Error ? e : new Error(lastMessage);
    }
  }

  throw new Error(lastMessage);
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

  // Analysis progress
  analysisProgress: { active: boolean; step: string; detail: string } | null;

  // All saved bids (local storage for Phase 1)
  savedBids: BidSummary[];

  // Actions
  setCurrentBid: (bid: Bid) => void;
  updateBidField: <K extends keyof Bid>(field: K, value: Bid[K]) => void;
  newBid: () => void;

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

  // Persistence (local storage for Phase 1)
  saveBid: () => void;
  loadBid: (id: string) => void;
  deleteBid: (id: string) => void;
  loadBidList: () => void;
}

export const useBidStore = create<BidStore>((set, get) => ({
  currentBid: createDefaultBid(),
  rateCard: DEFAULT_RATE_CARD,
  selectedPastureId: null,
  drawingMode: false,
  analysisProgress: null,
  savedBids: [],

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
    set({ analysisProgress: { active: true, step: 'Fetching soil data...', detail: 'Querying USDA SSURGO database for soil composition' } });
    get().fetchSoilData(id, centroid[0], centroid[1]);
    // Auto-fetch elevation
    set({ analysisProgress: { active: true, step: 'Fetching elevation...', detail: 'Querying USGS elevation data for terrain profile' } });
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
      const updatedPastures = currentBid.pastures.map((p) => {
        if (p.acreage === 0) return p;
        const { subtotal, methodMultiplier, estimatedHrsPerAcre } = calculatePastureCost(p, rateCard);
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
    const key = `ccc_bid_${currentBid.id}`;
    if (typeof window !== 'undefined') {
      localStorage.setItem(key, JSON.stringify(currentBid));
      // Update list
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
    }
  },

  loadBid: (id) => {
    if (typeof window !== 'undefined') {
      const data = localStorage.getItem(`ccc_bid_${id}`);
      if (data) {
        set({ currentBid: JSON.parse(data), selectedPastureId: null, drawingMode: false });
      }
    }
  },

  deleteBid: (id) => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(`ccc_bid_${id}`);
      const listKey = 'ccc_bid_list';
      const existingList: BidSummary[] = JSON.parse(localStorage.getItem(listKey) || '[]');
      const updated = existingList.filter((b) => b.id !== id);
      localStorage.setItem(listKey, JSON.stringify(updated));
      set({ savedBids: updated });
    }
  },

  loadBidList: () => {
    if (typeof window !== 'undefined') {
      const data = localStorage.getItem('ccc_bid_list');
      set({ savedBids: data ? JSON.parse(data) : [] });
    }
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

    try {
      const coords = pasture.polygon.geometry.coordinates;
      const chunkBboxes = buildSpectralChunkBboxes(coords, pasture.acreage);
      const useChunks = chunkBboxes.length > 0;
      const totalChunks = useChunks ? chunkBboxes.length : 1;

      set({
        analysisProgress: {
          active: true,
          step: 'Running spectral analysis...',
          detail: useChunks
            ? `Large pasture — ${totalChunks} regions (max ~${CEDAR_MAX_SAMPLES_PER_CHUNK.toLocaleString()} samples each)`
            : `Sampling NAIP imagery across ${Math.round(pasture.acreage)} acres at 15m resolution`,
        },
      });

      const parts: CedarAnalysis[] = [];

      if (!useChunks) {
        const data = await fetchCedarAnalysisWithRetries(
          { coordinates: coords, acreage: pasture.acreage },
          (attempt, max) => {
            if (attempt > 1) {
              set({
                analysisProgress: {
                  active: true,
                  step: 'Retrying spectral analysis…',
                  detail: `Attempt ${attempt} of ${max} — connection or imagery service was interrupted`,
                },
              });
            }
          }
        );
        parts.push(data);
      } else {
        for (let i = 0; i < chunkBboxes.length; i++) {
          const clipBbox = chunkBboxes[i] as [number, number, number, number];
          set({
            analysisProgress: {
              active: true,
              step: `Spectral analysis — region ${i + 1} of ${totalChunks}`,
              detail: 'Fetching NAIP pixels and classifying vegetation…',
            },
          });
          const chunk = await fetchCedarAnalysisWithRetries(
            { coordinates: coords, acreage: pasture.acreage, clipBbox },
            (attempt, max) => {
              if (attempt > 1) {
                set({
                  analysisProgress: {
                    active: true,
                    step: `Retrying region ${i + 1} of ${totalChunks}…`,
                    detail: `Attempt ${attempt} of ${max} — connection or imagery service was interrupted`,
                  },
                });
              }
            }
          );
          parts.push(chunk);
        }
      }

      const data =
        parts.length === 1 ? parts[0] : mergeCedarChunkResults(parts, pasture.acreage);
      set({ analysisProgress: { active: true, step: 'Processing results...', detail: 'Classifying vegetation: cedar, oak, grass, brush, bare ground' } });
      get().updatePasture(pastureId, { cedarAnalysis: data });

      // Auto-mark all cedar trees as "remove" by default
      set({ analysisProgress: { active: true, step: 'Generating tree positions...', detail: 'Placing 3D trees based on spectral classification results' } });
      const updatedPasture = get().currentBid.pastures.find((p) => p.id === pastureId);
      if (updatedPasture) {
        const trees = extractTreesFromAnalysis([{
          cedarAnalysis: data,
          density: updatedPasture.density,
        }]);
        const cedarTrees: MarkedTree[] = trees
          .filter((t) => t.species === 'cedar')
          .map((t) => ({
            id: `tree-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            lng: t.lng,
            lat: t.lat,
            species: t.species,
            action: 'remove' as const,
            label: `Remove cedar`,
            height: t.height,
            canopyDiameter: t.canopyDiameter,
          }));
        if (cedarTrees.length > 0) {
          set({ analysisProgress: { active: true, step: 'Auto-marking cedars...', detail: `Marking ${cedarTrees.length} cedar trees for removal` } });
          get().updatePasture(pastureId, { savedTrees: cedarTrees });
        }
      }
      set({ analysisProgress: { active: true, step: 'Analysis complete!', detail: `Found ${data.summary.cedar.pct}% cedar across ${data.summary.totalSamples} sample points` } });
      // Clear after a brief moment so user sees the completion
      setTimeout(() => set({ analysisProgress: null }), 2000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Spectral analysis failed';
      toast.error(msg, { duration: 8000 });
      set({ analysisProgress: null });
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
