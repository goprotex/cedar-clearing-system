'use client';

import { useBidStore } from '@/lib/store';
import { DEFAULT_RATE_CARD } from '@/lib/rates';
import type { VegetationType, DensityClass, TerrainClass, DisposalMethod } from '@/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

const VEG_LABELS: Record<VegetationType, string> = {
  cedar: 'Cedar', oak: 'Oak', mixed: 'Mixed', mesquite: 'Mesquite', brush: 'Brush',
};
const DENSITY_LABELS: Record<DensityClass, string> = {
  light: 'Light', moderate: 'Moderate', heavy: 'Heavy', extreme: 'Extreme',
};
const TERRAIN_LABELS: Record<TerrainClass, string> = {
  flat: 'Flat', rolling: 'Rolling', steep: 'Steep', rugged: 'Rugged',
};
const DISPOSAL_LABELS: Record<DisposalMethod, string> = {
  mulch_in_place: 'Mulch in Place', pile_and_burn: 'Pile & Burn', haul_off: 'Haul Off',
  chip_and_spread: 'Chip & Spread', stack_for_customer: 'Stack for Customer',
};

export default function RateCardSettings() {
  const { rateCard, updateRateCard } = useBidStore();

  return (
    <div className="space-y-4">
      {/* Base Rates */}
      <Card>
        <CardHeader className="py-3 px-3">
          <CardTitle className="text-sm">Base Rates ($/acre)</CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 space-y-2">
          {(Object.keys(VEG_LABELS) as VegetationType[]).map((veg) => (
            <div key={veg} className="flex items-center justify-between gap-2">
              <Label className="text-xs w-20">{VEG_LABELS[veg]}</Label>
              <Input
                type="number"
                min={0}
                value={rateCard.baseRates[veg]}
                onChange={(e) => updateRateCard({ baseRates: { ...rateCard.baseRates, [veg]: Number(e.target.value) || 0 } })}
                className="h-7 w-24 text-xs text-right"
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Density Multipliers */}
      <Card>
        <CardHeader className="py-3 px-3">
          <CardTitle className="text-sm">Density Multipliers</CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 space-y-2">
          {(Object.keys(DENSITY_LABELS) as DensityClass[]).map((d) => (
            <div key={d} className="flex items-center justify-between gap-2">
              <Label className="text-xs w-20">{DENSITY_LABELS[d]}</Label>
              <Input
                type="number"
                min={0}
                step={0.05}
                value={rateCard.densityMultipliers[d]}
                onChange={(e) => updateRateCard({ densityMultipliers: { ...rateCard.densityMultipliers, [d]: Number(e.target.value) || 0 } })}
                className="h-7 w-24 text-xs text-right"
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Terrain Multipliers */}
      <Card>
        <CardHeader className="py-3 px-3">
          <CardTitle className="text-sm">Terrain Multipliers</CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 space-y-2">
          {(Object.keys(TERRAIN_LABELS) as TerrainClass[]).map((t) => (
            <div key={t} className="flex items-center justify-between gap-2">
              <Label className="text-xs w-20">{TERRAIN_LABELS[t]}</Label>
              <Input
                type="number"
                min={0}
                step={0.05}
                value={rateCard.terrainMultipliers[t]}
                onChange={(e) => updateRateCard({ terrainMultipliers: { ...rateCard.terrainMultipliers, [t]: Number(e.target.value) || 0 } })}
                className="h-7 w-24 text-xs text-right"
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Clearing Methods */}
      <Card>
        <CardHeader className="py-3 px-3">
          <CardTitle className="text-sm">Clearing Method Multipliers</CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 space-y-2">
          {rateCard.methodConfigs.map((m, idx) => (
            <div key={m.id} className="space-y-1">
              <Label className="text-xs font-medium">{m.label}</Label>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground">Rate</span>
                  <Input
                    type="number"
                    min={0}
                    step={0.05}
                    value={m.rateMultiplier}
                    onChange={(e) => {
                      const updated = [...rateCard.methodConfigs];
                      updated[idx] = { ...updated[idx], rateMultiplier: Number(e.target.value) || 0 };
                      updateRateCard({ methodConfigs: updated });
                    }}
                    className="h-7 w-16 text-xs text-right"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground">Time</span>
                  <Input
                    type="number"
                    min={0}
                    step={0.05}
                    value={m.timeMultiplier}
                    onChange={(e) => {
                      const updated = [...rateCard.methodConfigs];
                      updated[idx] = { ...updated[idx], timeMultiplier: Number(e.target.value) || 0 };
                      updateRateCard({ methodConfigs: updated });
                    }}
                    className="h-7 w-16 text-xs text-right"
                  />
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Disposal Adders */}
      <Card>
        <CardHeader className="py-3 px-3">
          <CardTitle className="text-sm">Disposal Adders ($/acre)</CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 space-y-2">
          {(Object.keys(DISPOSAL_LABELS) as DisposalMethod[]).map((d) => (
            <div key={d} className="flex items-center justify-between gap-2">
              <Label className="text-xs flex-1">{DISPOSAL_LABELS[d]}</Label>
              <Input
                type="number"
                min={0}
                value={rateCard.disposalAdders[d]}
                onChange={(e) => updateRateCard({ disposalAdders: { ...rateCard.disposalAdders, [d]: Number(e.target.value) || 0 } })}
                className="h-7 w-24 text-xs text-right"
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Method Adders */}
      <Card>
        <CardHeader className="py-3 px-3">
          <CardTitle className="text-sm">Method-Specific Add-ons</CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 space-y-2">
          {rateCard.methodAdders.map((a, idx) => (
            <div key={a.id} className="space-y-1">
              <Label className="text-xs font-medium">{a.label} <span className="text-muted-foreground font-normal">per {a.unit.replace('_', ' ')}</span></Label>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Min</span>
                <Input
                  type="number"
                  min={0}
                  step={0.5}
                  value={a.minCost}
                  onChange={(e) => {
                    const updated = [...rateCard.methodAdders];
                    updated[idx] = { ...updated[idx], minCost: Number(e.target.value) || 0 };
                    updateRateCard({ methodAdders: updated });
                  }}
                  className="h-7 w-16 text-xs text-right"
                />
                <span className="text-muted-foreground">Default</span>
                <Input
                  type="number"
                  min={0}
                  step={0.5}
                  value={a.defaultCost}
                  onChange={(e) => {
                    const updated = [...rateCard.methodAdders];
                    updated[idx] = { ...updated[idx], defaultCost: Number(e.target.value) || 0 };
                    updateRateCard({ methodAdders: updated });
                  }}
                  className="h-7 w-16 text-xs text-right"
                />
                <span className="text-muted-foreground">Max</span>
                <Input
                  type="number"
                  min={0}
                  step={0.5}
                  value={a.maxCost}
                  onChange={(e) => {
                    const updated = [...rateCard.methodAdders];
                    updated[idx] = { ...updated[idx], maxCost: Number(e.target.value) || 0 };
                    updateRateCard({ methodAdders: updated });
                  }}
                  className="h-7 w-16 text-xs text-right"
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* General */}
      <Card>
        <CardHeader className="py-3 px-3">
          <CardTitle className="text-sm">General</CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs">Minimum Bid ($)</Label>
            <Input
              type="number"
              min={0}
              value={rateCard.minimumBid}
              onChange={(e) => updateRateCard({ minimumBid: Number(e.target.value) || 0 })}
              className="h-7 w-24 text-xs text-right"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs">Mobilization Fee ($)</Label>
            <Input
              type="number"
              min={0}
              value={rateCard.mobilizationFee}
              onChange={(e) => updateRateCard({ mobilizationFee: Number(e.target.value) || 0 })}
              className="h-7 w-24 text-xs text-right"
            />
          </div>
        </CardContent>
      </Card>

      <Separator />

      <Button
        variant="outline"
        size="sm"
        className="w-full text-xs"
        onClick={() => updateRateCard(DEFAULT_RATE_CARD)}
      >
        Reset to Defaults
      </Button>
    </div>
  );
}
