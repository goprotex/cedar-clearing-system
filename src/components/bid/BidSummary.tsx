'use client';

import { useBidStore } from '@/lib/store';
import { formatCurrency } from '@/lib/rates';

export default function BidSummary() {
  const { currentBid, rateCard, analysisProgress } = useBidStore();

  const pastureSubtotal = currentBid.pastures.reduce((s, p) => s + p.subtotal, 0);
  const customTotal = currentBid.customLineItems.reduce((s, li) => s + li.amount, 0);
  const beforeAdjustments =
    pastureSubtotal + currentBid.mobilizationFee + currentBid.burnPermitFee + customTotal;
  const contingency = beforeAdjustments * (currentBid.contingencyPct / 100);
  const discount = beforeAdjustments * (currentBid.discountPct / 100);

  return (
    <div className="bg-[#2a2a2a] border-2 border-[#13ff43]/30 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#353534] pb-2">
        <span className="text-[10px] text-[#13ff43] font-black uppercase tracking-widest">FINANCIAL_SUMMARY</span>
        <span className="text-[10px] text-[#5a4136] font-mono">BID_{currentBid.bidNumber}</span>
      </div>

      {/* Per-pasture breakdown */}
      <div className="space-y-1.5 text-sm">
        {currentBid.pastures.map((p) => (
          <div key={p.id} className="flex justify-between">
            <span className="text-[#a98a7d] truncate mr-2 text-xs uppercase">
              {p.name} ({p.acreage} ac)
            </span>
            <span className="font-mono text-[#e5e2e1] text-xs">{formatCurrency(p.subtotal)}</span>
          </div>
        ))}

        {currentBid.pastures.length > 0 && (
          <div className="border-t border-[#353534] pt-2 flex justify-between font-bold text-xs uppercase">
            <span className="text-[#a98a7d]">Pasture Subtotal</span>
            <span className="font-mono text-[#e5e2e1]">{formatCurrency(pastureSubtotal)}</span>
          </div>
        )}

        {/* Fees */}
        {currentBid.mobilizationFee > 0 && (
          <div className="flex justify-between text-xs">
            <span className="text-[#a98a7d] uppercase">Mobilization</span>
            <span className="font-mono text-[#e5e2e1]">{formatCurrency(currentBid.mobilizationFee)}</span>
          </div>
        )}
        {currentBid.burnPermitFee > 0 && (
          <div className="flex justify-between text-xs">
            <span className="text-[#a98a7d] uppercase">Burn Permit</span>
            <span className="font-mono text-[#e5e2e1]">{formatCurrency(currentBid.burnPermitFee)}</span>
          </div>
        )}
        {currentBid.customLineItems.map((li) => (
          <div key={li.id} className="flex justify-between text-xs">
            <span className="text-[#a98a7d] truncate mr-2 uppercase">{li.description || 'Custom Item'}</span>
            <span className="font-mono text-[#e5e2e1]">{formatCurrency(li.amount)}</span>
          </div>
        ))}

        {/* Adjustments */}
        {currentBid.contingencyPct > 0 && (
          <div className="flex justify-between text-xs">
            <span className="text-[#a98a7d] uppercase">Contingency ({currentBid.contingencyPct}%)</span>
            <span className="font-mono text-[#ffb693]">+{formatCurrency(contingency)}</span>
          </div>
        )}
        {currentBid.discountPct > 0 && (
          <div className="flex justify-between text-xs">
            <span className="text-[#13ff43] uppercase">Discount ({currentBid.discountPct}%)</span>
            <span className="font-mono text-[#13ff43]">-{formatCurrency(discount)}</span>
          </div>
        )}
      </div>

      {/* Total */}
      <div className="border-t-2 border-[#353534] pt-3">
        <div className="text-[10px] text-[#ffb693] uppercase font-bold mb-1">TOTAL_ESTIMATE</div>
        <div className="text-4xl font-black text-[#FF6B00] tracking-tighter glow-orange">
          {formatCurrency(currentBid.totalAmount)}
        </div>
        {analysisProgress?.active && analysisProgress.estimatedCedarAcres != null && (
          <div className="text-[10px] text-[#13ff43] uppercase font-bold mt-1">
            Live pricing preview · cedar acres {analysisProgress.estimatedCedarAcres.toFixed(1)}
          </div>
        )}
      </div>

      {/* Duration */}
      {currentBid.totalAcreage > 0 && (
        <div className="flex items-center justify-between text-[10px] text-[#5a4136] font-mono uppercase pt-1">
          <span>{currentBid.totalAcreage} ACRES</span>
          <span>EST. {currentBid.estimatedDaysLow}–{currentBid.estimatedDaysHigh} DAYS</span>
        </div>
      )}

      {currentBid.totalAmount > 0 && currentBid.totalAmount < rateCard.minimumBid && (
        <div className="text-center text-[10px] text-[#FF6B00] font-bold uppercase">
          ⚠ MINIMUM_BID {formatCurrency(rateCard.minimumBid)} APPLIED
        </div>
      )}
    </div>
  );
}
