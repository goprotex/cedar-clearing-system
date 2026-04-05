'use client';

import { useBidStore } from '@/lib/store';
import { formatCurrency } from '@/lib/rates';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function BidSummary() {
  const { currentBid, rateCard } = useBidStore();

  const pastureSubtotal = currentBid.pastures.reduce((s, p) => s + p.subtotal, 0);
  const customTotal = currentBid.customLineItems.reduce((s, li) => s + li.amount, 0);
  const beforeAdjustments =
    pastureSubtotal + currentBid.mobilizationFee + currentBid.burnPermitFee + customTotal;
  const contingency = beforeAdjustments * (currentBid.contingencyPct / 100);
  const discount = beforeAdjustments * (currentBid.discountPct / 100);

  return (
    <Card className="bg-slate-900 text-white">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Bid Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {/* Per-pasture breakdown */}
        {currentBid.pastures.map((p) => (
          <div key={p.id} className="flex justify-between">
            <span className="text-slate-300 truncate mr-2">
              {p.name} ({p.acreage} ac)
            </span>
            <span className="font-mono">{formatCurrency(p.subtotal)}</span>
          </div>
        ))}

        {currentBid.pastures.length > 0 && (
          <div className="border-t border-slate-700 pt-2 flex justify-between font-medium">
            <span>Pasture Subtotal</span>
            <span className="font-mono">{formatCurrency(pastureSubtotal)}</span>
          </div>
        )}

        {/* Fees */}
        {currentBid.mobilizationFee > 0 && (
          <div className="flex justify-between text-slate-300">
            <span>Mobilization</span>
            <span className="font-mono">{formatCurrency(currentBid.mobilizationFee)}</span>
          </div>
        )}
        {currentBid.burnPermitFee > 0 && (
          <div className="flex justify-between text-slate-300">
            <span>Burn Permit</span>
            <span className="font-mono">{formatCurrency(currentBid.burnPermitFee)}</span>
          </div>
        )}
        {currentBid.customLineItems.map((li) => (
          <div key={li.id} className="flex justify-between text-slate-300">
            <span className="truncate mr-2">{li.description || 'Custom Item'}</span>
            <span className="font-mono">{formatCurrency(li.amount)}</span>
          </div>
        ))}

        {/* Adjustments */}
        {currentBid.contingencyPct > 0 && (
          <div className="flex justify-between text-slate-300">
            <span>Contingency ({currentBid.contingencyPct}%)</span>
            <span className="font-mono">+{formatCurrency(contingency)}</span>
          </div>
        )}
        {currentBid.discountPct > 0 && (
          <div className="flex justify-between text-emerald-400">
            <span>Discount ({currentBid.discountPct}%)</span>
            <span className="font-mono">-{formatCurrency(discount)}</span>
          </div>
        )}

        {/* Total */}
        <div className="border-t border-slate-600 pt-3 flex justify-between text-xl font-bold">
          <span>Total</span>
          <span className="font-mono text-emerald-400">{formatCurrency(currentBid.totalAmount)}</span>
        </div>

        {/* Duration */}
        {currentBid.totalAcreage > 0 && (
          <div className="text-center text-slate-400 text-xs pt-1">
            {currentBid.totalAcreage} acres | Est. {currentBid.estimatedDaysLow}–{currentBid.estimatedDaysHigh} days
          </div>
        )}

        {currentBid.totalAmount > 0 && currentBid.totalAmount < rateCard.minimumBid && (
          <div className="text-center text-amber-400 text-xs">
            Minimum bid of {formatCurrency(rateCard.minimumBid)} applied
          </div>
        )}
      </CardContent>
    </Card>
  );
}
