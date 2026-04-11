'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { useBidStore } from '@/lib/store';
import { formatCurrency } from '@/lib/rates';
import { toast } from 'sonner';
import type { BidStatus } from '@/types';

const STATUS_COLORS: Record<string, string> = {
  draft: 'border-[#a98a7d] text-[#a98a7d]',
  sent: 'border-blue-500 text-blue-400',
  accepted: 'border-[#13ff43] text-[#13ff43]',
  declined: 'border-red-500 text-red-400',
  expired: 'border-amber-500 text-amber-400',
};

const ARCHIVE_STATUSES: BidStatus[] = ['accepted', 'declined', 'expired'];

type SortField = 'updatedAt' | 'totalAmount' | 'totalAcreage' | 'clientName';

export default function ArchiveClient() {
  const router = useRouter();
  const { savedBids, loadBidList, loadBid, deleteBid } = useBidStore();
  const [statusFilter, setStatusFilter] = useState<BidStatus | 'all'>('all');
  const [sortField, setSortField] = useState<SortField>('updatedAt');
  const [sortAsc, setSortAsc] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadBidList();
  }, [loadBidList]);

  const archived = savedBids.filter((b) => ARCHIVE_STATUSES.includes(b.status));

  const filtered = archived
    .filter((b) => statusFilter === 'all' || b.status === statusFilter)
    .filter((b) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        b.bidNumber.toLowerCase().includes(q) ||
        b.clientName.toLowerCase().includes(q) ||
        b.propertyName.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'updatedAt':
          cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
          break;
        case 'totalAmount':
          cmp = a.totalAmount - b.totalAmount;
          break;
        case 'totalAcreage':
          cmp = a.totalAcreage - b.totalAcreage;
          break;
        case 'clientName':
          cmp = (a.clientName || '').localeCompare(b.clientName || '');
          break;
      }
      return sortAsc ? cmp : -cmp;
    });

  const handleOpenBid = (id: string) => {
    loadBid(id);
    router.push(`/bid/${id}`);
  };

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  }

  const counts = {
    all: archived.length,
    accepted: archived.filter((b) => b.status === 'accepted').length,
    declined: archived.filter((b) => b.status === 'declined').length,
    expired: archived.filter((b) => b.status === 'expired').length,
  };

  const totalArchivedRevenue = archived
    .filter((b) => b.status === 'accepted')
    .reduce((s, b) => s + b.totalAmount, 0);

  return (
    <AppShell>
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-end border-l-4 border-[#FF6B00] pl-3 sm:pl-4 mb-8 min-w-0">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-4xl font-black uppercase tracking-tighter">ARCHIVE</h1>
          <p className="text-[#ffb693] text-xs font-mono">
            {archived.length} CLOSED RECORDS // {formatCurrency(totalArchivedRevenue)} BOOKED
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="border-2 border-[#353534] p-4">
          <div className="text-[10px] text-[#a98a7d] font-bold uppercase tracking-widest mb-1">ARCHIVED</div>
          <div className="text-3xl font-black">{counts.all}</div>
        </div>
        <div className="border-2 border-[#13ff43]/30 p-4">
          <div className="text-[10px] text-[#13ff43] font-bold uppercase tracking-widest mb-1">ACCEPTED</div>
          <div className="text-3xl font-black text-[#13ff43]">{counts.accepted}</div>
        </div>
        <div className="border-2 border-red-500/30 p-4">
          <div className="text-[10px] text-red-400 font-bold uppercase tracking-widest mb-1">DECLINED</div>
          <div className="text-3xl font-black text-red-400">{counts.declined}</div>
        </div>
        <div className="border-2 border-amber-500/30 p-4">
          <div className="text-[10px] text-amber-400 font-bold uppercase tracking-widest mb-1">EXPIRED</div>
          <div className="text-3xl font-black text-amber-400">{counts.expired}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 mb-6 items-center">
        <div className="flex gap-2">
          {(['all', ...ARCHIVE_STATUSES] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider border transition-all ${
                statusFilter === s
                  ? 'bg-[#FF6B00] text-black border-[#FF6B00]'
                  : 'border-[#353534] text-[#a98a7d] hover:border-[#FF6B00] hover:text-[#FF6B00]'
              }`}
            >
              {s} ({counts[s as keyof typeof counts] ?? 0})
            </button>
          ))}
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search bids..."
          className="bg-transparent border border-[#353534] px-3 py-1.5 text-xs font-mono text-[#e5e2e1] placeholder:text-[#5a4136] focus:border-[#FF6B00] outline-none w-full min-w-0 sm:w-48"
        />
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="border-2 border-[#353534] p-16 text-center">
          <p className="text-4xl mb-3">📦</p>
          <p className="text-lg font-black uppercase tracking-tight">NO_ARCHIVED_RECORDS</p>
          <p className="text-sm mt-1 text-[#a98a7d]">
            Bids with accepted, declined, or expired status appear here
          </p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block border-2 border-[#353534]">
            <div className="grid grid-cols-12 gap-4 px-4 py-2 bg-[#2a2a2a] border-b border-[#353534] text-[10px] text-[#a98a7d] font-bold uppercase tracking-widest">
              <div className="col-span-2">BID_ID</div>
              <div className="col-span-1">STATUS</div>
              <div className="col-span-3 cursor-pointer hover:text-[#FF6B00]" onClick={() => handleSort('clientName')}>
                CLIENT {sortField === 'clientName' ? (sortAsc ? '▲' : '▼') : ''}
              </div>
              <div className="col-span-2 text-right cursor-pointer hover:text-[#FF6B00]" onClick={() => handleSort('totalAmount')}>
                AMOUNT {sortField === 'totalAmount' ? (sortAsc ? '▲' : '▼') : ''}
              </div>
              <div className="col-span-1 text-right cursor-pointer hover:text-[#FF6B00]" onClick={() => handleSort('totalAcreage')}>
                ACRES {sortField === 'totalAcreage' ? (sortAsc ? '▲' : '▼') : ''}
              </div>
              <div className="col-span-2 text-right cursor-pointer hover:text-[#FF6B00]" onClick={() => handleSort('updatedAt')}>
                CLOSED {sortField === 'updatedAt' ? (sortAsc ? '▲' : '▼') : ''}
              </div>
              <div className="col-span-1 text-right">ACTIONS</div>
            </div>

            {filtered.map((bid) => (
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
                      if (confirm('Permanently delete this archived bid?')) {
                        deleteBid(bid.id);
                        toast.success('Bid deleted from archive');
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
            {filtered.map((bid) => (
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
              </div>
            ))}
          </div>
        </>
      )}
    </AppShell>
  );
}
