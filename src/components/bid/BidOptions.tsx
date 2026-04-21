'use client';

import { useMemo } from 'react';
import { useBidStore } from '@/lib/store';
import { generateBidOptions } from '@/lib/options';
import { formatCurrency, getMethodConfig } from '@/lib/rates';
import { Badge } from '@/components/ui/badge';

export default function BidOptions() {
  const { currentBid, rateCard } = useBidStore();

  const options = useMemo(
    () => generateBidOptions(currentBid, rateCard),
    [currentBid, rateCard]
  );

  if (currentBid.pastures.length === 0 || currentBid.totalAcreage === 0) {
    return (
      <div className="text-center py-12 text-[#a98a7d] text-sm">
        <p className="text-2xl mb-2 opacity-40">◇</p>
        <p className="font-bold uppercase tracking-widest text-xs">NO_DATA_AVAILABLE</p>
        <p className="text-[10px] mt-1 uppercase tracking-widest">Add pastures with boundaries to generate options</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[10px] text-[#a98a7d] uppercase tracking-widest">
        Compare pricing across clearing methods. Cedar-focused mulching options use cedar-effective acres when spectral analysis is available.
      </p>

      {options.map((option) => {
        const methodConfig = getMethodConfig(option.clearingMethod, rateCard);
        return (
          <div
            key={option.id}
            className={`bg-[#1c1b1b] border transition-all p-4 ${
              option.recommended ? 'border-[#13ff43] shadow-[0_0_12px_rgba(19,255,67,0.15)]' : 'border-[#353534]'
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-black uppercase tracking-wide text-[#e5e2e1]">
                {option.label}
              </span>
              <div className="flex items-center gap-2">
                {option.recommended && (
                  <Badge className="bg-[#13ff43]/20 text-[#13ff43] border border-[#13ff43]/40 text-[10px] uppercase tracking-widest rounded-none">
                    RECOMMENDED
                  </Badge>
                )}
                <span className="font-mono font-bold text-lg text-[#13ff43]">
                  {formatCurrency(option.totalAmount)}
                </span>
              </div>
            </div>

            {/* Key metrics */}
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="bg-[#201f1f] border border-[#353534] p-2 text-center">
                <div className="font-mono font-bold text-[#e5e2e1]">{formatCurrency(option.perAcreCost)}</div>
                <div className="text-[10px] text-[#a98a7d] uppercase tracking-widest">per billed acre</div>
              </div>
              <div className="bg-[#201f1f] border border-[#353534] p-2 text-center">
                <div className="font-mono font-bold text-[#e5e2e1]">{currentBid.totalAcreage} ac</div>
                <div className="text-[10px] text-[#a98a7d] uppercase tracking-widest">total</div>
              </div>
              <div className="bg-[#201f1f] border border-[#353534] p-2 text-center">
                <div className="font-mono font-bold text-[#e5e2e1]">
                  {option.estimatedDaysLow}–{option.estimatedDaysHigh}
                </div>
                <div className="text-[10px] text-[#a98a7d] uppercase tracking-widest">days</div>
              </div>
            </div>

            {/* Method info */}
            {methodConfig && (
              <div className="text-xs text-[#a98a7d] mt-2">
                <span className="font-bold text-[#ffb693]">Equipment:</span> {methodConfig.equipment}
                {' · '}
                <span className="font-bold text-[#ffb693]">Result:</span> {methodConfig.result}
              </div>
            )}

            {/* Per-pasture breakdown */}
            {option.pastureBreakdown.length > 1 && (
              <div className="text-xs space-y-0.5 pt-2 mt-2 border-t border-[#353534]">
                {option.pastureBreakdown.map((pb) => (
                  <div key={pb.pastureId} className="flex justify-between text-[#a98a7d]">
                    <span>{pb.pastureName} ({pb.acreage} ac)</span>
                    <span className="font-mono text-[#e5e2e1]">{formatCurrency(pb.subtotal)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Current bid comparison */}
      <div className="bg-[#2a2a2a] border-2 border-dashed border-[#FF6B00]/40 p-3">
        <div className="flex items-center justify-between text-sm">
          <div>
            <span className="font-black uppercase text-[#e5e2e1]">Current Bid</span>
            <span className="text-[10px] text-[#a98a7d] uppercase tracking-widest ml-2">(per-pasture methods)</span>
          </div>
          <span className="font-mono font-bold text-[#FF6B00] text-lg">
            {formatCurrency(currentBid.totalAmount)}
          </span>
        </div>
      </div>
    </div>
  );
}
