'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import { useBidStore } from '@/lib/store';
import PastureCard from '@/components/bid/PastureCard';
import BidSummary from '@/components/bid/BidSummary';
import BidDetails from '@/components/bid/BidDetails';
import BidOptions from '@/components/bid/BidOptions';
import RateCardSettings from '@/components/bid/RateCardSettings';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import Link from 'next/link';
import { toast } from 'sonner';
import type { BidStatus } from '@/types';

const STATUS_OPTIONS: { value: BidStatus; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'declined', label: 'Declined' },
  { value: 'expired', label: 'Expired' },
];

const STATUS_COLORS: Record<BidStatus, string> = {
  draft: 'border-slate-500 text-slate-300',
  sent: 'border-blue-500 text-blue-300',
  accepted: 'border-emerald-500 text-emerald-300',
  declined: 'border-red-500 text-red-300',
  expired: 'border-amber-500 text-amber-300',
};

// Dynamic import for Mapbox (no SSR)
const MapContainer = dynamic(() => import('@/components/map/MapContainer'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-slate-800 flex items-center justify-center text-slate-400">
      Loading map...
    </div>
  ),
});

export default function BidEditorClient({ bidId }: { bidId: string }) {
  const {
    currentBid,
    selectedPastureId,
    addPasture,
    saveBid,
    loadBid,
    updateBidField,
  } = useBidStore();

  // Prevent hydration mismatch: Zustand generates random IDs/bid numbers
  // on server vs client. Delay rendering until client is mounted.
  const [mounted, setMounted] = useState(false);

  // Auto-save with debounce (3 seconds after last change)
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastUpdatedAt = useRef(currentBid.updatedAt);

  // Load bid from localStorage on mount
  useEffect(() => {
    loadBid(bidId);
    // If no saved data was found for this ID, the store still holds
    // the previous (stale) bid. Reset to a fresh bid keyed to this ID.
    const state = useBidStore.getState();
    if (state.currentBid.id !== bidId) {
      state.newBid();
    }
    setMounted(true);
  }, [bidId, loadBid]);

  useEffect(() => {
    if (currentBid.updatedAt !== lastUpdatedAt.current && currentBid.pastures.length > 0) {
      lastUpdatedAt.current = currentBid.updatedAt;
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = setTimeout(() => {
        saveBid();
      }, 3000);
    }
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [currentBid.updatedAt, currentBid.pastures.length, saveBid]);

  const handleSave = useCallback(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    saveBid();
    toast.success('Bid saved');
  }, [saveBid]);

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

  // All hooks above — safe to early-return now
  if (!mounted) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#131313] text-[#a98a7d]">
        <div className="text-center">
          <div className="text-[#FF6B00] text-2xl font-black uppercase tracking-widest mb-2">LOADING_BID</div>
          <div className="text-xs font-mono">INITIALIZING_ESTIMATOR...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-[#131313] text-[#e5e2e1]">
      {/* Top bar */}
      <header className="h-14 bg-[#131313] border-b-2 border-[#353534] text-[#FFB693] flex items-center justify-between px-3 md:px-4 shrink-0">
        <div className="flex items-center gap-2 md:gap-3 min-w-0">
          <Link href="/bids" className="text-[#FF6B00] font-bold text-lg hover:text-white tracking-widest uppercase shrink-0">
            CH
          </Link>
          <span className="text-[#353534] shrink-0">|</span>
          <span className="font-mono font-bold text-sm truncate">{currentBid.bidNumber}</span>
          <Select
            value={currentBid.status}
            onValueChange={(v) => updateBidField('status', v as BidStatus)}
          >
            <SelectTrigger className={`h-7 w-24 md:w-28 text-xs bg-transparent border ${STATUS_COLORS[currentBid.status]} shrink-0`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-[10px] text-[#5a4136] font-mono hidden lg:inline truncate">
            // {currentBid.clientName || 'NO_CLIENT'} — {currentBid.propertyName || 'NO_PROPERTY'}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="text-xs border-[#353534] text-[#a98a7d] hover:bg-[#353534] hover:text-white font-bold uppercase tracking-widest hidden sm:inline-flex"
            onClick={handleSave}
          >
            SAVE_DRAFT
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs border-[#353534] text-[#a98a7d] hover:bg-[#353534] hover:text-white font-bold sm:hidden"
            onClick={handleSave}
          >
            SAVE
          </Button>
          <Button
            size="sm"
            className="text-xs bg-[#FF6B00] text-black font-black hover:bg-white uppercase tracking-widest hidden sm:inline-flex"
            onClick={() => {
              handleSave();
              toast.info('PDF generation coming in Phase 4');
            }}
          >
            GENERATE_PDF
          </Button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Map (takes remaining space) */}
        <div className="h-[40vh] md:h-auto md:flex-1 relative shrink-0">
          {mapboxToken ? (
            <MapContainer accessToken={mapboxToken} />
          ) : (
            <div className="w-full h-full bg-[#0e0e0e] flex items-center justify-center text-[#a98a7d]">
              <div className="text-center space-y-2 border-2 border-[#353534] p-8">
                <p className="text-lg font-black uppercase tracking-tighter">SATELLITE_FEED_OFFLINE</p>
                <p className="text-sm font-mono">
                  Add <code className="bg-[#353534] px-1.5 py-0.5 text-[#FF6B00]">NEXT_PUBLIC_MAPBOX_TOKEN</code> to your{' '}
                  <code className="bg-[#353534] px-1.5 py-0.5 text-[#FF6B00]">.env.local</code> file
                </p>
                <div className="flex items-center justify-center gap-2 mt-4">
                  <span className="w-2 h-2 bg-red-500 animate-pulse" />
                  <span className="text-[10px] text-red-400 font-black uppercase">SIGNAL_LOST</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <div className="w-full md:w-[400px] bg-[#131313] border-t-2 md:border-t-0 md:border-l-2 border-[#353534] flex flex-col shrink-0 overflow-hidden flex-1 md:flex-none">
          <Tabs defaultValue="pastures" className="flex flex-col h-full overflow-hidden">
            <TabsList className="mx-3 mt-3 shrink-0 bg-[#1c1b1b] border border-[#353534]">
              <TabsTrigger value="pastures" className="text-xs uppercase tracking-wider font-bold data-[state=active]:bg-[#FF6B00] data-[state=active]:text-black">Pastures</TabsTrigger>
              <TabsTrigger value="options" className="text-xs uppercase tracking-wider font-bold data-[state=active]:bg-[#FF6B00] data-[state=active]:text-black">Options</TabsTrigger>
              <TabsTrigger value="details" className="text-xs uppercase tracking-wider font-bold data-[state=active]:bg-[#FF6B00] data-[state=active]:text-black">Details</TabsTrigger>
              <TabsTrigger value="settings" className="text-xs uppercase tracking-wider font-bold data-[state=active]:bg-[#FF6B00] data-[state=active]:text-black">Settings</TabsTrigger>
            </TabsList>

            <TabsContent value="pastures" className="flex-1 min-h-0 flex flex-col overflow-hidden mt-0">
              {/* Add pasture button */}
              <div className="py-3 px-3 shrink-0">
                <Button
                  onClick={addPasture}
                  className="w-full bg-[#FF6B00] text-black font-black text-sm uppercase tracking-widest hover:bg-white transition-all"
                >
                  + ADD_PASTURE
                </Button>
              </div>

              {/* Pasture list — native scroll */}
              <div className="flex-1 min-h-0 overflow-y-auto px-3">
                <div className="space-y-3 pb-4">
                  {currentBid.pastures.length === 0 ? (
                    <div className="text-center py-12 text-[#a98a7d] text-sm border-2 border-dashed border-[#353534]">
                      <p className="text-2xl mb-2">🗺️</p>
                      <p className="font-black uppercase tracking-tight">NO_ZONES_DEFINED</p>
                      <p className="text-xs mt-1">Click &quot;ADD_PASTURE&quot; to begin mapping</p>
                    </div>
                  ) : (
                    currentBid.pastures.map((p) => (
                      <PastureCard
                        key={p.id}
                        pasture={p}
                        isSelected={p.id === selectedPastureId}
                      />
                    ))
                  )}

                  {/* Bid summary at end of scroll */}
                  {currentBid.pastures.length > 0 && (
                    <div className="pt-2">
                      <BidSummary />
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="options" className="flex-1 min-h-0 overflow-y-auto mt-0">
              <div className="px-3 py-3 pb-4">
                <BidOptions />
              </div>
            </TabsContent>

            <TabsContent value="details" className="flex-1 min-h-0 overflow-y-auto mt-0">
              <div className="px-3 py-3 pb-4">
                <BidDetails />
              </div>
            </TabsContent>

            <TabsContent value="settings" className="flex-1 min-h-0 overflow-y-auto mt-0">
              <div className="px-3 py-3 pb-4">
                <RateCardSettings />
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
