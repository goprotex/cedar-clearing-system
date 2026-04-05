'use client';

import { useMemo } from 'react';
import { useBidStore } from '@/lib/store';
import { generateBidOptions } from '@/lib/options';
import { formatCurrency, getMethodConfig } from '@/lib/rates';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function BidOptions() {
  const { currentBid, rateCard } = useBidStore();

  const options = useMemo(
    () => generateBidOptions(currentBid, rateCard),
    [currentBid, rateCard]
  );

  if (currentBid.pastures.length === 0 || currentBid.totalAcreage === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        <p className="text-2xl mb-2">📊</p>
        <p>Add pastures with boundaries to see options</p>
        <p className="text-xs mt-1">Options compare different clearing methods across all pastures</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Compare pricing across clearing methods. These options apply a single method to all pastures
        for easy comparison. Your current bid uses per-pasture method selections.
      </p>

      {options.map((option) => {
        const methodConfig = getMethodConfig(option.clearingMethod, rateCard);
        return (
          <Card
            key={option.id}
            className={`transition-all ${
              option.recommended ? 'ring-2 ring-emerald-500 shadow-md' : ''
            }`}
          >
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">
                  {option.label}
                </CardTitle>
                <div className="flex items-center gap-2">
                  {option.recommended && (
                    <Badge className="bg-emerald-600 text-[10px]">RECOMMENDED</Badge>
                  )}
                  <span className="font-mono font-bold text-lg text-emerald-600">
                    {formatCurrency(option.totalAmount)}
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {/* Key metrics */}
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="bg-muted/50 rounded p-2 text-center">
                  <div className="font-mono font-semibold">{formatCurrency(option.perAcreCost)}</div>
                  <div className="text-muted-foreground">per acre</div>
                </div>
                <div className="bg-muted/50 rounded p-2 text-center">
                  <div className="font-mono font-semibold">{currentBid.totalAcreage} ac</div>
                  <div className="text-muted-foreground">total</div>
                </div>
                <div className="bg-muted/50 rounded p-2 text-center">
                  <div className="font-mono font-semibold">
                    {option.estimatedDaysLow}–{option.estimatedDaysHigh}
                  </div>
                  <div className="text-muted-foreground">days</div>
                </div>
              </div>

              {/* Method info */}
              {methodConfig && (
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium">Equipment:</span> {methodConfig.equipment}
                  {' · '}
                  <span className="font-medium">Result:</span> {methodConfig.result}
                </div>
              )}

              {/* Per-pasture breakdown */}
              {option.pastureBreakdown.length > 1 && (
                <div className="text-xs space-y-0.5 pt-1 border-t">
                  {option.pastureBreakdown.map((pb) => (
                    <div key={pb.pastureId} className="flex justify-between text-muted-foreground">
                      <span>{pb.pastureName} ({pb.acreage} ac)</span>
                      <span className="font-mono">{formatCurrency(pb.subtotal)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* Current bid comparison */}
      <Card className="bg-slate-50 border-dashed">
        <CardContent className="py-3">
          <div className="flex items-center justify-between text-sm">
            <div>
              <span className="font-medium">Current Bid</span>
              <span className="text-xs text-muted-foreground ml-2">(per-pasture methods)</span>
            </div>
            <span className="font-mono font-bold text-emerald-600">
              {formatCurrency(currentBid.totalAmount)}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
