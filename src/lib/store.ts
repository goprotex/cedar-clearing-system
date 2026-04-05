import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { Bid, BidSummary, CustomLineItem, Pasture, RateCard } from '@/types';
import {
  calculatePastureCost,
  calculateBidTotal,
  estimateDuration,
  calculateSoilDifficulty,
  DEFAULT_RATE_CARD,
} from '@/lib/rates';

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
    get().fetchSoilData(id, centroid[0], centroid[1]);
    // Auto-fetch elevation
    get().fetchElevation(id, centroid[0], centroid[1]);
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
}));
