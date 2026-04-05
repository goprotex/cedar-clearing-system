'use client';

import dynamic from 'next/dynamic';
import { useBidStore } from '@/lib/store';
import PastureCard from '@/components/bid/PastureCard';
import BidSummary from '@/components/bid/BidSummary';
import BidDetails from '@/components/bid/BidDetails';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Link from 'next/link';

// Dynamic import for Mapbox (no SSR)
const MapContainer = dynamic(() => import('@/components/map/MapContainer'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-slate-800 flex items-center justify-center text-slate-400">
      Loading map...
    </div>
  ),
});

export default function BidEditorClient() {
  const {
    currentBid,
    selectedPastureId,
    addPasture,
    saveBid,
  } = useBidStore();

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

  return (
    <div className="h-screen flex flex-col">
      {/* Top bar */}
      <header className="h-14 bg-slate-900 text-white flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/bids" className="text-amber-500 font-bold text-lg hover:text-amber-400">
            CCC
          </Link>
          <span className="text-slate-500">|</span>
          <span className="font-medium">{currentBid.bidNumber}</span>
          <Badge
            variant="outline"
            className="text-xs border-slate-600 text-slate-300"
          >
            {currentBid.status}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="text-xs border-slate-600 text-slate-300 hover:bg-slate-800"
            onClick={saveBid}
          >
            Save
          </Button>
          <Button
            size="sm"
            className="text-xs bg-amber-600 hover:bg-amber-700"
            onClick={() => {
              saveBid();
              // PDF generation will be Phase 4
              alert('PDF generation coming in Phase 4');
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
              <TabsTrigger value="details" className="text-xs">Bid Details</TabsTrigger>
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
