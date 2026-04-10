import { create } from 'zustand';
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
import { getCedarAnalysisChunkPolygons, polygonAcreage } from '@/lib/cedar-analysis-chunks';
import { mergeCedarAnalyses } from '@/lib/merge-cedar-analysis';

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

  // Analysis progress
  analysisProgress: {
    active: boolean;
    step: string;
    detail: string;
    /** 0–100 when known (spectral chunking); omit for indeterminate */
    progressPct?: number;
    /** Short labels for what the pipeline is doing */
    processLines?: string[];
  } | null;

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

    const spectralProcessLines = [
      'Partition pasture into regions sized for reliable NAIP sampling',
      'For each 15 m cell: USGS NAIP identify (red, green, blue, near-infrared)',
      'Spectral indices: NDVI, GNDVI, SAVI, excess green, NIR ratio',
      'Multi-rule classification: cedar vs oak vs mixed brush vs grass vs bare',
      'Overlapping-tile consensus to stabilize class boundaries',
    ];

    try {
      const chunkCoords = getCedarAnalysisChunkPolygons(pasture.polygon.geometry.coordinates);
      const totalChunks = chunkCoords.length;

      set({
        analysisProgress: {
          active: true,
          step: 'Spectral analysis (NAIP)',
          detail:
            totalChunks > 1
              ? `Large pasture: analyzing ${totalChunks} regions sequentially (~${Math.round(pasture.acreage)} acres total, 15 m cells). This can take several minutes.`
              : `Sampling NAIP imagery across ~${Math.round(pasture.acreage)} acres at 15 m resolution.`,
          progressPct: 0,
          processLines: spectralProcessLines,
        },
      });

      const parts: CedarAnalysis[] = [];

      for (let i = 0; i < chunkCoords.length; i++) {
        const coords = chunkCoords[i];
        const chunkAcres = polygonAcreage(coords);
        const pctWhileFetching = Math.min(88, Math.round(((i + 0.35) / totalChunks) * 88));

        set({
          analysisProgress: {
            active: true,
            step: 'Spectral analysis (NAIP)',
            detail: `Region ${i + 1} of ${totalChunks}: requesting multispectral pixels from USGS (~${Math.round(chunkAcres)} ac in this region)…`,
            progressPct: Math.round((i / totalChunks) * 85),
            processLines: [
              ...spectralProcessLines.slice(0, 2),
              `Current: region ${i + 1}/${totalChunks} — NAIP identify batches (server)`,
              ...spectralProcessLines.slice(2),
            ],
          },
        });

        const res = await fetch('/api/cedar-detect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            coordinates: coords,
            acreage: chunkAcres,
          }),
        });

        set({
          analysisProgress: {
            active: true,
            step: 'Spectral analysis (NAIP)',
            detail: `Region ${i + 1} of ${totalChunks}: classifying vegetation and applying spatial consensus…`,
            progressPct: pctWhileFetching,
            processLines: spectralProcessLines,
          },
        });

        if (!res.ok) {
          set({
            analysisProgress: {
              active: true,
              step: 'Spectral analysis failed',
              detail: `Region ${i + 1} of ${totalChunks} could not be analyzed. Try again or split the pasture into smaller polygons.`,
              progressPct: undefined,
              processLines: undefined,
            },
          });
          setTimeout(() => set({ analysisProgress: null }), 6000);
          return;
        }

        const chunkData: CedarAnalysis = await res.json();
        parts.push(chunkData);
      }

      set({
        analysisProgress: {
          active: true,
          step: 'Merging spectral results',
          detail:
            totalChunks > 1
              ? `Combining ${totalChunks} regions and deduplicating edge cells…`
              : 'Finalizing summary statistics…',
          progressPct: 92,
          processLines: spectralProcessLines,
        },
      });

      const data: CedarAnalysis =
        parts.length === 1 ? parts[0] : mergeCedarAnalyses(parts, pasture.acreage);

      set({
        analysisProgress: {
          active: true,
          step: 'Processing results',
          detail: 'Aggregating cedar / oak / brush / grass / bare fractions for pricing',
          progressPct: 95,
          processLines: spectralProcessLines,
        },
      });

      get().updatePasture(pastureId, { cedarAnalysis: data });

      set({
        analysisProgress: {
          active: true,
          step: 'Generating tree positions',
          detail: 'Placing 3D tree instances from spectral cedar / oak cells',
          progressPct: 97,
          processLines: spectralProcessLines,
        },
      });

      const updatedPasture = get().currentBid.pastures.find((p) => p.id === pastureId);
      if (updatedPasture) {
        const trees = extractTreesFromAnalysis([
          {
            cedarAnalysis: data,
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
            label: `Remove cedar`,
            height: t.height,
            canopyDiameter: t.canopyDiameter,
          }));
        if (cedarTrees.length > 0) {
          set({
            analysisProgress: {
              active: true,
              step: 'Auto-marking cedars',
              detail: `Marking ${cedarTrees.length} cedar trees for removal (you can adjust in the map)`,
              progressPct: 98,
              processLines: spectralProcessLines,
            },
          });
          get().updatePasture(pastureId, { savedTrees: cedarTrees });
        }
      }

      set({
        analysisProgress: {
          active: true,
          step: 'Analysis complete',
          detail: `Cedar ~${data.summary.cedar.pct}% of samples (${data.summary.totalSamples} cells). Estimated cedar acres for mulching: ~${data.summary.estimatedCedarAcres} of ${Math.round(pasture.acreage)} ac pasture.`,
          progressPct: 100,
          processLines: undefined,
        },
      });
      setTimeout(() => set({ analysisProgress: null }), 3200);
    } catch {
      set({
        analysisProgress: {
          active: true,
          step: 'Spectral analysis error',
          detail: 'An unexpected error occurred. Check your connection and try re-drawing the pasture.',
        },
      });
      setTimeout(() => set({ analysisProgress: null }), 5000);
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
