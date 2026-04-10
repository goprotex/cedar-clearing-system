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
import { extractTreesFromAnalysis } from '@/lib/tree-layer';
import { normalizeCedarAnalysisPayload } from '@/lib/cedar-analysis-grid';

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
    step: string;
    detail: string;
    pct: number;
    percent?: number;
    phase: string;
    cedarCount?: number;
    oakCount?: number;
    totalPoints?: number;
    completed?: number;
  } | null;

  // All saved bids (local storage for Phase 1)
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
      set({ analysisProgress: { active: true, phase: 'init', step: 'Initializing spectral analysis...', detail: `Scanning ${Math.round(pasture.acreage)} acres at 15m resolution`, pct: 0, percent: 0 } });

      const res = await fetch('/api/cedar-detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coordinates: pasture.polygon.geometry.coordinates,
          acreage: pasture.acreage,
          month: new Date().getMonth() + 1,
          latitude: pasture.centroid[1],
        }),
      });

      if (!res.ok) {
        let msg = `Spectral analysis failed (${res.status})`;
        try {
          const errBody = (await res.json()) as { error?: string; detail?: string };
          if (errBody.error) msg = errBody.detail ? `${errBody.error}: ${errBody.detail}` : errBody.error;
        } catch {
          /* ignore */
        }
        set({ analysisProgress: null });
        toast.error(msg);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        set({ analysisProgress: null });
        toast.error('Spectral analysis: no response body from server.');
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let resultData: CedarAnalysis | null = null;
      let streamError: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let eventType = '';
        for (const rawLine of lines) {
          const line = rawLine.replace(/\r$/, '');
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ') && eventType) {
            try {
              const payload = JSON.parse(line.slice(6).trim()) as Record<string, unknown>;
              if (eventType === 'progress') {
                const p = Number(payload.pct ?? payload.percent ?? 0);
                set({
                  analysisProgress: {
                    active: true,
                    phase: (payload.phase as string) || 'sampling',
                    step: (payload.message as string) || 'Processing...',
                    detail: (payload.detail as string) || '',
                    pct: p,
                    percent: p,
                    cedarCount: payload.cedarCount as number | undefined,
                    oakCount: payload.oakCount as number | undefined,
                    totalPoints: payload.totalPoints as number | undefined,
                    completed: payload.completed as number | undefined,
                  },
                });
              } else if (eventType === 'error') {
                streamError =
                  typeof payload.message === 'string'
                    ? payload.message
                    : 'Spectral analysis failed on the server.';
              } else if (eventType === 'result') {
                resultData = normalizeCedarAnalysisPayload(payload);
              }
            } catch {
              /* skip malformed line */
            }
            eventType = '';
          }
        }
      }

      if (streamError) {
        set({ analysisProgress: null });
        toast.error(streamError);
        return;
      }

      if (!resultData) {
        set({ analysisProgress: null });
        toast.error(
          'No spectral result was received. Try a smaller pasture, check your connection, or retry — the analysis stream may have been cut off.'
        );
        return;
      }

      set({ analysisProgress: { active: true, phase: 'applying', step: 'Applying results to map...', detail: '', pct: 96, percent: 96, totalPoints: resultData.summary?.totalSamples } });
      get().updatePasture(pastureId, { cedarAnalysis: resultData });

      set({ analysisProgress: { active: true, phase: 'trees', step: 'Generating 3D tree positions...', detail: 'Placing trees from spectral data', pct: 98, percent: 98 } });
      const updatedPasture = get().currentBid.pastures.find((p) => p.id === pastureId);
      if (updatedPasture) {
        const trees = extractTreesFromAnalysis([{
          cedarAnalysis: resultData,
          density: updatedPasture.density,
        }]);
        const cedarTrees: MarkedTree[] = trees
          .filter((t) => t.species === 'cedar')
          .map((t) => ({
            id: `tree-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            lng: t.lng, lat: t.lat, species: t.species,
            action: 'remove' as const,
            label: 'Remove cedar',
            height: t.height, canopyDiameter: t.canopyDiameter,
          }));
        if (cedarTrees.length > 0) {
          get().updatePasture(pastureId, { savedTrees: cedarTrees });
        }
      }

      const s = resultData.summary;
      set({ analysisProgress: { active: true, phase: 'done', step: 'Analysis complete', detail: `${s.cedar.pct}% cedar · ${s.oak?.pct || 0}% oak · ${s.totalSamples} samples`, pct: 100, percent: 100, totalPoints: s.totalSamples } });
      setTimeout(() => set({ analysisProgress: null }), 3000);
    } catch (e) {
      set({ analysisProgress: null });
      toast.error(e instanceof Error ? e.message : 'Spectral analysis failed.');
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
