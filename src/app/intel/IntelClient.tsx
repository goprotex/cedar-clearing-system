'use client';

import { useEffect, useMemo } from 'react';
import AppShell from '@/components/AppShell';
import { useBidStore } from '@/lib/store';
import type { BidSummary, BidStatus } from '@/types';

interface IntelMetrics {
  totalBids: number;
  totalRevenue: number;
  totalAcres: number;
  avgBidSize: number;
  avgPerAcre: number;
  statusBreakdown: Record<BidStatus, number>;
  monthlyData: { month: string; count: number; revenue: number }[];
  topClients: { name: string; bids: number; revenue: number }[];
}

function computeMetrics(bids: BidSummary[]): IntelMetrics {
  const totalBids = bids.length;
  const totalRevenue = bids.reduce((s, b) => s + b.totalAmount, 0);
  const totalAcres = bids.reduce((s, b) => s + b.totalAcreage, 0);
  const avgBidSize = totalBids > 0 ? totalRevenue / totalBids : 0;
  const avgPerAcre = totalAcres > 0 ? totalRevenue / totalAcres : 0;

  const statusBreakdown = { draft: 0, sent: 0, accepted: 0, declined: 0, expired: 0 } as Record<BidStatus, number>;
  bids.forEach((b) => { statusBreakdown[b.status] = (statusBreakdown[b.status] || 0) + 1; });

  const monthMap = new Map<string, { count: number; revenue: number }>();
  bids.forEach((b) => {
    const d = new Date(b.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const existing = monthMap.get(key) || { count: 0, revenue: 0 };
    monthMap.set(key, { count: existing.count + 1, revenue: existing.revenue + b.totalAmount });
  });
  const monthlyData = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([month, data]) => ({ month, ...data }));

  const clientMap = new Map<string, { bids: number; revenue: number }>();
  bids.forEach((b) => {
    const name = b.clientName || 'Unknown';
    const existing = clientMap.get(name) || { bids: 0, revenue: 0 };
    clientMap.set(name, { bids: existing.bids + 1, revenue: existing.revenue + b.totalAmount });
  });
  const topClients = Array.from(clientMap.entries())
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  return { totalBids, totalRevenue, totalAcres, avgBidSize, avgPerAcre, statusBreakdown, monthlyData, topClients };
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

const STATUS_COLORS: Record<BidStatus, string> = {
  draft: '#a98a7d',
  sent: '#3b82f6',
  accepted: '#13ff43',
  declined: '#ff4444',
  expired: '#f59e0b',
};

export default function IntelClient() {
  const { savedBids, loadBidList } = useBidStore();

  useEffect(() => {
    loadBidList();
  }, [loadBidList]);

  const bids = savedBids;
  const metrics = useMemo(() => computeMetrics(bids), [bids]);

  const maxRevenue = Math.max(...metrics.monthlyData.map((d) => d.revenue), 1);

  return (
    <AppShell>
      <div className="flex justify-between items-end border-l-4 border-[#FF6B00] pl-4 mb-8">
        <div>
          <h1 className="text-4xl font-black uppercase tracking-tighter">INTEL_DASHBOARD</h1>
          <p className="text-[#ffb693] text-xs font-mono">
            AGGREGATED ANALYTICS // {metrics.totalBids} BIDS ANALYZED
          </p>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <div className="border-2 border-[#353534] p-4">
          <div className="text-[10px] text-[#a98a7d] font-bold uppercase tracking-widest mb-1">TOTAL_BIDS</div>
          <div className="text-3xl font-black text-[#FF6B00]">{metrics.totalBids}</div>
        </div>
        <div className="border-2 border-[#353534] p-4">
          <div className="text-[10px] text-[#a98a7d] font-bold uppercase tracking-widest mb-1">TOTAL_REVENUE</div>
          <div className="text-3xl font-black text-[#13ff43]">{formatCurrency(metrics.totalRevenue)}</div>
        </div>
        <div className="border-2 border-[#353534] p-4">
          <div className="text-[10px] text-[#a98a7d] font-bold uppercase tracking-widest mb-1">TOTAL_ACRES</div>
          <div className="text-3xl font-black text-[#ffb693]">{metrics.totalAcres.toFixed(1)}</div>
        </div>
        <div className="border-2 border-[#353534] p-4">
          <div className="text-[10px] text-[#a98a7d] font-bold uppercase tracking-widest mb-1">AVG_BID</div>
          <div className="text-3xl font-black">{formatCurrency(metrics.avgBidSize)}</div>
        </div>
        <div className="border-2 border-[#353534] p-4">
          <div className="text-[10px] text-[#a98a7d] font-bold uppercase tracking-widest mb-1">AVG_PER_ACRE</div>
          <div className="text-3xl font-black">{formatCurrency(metrics.avgPerAcre)}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Status breakdown */}
        <div className="border-2 border-[#353534] p-4">
          <div className="text-xs font-black uppercase tracking-widest text-[#a98a7d] mb-4">STATUS_DISTRIBUTION</div>
          <div className="space-y-3">
            {(Object.entries(metrics.statusBreakdown) as [BidStatus, number][]).map(([status, count]) => {
              const pct = metrics.totalBids > 0 ? (count / metrics.totalBids) * 100 : 0;
              return (
                <div key={status}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="uppercase font-bold" style={{ color: STATUS_COLORS[status] }}>{status}</span>
                    <span className="font-mono text-[#a98a7d]">{count} ({pct.toFixed(0)}%)</span>
                  </div>
                  <div className="h-2 bg-[#353534]">
                    <div
                      className="h-full transition-all"
                      style={{ width: `${pct}%`, backgroundColor: STATUS_COLORS[status] }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Monthly chart */}
        <div className="border-2 border-[#353534] p-4">
          <div className="text-xs font-black uppercase tracking-widest text-[#a98a7d] mb-4">MONTHLY_REVENUE</div>
          {metrics.monthlyData.length === 0 ? (
            <div className="text-center py-8 text-[#5a4136] text-xs">NO_DATA</div>
          ) : (
            <div className="flex items-end gap-2 h-40">
              {metrics.monthlyData.map((d) => {
                const height = (d.revenue / maxRevenue) * 100;
                return (
                  <div key={d.month} className="flex-1 flex flex-col items-center gap-1">
                    <div className="text-[9px] font-mono text-[#a98a7d]">{formatCurrency(d.revenue)}</div>
                    <div className="w-full bg-[#353534] relative" style={{ height: '100px' }}>
                      <div
                        className="absolute bottom-0 left-0 right-0 bg-[#FF6B00] transition-all"
                        style={{ height: `${height}%` }}
                      />
                    </div>
                    <div className="text-[9px] font-mono text-[#5a4136]">{d.month}</div>
                    <div className="text-[9px] font-mono text-[#a98a7d]">{d.count} bids</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Top clients */}
        <div className="border-2 border-[#353534] p-4">
          <div className="text-xs font-black uppercase tracking-widest text-[#a98a7d] mb-4">TOP_CLIENTS</div>
          {metrics.topClients.length === 0 ? (
            <div className="text-center py-8 text-[#5a4136] text-xs">NO_CLIENT_DATA</div>
          ) : (
            <div className="space-y-3">
              {metrics.topClients.map((c, i) => (
                <div key={c.name} className="flex items-center justify-between border-b border-[#353534] pb-2">
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-[#5a4136] font-mono w-4">{i + 1}.</span>
                    <div>
                      <div className="text-sm font-bold truncate max-w-[140px]">{c.name}</div>
                      <div className="text-[10px] text-[#5a4136] font-mono">{c.bids} bids</div>
                    </div>
                  </div>
                  <span className="font-mono font-bold text-[#13ff43] text-sm">{formatCurrency(c.revenue)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Win rate and performance */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="border-2 border-[#353534] p-4">
          <div className="text-xs font-black uppercase tracking-widest text-[#a98a7d] mb-4">WIN_RATE_ANALYSIS</div>
          {(() => {
            const decided = metrics.statusBreakdown.accepted + metrics.statusBreakdown.declined;
            const winRate = decided > 0 ? (metrics.statusBreakdown.accepted / decided) * 100 : 0;
            return (
              <div className="text-center py-6">
                <div className="text-6xl font-black" style={{ color: winRate > 50 ? '#13ff43' : winRate > 25 ? '#FF6B00' : '#ff4444' }}>
                  {winRate.toFixed(0)}%
                </div>
                <div className="text-xs text-[#a98a7d] font-mono mt-2">
                  {metrics.statusBreakdown.accepted} WON / {decided} DECIDED
                </div>
                <div className="text-[10px] text-[#5a4136] mt-1">
                  {metrics.statusBreakdown.draft} draft, {metrics.statusBreakdown.sent} pending, {metrics.statusBreakdown.expired} expired
                </div>
              </div>
            );
          })()}
        </div>

        <div className="border-2 border-[#353534] p-4">
          <div className="text-xs font-black uppercase tracking-widest text-[#a98a7d] mb-4">REVENUE_BREAKDOWN</div>
          <div className="space-y-4 py-4">
            {(Object.entries(metrics.statusBreakdown) as [BidStatus, number][])
              .filter(([, count]) => count > 0)
              .map(([status]) => {
                const statusBids = JSON.parse(localStorage.getItem('ccc_bid_list') || '[]')
                  .filter((b: BidSummary) => b.status === status);
                const statusRevenue = statusBids.reduce((s: number, b: BidSummary) => s + b.totalAmount, 0);
                const pct = metrics.totalRevenue > 0 ? (statusRevenue / metrics.totalRevenue) * 100 : 0;
                return (
                  <div key={status} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3" style={{ backgroundColor: STATUS_COLORS[status] }} />
                      <span className="uppercase text-xs font-bold">{status}</span>
                    </div>
                    <div className="text-right">
                      <span className="font-mono text-sm font-bold">{formatCurrency(statusRevenue)}</span>
                      <span className="text-[10px] text-[#5a4136] ml-2">({pct.toFixed(0)}%)</span>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
