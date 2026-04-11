'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useBidStore } from '@/lib/store';
import { formatCurrency } from '@/lib/rates';
import { Button } from '@/components/ui/button';
import AppShell from '@/components/AppShell';
import { toast } from 'sonner';

const STATUS_COLORS: Record<string, string> = {
  draft: 'border-[#a98a7d] text-[#a98a7d]',
  sent: 'border-blue-500 text-blue-400',
  accepted: 'border-[#13ff43] text-[#13ff43]',
  declined: 'border-red-500 text-red-400',
  expired: 'border-amber-500 text-amber-400',
};

export default function BidsListClient() {
  const router = useRouter();
  const { savedBids, loadBidList, newBid, loadBid, deleteBid } = useBidStore();

  useEffect(() => {
    loadBidList();
  }, [loadBidList]);

  const handleNewBid = () => {
    newBid();
    router.push(`/bid/${useBidStore.getState().currentBid.id}`);
  };

  const handleOpenBid = (id: string) => {
    loadBid(id);
    router.push(`/bid/${id}`);
  };

  return (
    <AppShell>
      {/* Title Row — anchor for /bids#new-bid + sidebar link; scroll-mt clears fixed header */}
      <div
        id="new-bid"
        className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-end border-l-4 border-[#FF6B00] pl-3 sm:pl-4 mb-8 min-w-0 scroll-mt-[calc(5.5rem+env(safe-area-inset-top,0px))]"
      >
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-4xl font-black uppercase tracking-tighter">ACTIVE_BIDS</h1>
          <p className="text-[#ffb693] text-[10px] sm:text-xs font-mono">
            {savedBids.length} RECORDS // STATUS: MONITORING
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            onClick={handleNewBid}
            className="bg-[#FF6B00] text-black font-black text-xs uppercase tracking-widest hover:bg-white transition-all px-4 sm:px-6 py-2 w-full sm:w-auto"
          >
            + NEW_BID
          </Button>
        </div>
      </div>

      {savedBids.length === 0 ? (
        <div className="border-2 border-[#353534] p-16 text-center">
          <p className="text-4xl mb-3">🌲</p>
          <p className="text-lg font-black uppercase tracking-tight">NO_RECORDS_FOUND</p>
          <p className="text-sm mt-1 text-[#a98a7d]">Initialize your first estimate to populate this registry</p>
          <button
            onClick={handleNewBid}
            className="mt-6 bg-[#FF6B00] text-black font-black px-8 py-3 text-sm uppercase tracking-widest hover:bg-white transition-all"
          >
            CREATE_FIRST_BID
          </button>
        </div>
      ) : (
        <>
          {/* Desktop table — horizontal scroll so wide grids stay reachable (root uses overflow-x-hidden) */}
          <div className="hidden md:block w-full min-w-0 overflow-x-auto overscroll-x-contain touch-pan-x">
          <div className="min-w-[720px] border-2 border-[#353534]">
            {/* Table Header */}
            <div className="grid grid-cols-12 gap-4 px-4 py-2 bg-[#2a2a2a] border-b border-[#353534] text-[10px] text-[#a98a7d] font-bold uppercase tracking-widest">
              <div className="col-span-2">BID_ID</div>
              <div className="col-span-1">STATUS</div>
              <div className="col-span-3">CLIENT</div>
              <div className="col-span-2 text-right">AMOUNT</div>
              <div className="col-span-1 text-right">ACRES</div>
              <div className="col-span-2 text-right">UPDATED</div>
              <div className="col-span-1 text-right">ACTIONS</div>
            </div>

            {savedBids.map((bid) => (
              <div
                key={bid.id}
                className="grid grid-cols-12 gap-4 px-4 py-3 border-b border-[#353534] hover:bg-[#2a2a2a] transition-colors cursor-pointer group"
                onClick={() => handleOpenBid(bid.id)}
              >
                <div className="col-span-2 font-mono font-bold text-sm text-[#ffb693]">
                  {bid.bidNumber}
                </div>
                <div className="col-span-1">
                  <span className={`border px-2 py-0.5 text-[10px] font-black uppercase ${STATUS_COLORS[bid.status] || 'border-[#353534] text-[#a98a7d]'}`}>
                    {bid.status}
                  </span>
                </div>
                <div className="col-span-3 text-sm truncate">
                  <span className="text-[#e5e2e1]">{bid.clientName || 'NO_CLIENT'}</span>
                  <span className="text-[#5a4136] mx-1">—</span>
                  <span className="text-[#a98a7d]">{bid.propertyName || 'NO_PROPERTY'}</span>
                </div>
                <div className="col-span-2 text-right font-mono font-black text-[#13ff43]">
                  {formatCurrency(bid.totalAmount)}
                </div>
                <div className="col-span-1 text-right font-mono text-sm">
                  {bid.totalAcreage} <span className="text-[10px] text-[#5a4136]">AC</span>
                </div>
                <div className="col-span-2 text-right text-xs text-[#a98a7d] font-mono">
                  {new Date(bid.updatedAt).toLocaleDateString()}
                </div>
                <div className="col-span-1 text-right flex items-center justify-end gap-2">
                  <Link
                    href={`/operate/${bid.id}`}
                    className="text-[10px] text-[#13ff43] hover:text-white font-bold uppercase opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => e.stopPropagation()}
                    title="Launch operator mode"
                  >
                    🚜
                  </Link>
                  <button
                    className="text-[10px] text-[#5a4136] hover:text-red-500 font-bold uppercase opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm('Delete this bid?')) {
                        deleteBid(bid.id);
                        toast.success('Bid deleted');
                      }
                    }}
                  >
                    DELETE
                  </button>
                </div>
              </div>
            ))}
          </div>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {savedBids.map((bid) => (
              <div
                key={bid.id}
                className="border border-[#353534] bg-[#1c1b1b] p-4 active:bg-[#2a2a2a] transition-colors cursor-pointer"
                onClick={() => handleOpenBid(bid.id)}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono font-bold text-sm text-[#ffb693]">{bid.bidNumber}</span>
                  <span className={`border px-2 py-0.5 text-[10px] font-black uppercase ${STATUS_COLORS[bid.status] || 'border-[#353534] text-[#a98a7d]'}`}>
                    {bid.status}
                  </span>
                </div>
                <div className="text-sm truncate mb-3">
                  <span className="text-[#e5e2e1]">{bid.clientName || 'NO_CLIENT'}</span>
                  <span className="text-[#5a4136] mx-1">—</span>
                  <span className="text-[#a98a7d]">{bid.propertyName || 'NO_PROPERTY'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-mono font-black text-[#13ff43]">{formatCurrency(bid.totalAmount)}</span>
                  <span className="font-mono text-sm">{bid.totalAcreage} <span className="text-[10px] text-[#5a4136]">AC</span></span>
                </div>
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-[#353534]">
                  <span className="text-[10px] text-[#a98a7d] font-mono">{new Date(bid.updatedAt).toLocaleDateString()}</span>
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/operate/${bid.id}`}
                      className="text-[10px] text-[#13ff43] font-bold uppercase"
                      onClick={(e) => e.stopPropagation()}
                    >
                      🚜 OPERATE
                    </Link>
                    <button
                      className="text-[10px] text-[#5a4136] hover:text-red-500 font-bold uppercase"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm('Delete this bid?')) {
                          deleteBid(bid.id);
                          toast.success('Bid deleted');
                        }
                      }}
                    >
                      DELETE
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </AppShell>
  );
}
