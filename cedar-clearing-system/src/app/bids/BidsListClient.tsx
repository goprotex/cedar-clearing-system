'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useBidStore } from '@/lib/store';
import { formatCurrency } from '@/lib/rates';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import Link from 'next/link';

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
    <div className="min-h-screen bg-[#131313] text-[#e5e2e1] scan-line">
      {/* TopAppBar */}
      <header className="fixed top-0 w-full z-50 border-b-2 border-[#353534] bg-[#131313] flex justify-between items-center h-16 px-4 md:px-6">
        <div className="flex items-center gap-4 md:gap-6">
          <Link href="/" className="text-xl md:text-2xl font-bold text-[#FF6B00] tracking-widest uppercase">
            CEDAR_HACK
          </Link>
          <div className="hidden md:flex gap-8 text-xs font-bold">
            <span className="text-[#FFB693] border-b-2 border-[#FF6B00] cursor-pointer uppercase">ACTIVE_BIDS</span>
            <Link href="/bids" className="text-[#E5E2E1] hover:bg-[#FF6B00] hover:text-black transition-colors duration-75 cursor-pointer uppercase px-1">ESTIMATOR</Link>
            <span className="text-[#E5E2E1] opacity-50 uppercase cursor-not-allowed">FLEET_SYNC</span>
            <span className="text-[#E5E2E1] opacity-50 uppercase cursor-not-allowed">ARCHIVE</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-[10px] text-[#a98a7d] font-mono hidden md:inline">
            SYS_STATUS: OPERATIONAL
          </span>
        </div>
      </header>

      {/* Sidebar */}
      <aside className="fixed left-0 top-0 h-full w-64 border-r-2 border-[#353534] bg-[#131313] flex flex-col pt-20 pb-4 px-2 z-40 hidden md:flex">
        <div className="px-4 mb-8">
          <div className="text-lg font-black text-[#FF6B00]">SECTOR_OPS</div>
          <div className="text-[10px] text-[#e5e2e1] opacity-50 tracking-widest">ENTITY_REGISTRY</div>
        </div>

        <nav className="flex-1 space-y-1">
          <div className="flex items-center gap-3 p-3 bg-[#FF6B00] text-black font-black skew-x-1 cursor-pointer text-xs uppercase tracking-tight">
            <span>📋</span>
            <span>ACTIVE_BIDS</span>
          </div>
          <div className="flex items-center gap-3 p-3 text-[#E5E2E1] opacity-70 hover:opacity-100 hover:bg-[#353534] hover:text-[#13FF43] transition-all cursor-pointer text-xs font-bold uppercase tracking-tight">
            <span>🧮</span>
            <span>ESTIMATOR</span>
          </div>
          <div className="flex items-center gap-3 p-3 text-[#E5E2E1] opacity-70 hover:opacity-100 hover:bg-[#353534] hover:text-[#13FF43] transition-all cursor-pointer text-xs font-bold uppercase tracking-tight">
            <span>🛰️</span>
            <span>MAP_RADAR</span>
          </div>
          <div className="flex items-center gap-3 p-3 text-[#E5E2E1] opacity-70 hover:opacity-100 hover:bg-[#353534] hover:text-[#13FF43] transition-all cursor-pointer text-xs font-bold uppercase tracking-tight">
            <span>🔗</span>
            <span>FLEET_SYNC</span>
          </div>
          <div className="flex items-center gap-3 p-3 text-[#E5E2E1] opacity-70 hover:opacity-100 hover:bg-[#353534] hover:text-[#13FF43] transition-all cursor-pointer text-xs font-bold uppercase tracking-tight">
            <span>📦</span>
            <span>ARCHIVE</span>
          </div>
        </nav>

        <div className="mt-auto pt-4 border-t border-[#353534] px-2 space-y-2">
          <button
            onClick={handleNewBid}
            className="w-full bg-[#FF6B00] text-black font-black py-3 mb-4 text-xs uppercase tracking-widest hover:bg-white transition-colors"
          >
            NEW_ESTIMATE
          </button>
          <div className="flex items-center gap-3 p-2 text-[#E5E2E1] opacity-50 text-[10px] uppercase font-bold cursor-pointer">
            <span>⚙️</span>
            <span>SYS_HEALTH</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="md:ml-64 pt-20 p-6 min-h-screen">
        {/* Title Row */}
        <div className="flex justify-between items-end border-l-4 border-[#FF6B00] pl-4 mb-8">
          <div>
            <h1 className="text-4xl font-black uppercase tracking-tighter">ACTIVE_BIDS</h1>
            <p className="text-[#ffb693] text-xs font-mono">
              {savedBids.length} RECORDS // STATUS: MONITORING
            </p>
          </div>
          <Button
            onClick={handleNewBid}
            className="bg-[#FF6B00] text-black font-black text-xs uppercase tracking-widest hover:bg-white transition-all px-6 py-2 md:hidden"
          >
            + NEW_BID
          </Button>
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
            {/* Desktop table */}
            <div className="hidden md:block border-2 border-[#353534]">
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
                  <div className="col-span-1 text-right">
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
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
