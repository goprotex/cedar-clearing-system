'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import { useBidStore } from '@/lib/store';
import PastureCard from '@/components/bid/PastureCard';
import BidSummary from '@/components/bid/BidSummary';
import BidDetails from '@/components/bid/BidDetails';
import BidOptions from '@/components/bid/BidOptions';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
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
      <div className="h-screen flex items-center justify-center bg-slate-900 text-slate-400">
        Loading bid...
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Top bar */}
      <header className="h-14 bg-slate-900 text-white flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/bids" className="text-amber-500 font-bold text-lg hover:text-amber-400">
            CH
          </Link>
          <span className="text-slate-500">|</span>
          <span className="font-medium">{currentBid.bidNumber}</span>
          <Select
            value={currentBid.status}
            onValueChange={(v) => updateBidField('status', v as BidStatus)}
          >
            <SelectTrigger className={`h-7 w-28 text-xs bg-transparent border ${STATUS_COLORS[currentBid.status]}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="text-xs border-slate-600 text-slate-300 hover:bg-slate-800"
            onClick={handleSave}
          >
            Save
          </Button>
          <Button
            size="sm"
            className="text-xs bg-amber-600 hover:bg-amber-700"
            onClick={() => {
              handleSave();
              toast.info('PDF generation coming in Phase 4');
            }}
          >
            Generate PDF
          </Button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Map (takes remaining space) */}
        <div className="flex-1 relative">
          {mapboxToken ? (
            <MapContainer accessToken={mapboxToken} />
          ) : (
            <div className="w-full h-full bg-slate-800 flex items-center justify-center text-slate-400">
              <div className="text-center space-y-2">
                <p className="text-lg">Mapbox token not configured</p>
                <p className="text-sm">
                  Add <code className="bg-slate-700 px-1.5 py-0.5 rounded">NEXT_PUBLIC_MAPBOX_TOKEN</code> to your{' '}
                  <code className="bg-slate-700 px-1.5 py-0.5 rounded">.env.local</code> file
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <div className="w-[400px] bg-white border-l flex flex-col shrink-0">
          <Tabs defaultValue="pastures" className="flex flex-col h-full">
            <TabsList className="mx-3 mt-3 shrink-0">
              <TabsTrigger value="pastures" className="text-xs">Pastures</TabsTrigger>
              <TabsTrigger value="options" className="text-xs">Options</TabsTrigger>
              <TabsTrigger value="details" className="text-xs">Details</TabsTrigger>
            </TabsList>

            <TabsContent value="pastures" className="flex-1 flex flex-col overflow-hidden mt-0 px-3">
              {/* Add pasture button */}
              <div className="py-3 shrink-0">
                <Button
                  onClick={addPasture}
                  className="w-full bg-amber-600 hover:bg-amber-700 text-sm"
                >
                  + Add Pasture
                </Button>
              </div>

              {/* Pasture list */}
              <ScrollArea className="flex-1 -mx-3 px-3">
                <div className="space-y-3 pb-4">
                  {currentBid.pastures.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground text-sm">
                      <p className="text-2xl mb-2">🗺️</p>
                      <p>No pastures yet</p>
                      <p className="text-xs mt-1">Click &quot;Add Pasture&quot; to start drawing</p>
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
                </div>
              </ScrollArea>

              {/* Bid summary pinned at bottom */}
              {currentBid.pastures.length > 0 && (
                <div className="py-3 shrink-0">
                  <BidSummary />
                </div>
              )}
            </TabsContent>

            <TabsContent value="options" className="flex-1 overflow-hidden mt-0">
              <ScrollArea className="h-full px-3 pb-4">
                <div className="py-3">
                  <BidOptions />
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="details" className="flex-1 overflow-hidden mt-0">
              <ScrollArea className="h-full px-3 pb-4">
                <div className="py-3">
                  <BidDetails />
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
