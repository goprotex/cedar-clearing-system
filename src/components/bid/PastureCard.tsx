'use client';

import { useState } from 'react';
import type { Pasture, ClearingMethod, DensityClass, DisposalMethod, TerrainClass, VegetationType, AIRecommendation } from '@/types';
import { useBidStore } from '@/lib/store';
import {
  formatCurrency,
  getBillableAcreage,
  VEGETATION_LABELS,
  DENSITY_LABELS,
  TERRAIN_LABELS,
  DISPOSAL_LABELS,
} from '@/lib/rates';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';

interface PastureCardProps {
  pasture: Pasture;
  isSelected: boolean;
}

export default function PastureCard({ pasture, isSelected }: PastureCardProps) {
  const { updatePasture, removePasture, selectPasture, setDrawingMode, rateCard, analyzeCedar, analyzeSeasonal, aiPopulate, analysisProgress, unmarkTree } = useBidStore();
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzingSeasonal, setAnalyzingSeasonal] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<AIRecommendation | null>(null);

  const methodConfig = rateCard.methodConfigs.find((m) => m.id === pasture.clearingMethod);
  const { billableAcres, pricingMode } = getBillableAcreage(pasture);
  const displayedRate = billableAcres > 0 ? Math.round(pasture.subtotal / billableAcres) : 0;
  const totalHours = Math.round(billableAcres * pasture.estimatedHrsPerAcre);
  const globalAnalysisActive = Boolean(analysisProgress?.active);

  return (
    <div
      className={`transition-all cursor-pointer bg-[#1c1b1b] border ${
        isSelected ? 'border-[#FF6B00] shadow-[0_0_15px_rgba(255,107,0,0.15)]' : 'border-[#353534] hover:border-[#5a4136]'
      }`}
      onClick={() => selectPasture(pasture.id)}
    >
      <div className="p-3 border-b border-[#353534]">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <Input
              value={pasture.name}
              onChange={(e) => updatePasture(pasture.id, { name: e.target.value })}
              onClick={(e) => e.stopPropagation()}
              className="h-7 text-sm font-black uppercase tracking-tight border-none p-0 bg-transparent text-[#ffb693] focus-visible:ring-1 focus-visible:ring-[#FF6B00]"
            />
          </div>
          <div className="flex items-center gap-2">
            {pasture.acreage > 0 && (
              <span className="font-mono text-xs text-[#e5e2e1] bg-[#353534] px-2 py-0.5">
                {pasture.acreage} AC
              </span>
            )}
            {pasture.subtotal > 0 && (
              <span className="font-mono text-xs text-[#13ff43] bg-[#13ff43]/10 px-2 py-0.5">
                {formatCurrency(pasture.subtotal)}
              </span>
            )}
            <button
              title="Remove pasture"
              className="text-[#5a4136] hover:text-red-500 transition-colors p-0.5"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Remove "${pasture.name}"? This cannot be undone.`)) {
                  removePasture(pasture.id);
                }
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
      </div>

      <div className="p-3 space-y-3" onClick={(e) => e.stopPropagation()}>
        {/* Draw polygon button */}
        {pasture.acreage === 0 && (
          <button
            className="w-full border-2 border-dashed border-[#FF6B00] text-[#FF6B00] text-xs font-bold uppercase tracking-widest py-2 hover:bg-[#FF6B00] hover:text-black transition-all"
            onClick={() => {
              selectPasture(pasture.id);
              setDrawingMode(true);
            }}
          >
            DRAW_BOUNDARY
          </button>
        )}

        {pasture.acreage > 0 && (
          <button
            className="w-full text-[10px] text-[#5a4136] hover:text-[#ffb693] uppercase tracking-widest py-1 transition-colors"
            onClick={() => {
              selectPasture(pasture.id);
              setDrawingMode(true);
            }}
          >
            REDRAW_BOUNDARY
          </button>
        )}

        {/* Vegetation Type */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-[10px] text-[#ffb693] uppercase font-bold tracking-widest">Vegetation</Label>
            <Select
              value={pasture.vegetationType}
              onValueChange={(v) => updatePasture(pasture.id, { vegetationType: v as VegetationType })}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(VEGETATION_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Density */}
          <div>
            <Label className="text-[10px] text-[#ffb693] uppercase font-bold tracking-widest">Density</Label>
            <Select
              value={pasture.density}
              onValueChange={(v) => updatePasture(pasture.id, { density: v as DensityClass })}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(DENSITY_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Terrain + Method */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-[10px] text-[#ffb693] uppercase font-bold tracking-widest">Terrain</Label>
            <Select
              value={pasture.terrain}
              onValueChange={(v) => updatePasture(pasture.id, { terrain: v as TerrainClass })}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TERRAIN_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-[10px] text-[#ffb693] uppercase font-bold tracking-widest">Method</Label>
            <Select
              value={pasture.clearingMethod}
              onValueChange={(v) => updatePasture(pasture.id, { clearingMethod: v as ClearingMethod })}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {rateCard.methodConfigs.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Disposal */}
        <div>
          <Label className="text-[10px] text-[#ffb693] uppercase font-bold tracking-widest">Disposal</Label>
          <Select
            value={pasture.disposalMethod}
            onValueChange={(v) => updatePasture(pasture.id, { disposalMethod: v as DisposalMethod })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(DISPOSAL_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Method info */}
        {methodConfig && (
          <div className="text-xs text-[#a98a7d] bg-[#201f1f] border border-[#353534] p-2">
            <span className="font-medium">Equipment:</span> {methodConfig.equipment}
            <br />
            <span className="font-medium">Result:</span> {methodConfig.result}
            <br />
            <span className="font-medium">Rate mult:</span> {methodConfig.rateMultiplier}x
            {' | '}
            <span className="font-medium">Time mult:</span> {methodConfig.timeMultiplier}x
          </div>
        )}

        {/* Method-specific adders */}
        <div className="space-y-1">
          <Label className="text-[10px] text-[#ffb693] uppercase font-bold tracking-widest">Add-ons</Label>
          {(pasture.adders ?? []).map((adder, idx) => {
            const def = rateCard.methodAdders.find((d) => d.id === adder.adderId);
            return (
              <div key={adder.adderId} className="flex items-center gap-1.5 text-xs">
                <span className="flex-1 truncate">{def?.label ?? adder.adderId}</span>
                <Input
                  type="number"
                  min={0}
                  value={adder.quantity}
                  onChange={(e) => {
                    const updated = [...(pasture.adders ?? [])];
                    updated[idx] = { ...updated[idx], quantity: Number(e.target.value) || 0 };
                    updatePasture(pasture.id, { adders: updated });
                  }}
                  className="h-7 w-16 text-xs text-right"
                />
                <span className="text-muted-foreground w-12">{def?.unit === 'acre' ? 'ac' : def?.unit === 'tree' ? 'tree' : def?.unit === 'pile' ? 'pile' : 'lf'}</span>
                <span className="text-muted-foreground">@</span>
                <Input
                  type="number"
                  min={0}
                  step={0.5}
                  value={adder.costPerUnit}
                  onChange={(e) => {
                    const updated = [...(pasture.adders ?? [])];
                    updated[idx] = { ...updated[idx], costPerUnit: Number(e.target.value) || 0 };
                    updatePasture(pasture.id, { adders: updated });
                  }}
                  className="h-7 w-16 text-xs text-right"
                />
                <button
                  className="text-muted-foreground hover:text-red-500 text-sm px-1"
                  onClick={() => {
                    updatePasture(pasture.id, { adders: (pasture.adders ?? []).filter((_, i) => i !== idx) });
                  }}
                >×</button>
              </div>
            );
          })}
          {rateCard.methodAdders.filter((d) => !(pasture.adders ?? []).some((a) => a.adderId === d.id)).length > 0 && (
            <Select
              value=""
              onValueChange={(adderId) => {
                if (!adderId) return;
                const def = rateCard.methodAdders.find((d) => d.id === adderId);
                if (!def) return;
                const qty = def.unit === 'acre' ? pasture.acreage : 1;
                updatePasture(pasture.id, {
                  adders: [...(pasture.adders ?? []), { adderId, quantity: qty, costPerUnit: def.defaultCost }],
                });
              }}
            >
              <SelectTrigger className="h-7 text-xs text-muted-foreground">
                <SelectValue placeholder="+ Add add-on..." />
              </SelectTrigger>
              <SelectContent>
                {rateCard.methodAdders
                  .filter((d) => !(pasture.adders ?? []).some((a) => a.adderId === d.id))
                  .map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.label} (${d.minCost}–${d.maxCost}/{d.unit.replace('_', ' ')})
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Soil multiplier display */}
        {pasture.acreage > 0 && !pasture.soilData && !globalAnalysisActive && (
          <div className="text-xs text-[#a98a7d] bg-[#201f1f] border border-[#353534] p-2 animate-pulse">
            LOADING_SOIL_DATA...
          </div>
        )}
        {pasture.soilData && (
          <div className="text-xs text-[#a98a7d] bg-[#201f1f] border border-[#353534] p-2 space-y-0.5">
            <div className="font-bold text-[#ffb693] uppercase">
              Soil: {pasture.soilData.series}
              {pasture.soilData.mapUnit && (
                <span className="font-normal text-muted-foreground"> — {pasture.soilData.mapUnit}</span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-x-3">
              <span>Slope: {pasture.soilData.slope_r}%</span>
              <span>Rock: {pasture.soilData.fragvol_r}%</span>
              <span>Drainage: {pasture.soilData.drainagecl}</span>
              <span>Bedrock: {pasture.soilData.resdept_r ? `${pasture.soilData.resdept_r} cm` : 'Deep'}</span>
              {pasture.elevationFt !== null && pasture.elevationFt !== undefined && (
                <span>Elevation: {pasture.elevationFt.toLocaleString()} ft</span>
              )}
            </div>
            <div className="flex items-center justify-between pt-0.5">
              <span>
                Soil difficulty: <span className={`font-semibold ${pasture.soilMultiplier > 1.2 ? 'text-amber-600' : pasture.soilMultiplier > 1.0 ? 'text-yellow-600' : 'text-emerald-600'}`}>
                  {pasture.soilMultiplier}x
                </span>
              </span>
              {pasture.soilData.flodfreqcl && pasture.soilData.flodfreqcl !== 'None' && (
                <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-600">
                  Flood: {pasture.soilData.flodfreqcl}
                </Badge>
              )}
            </div>
          </div>
        )}

        {/* Cedar AI analysis */}
        {pasture.acreage > 0 && !pasture.cedarAnalysis && (
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs border-[#FF6B00] text-[#FF6B00] hover:bg-[#FF6B00] hover:text-black"
            disabled={analyzing}
            onClick={async () => {
              setAnalyzing(true);
              await analyzeCedar(pasture.id);
              setAnalyzing(false);
            }}
          >
            {analyzing && !globalAnalysisActive ? 'Analyzing imagery with AI...' : '🤖 Analyze Cedar (AI)'}
          </Button>
        )}
        {pasture.cedarAnalysis && (
          <div className="text-xs space-y-2">
            {/* Spectral Analysis */}
            <div className="text-[#a98a7d] bg-[#201f1f] border border-[#353534] p-2 space-y-1">
              <div className="font-bold text-[#ffb693] uppercase flex items-center justify-between">
                <span>📊 SPECTRAL (NAIP + S2 + texture)</span>
                <Badge variant="outline" className="text-[10px]">
                  {pasture.cedarAnalysis.summary.confidence}% conf
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-x-3 text-[11px]">
                <span className="text-red-700 font-medium">
                  Cedar: {pasture.cedarAnalysis.summary.cedar.pct}%
                  ({pasture.cedarAnalysis.summary.estimatedCedarAcres} ac)
                </span>
                <span>Oak: {pasture.cedarAnalysis.summary.oak.pct}%</span>
                <span>Brush: {pasture.cedarAnalysis.summary.mixedBrush.pct}%</span>
                <span>Grass: {pasture.cedarAnalysis.summary.grass.pct}%</span>
                <span>Bare: {pasture.cedarAnalysis.summary.bare.pct}%</span>
                <span>NDVI avg: {pasture.cedarAnalysis.summary.averageNDVI}</span>
              </div>
              <div className="text-[10px] text-muted-foreground">
                {pasture.cedarAnalysis.summary.totalSamples} samples @ {pasture.cedarAnalysis.summary.gridSpacingM}m grid
              </div>
              <div className="grid grid-cols-3 gap-x-2 text-[10px] text-muted-foreground">
                <span>GNDVI: {pasture.cedarAnalysis.summary.averageGNDVI ?? '—'}</span>
                <span>SAVI: {pasture.cedarAnalysis.summary.averageSAVI ?? '—'}</span>
                <span>Band votes: {pasture.cedarAnalysis.summary.avgBandVotes ?? '—'}/5</span>
              </div>
              {(pasture.cedarAnalysis.summary.highConfidenceCedarCells ?? 0) > 0 && (
                <div className="text-[10px] text-red-600 font-medium">
                  {pasture.cedarAnalysis.summary.highConfidenceCedarCells} cells verified cedar (≥3 band agreement)
                </div>
              )}
              {pasture.cedarAnalysis.summary.tileConsensus && (
                <div className="text-[10px] text-muted-foreground">
                  Tile consensus: {pasture.cedarAnalysis.summary.tileConsensus.tileCount} tiles ({pasture.cedarAnalysis.summary.tileConsensus.tileSizeM}m, {pasture.cedarAnalysis.summary.tileConsensus.tileOverlapPct}% overlap) · {pasture.cedarAnalysis.summary.tileConsensus.consensusImprovedCells} cells refined ({pasture.cedarAnalysis.summary.tileConsensus.consensusImprovedPct}%)
                </div>
              )}
              {(pasture.cedarAnalysis.summary.lowTrustPct ?? 0) > 0 && (
                <div className="text-[10px] text-orange-500 font-medium">
                  Low-trust cells (orange on map): {pasture.cedarAnalysis.summary.lowTrustPct}% ({pasture.cedarAnalysis.summary.lowTrustCells} cells)
                </div>
              )}
              {pasture.cedarAnalysis.summary.sentinelFusion?.used && (
                <div className="text-[10px] text-muted-foreground">
                  Sentinel-2: winter {pasture.cedarAnalysis.summary.sentinelFusion.winterDate ?? '—'} · summer{' '}
                  {pasture.cedarAnalysis.summary.sentinelFusion.summerDate ?? '—'} ({pasture.cedarAnalysis.summary.sentinelFusion.pairedSamples} subsample points)
                </div>
              )}
              {pasture.cedarAnalysis.summary.chunkedRun && (
                <div className="text-[10px] text-muted-foreground">
                  Analyzed in {pasture.cedarAnalysis.summary.chunkedRun.chunkCount} regions (≤{pasture.cedarAnalysis.summary.chunkedRun.maxSamplesPerChunk.toLocaleString()} samples each), merged for full pasture
                </div>
              )}
            </div>

            <div className="text-center">
              <button
                className="text-[10px] underline hover:no-underline text-muted-foreground"
                onClick={async () => {
                  setAnalyzing(true);
                  await analyzeCedar(pasture.id);
                  setAnalyzing(false);
                }}
                disabled={analyzing}
              >
                {analyzing && !globalAnalysisActive ? 'Re-analyzing...' : 'Re-analyze'}
              </button>
            </div>
          </div>
        )}

        {/* Seasonal NDVI Analysis */}
        {!pasture.seasonalAnalysis && pasture.polygon.geometry.coordinates.length > 0 && pasture.acreage > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs border-[#13ff43]/50 text-[#13ff43] hover:bg-[#13ff43]/10"
            disabled={analyzingSeasonal}
            onClick={async () => {
              setAnalyzingSeasonal(true);
              await analyzeSeasonal(pasture.id);
              setAnalyzingSeasonal(false);
            }}
          >
            {analyzingSeasonal ? 'Fetching Sentinel-2 imagery...' : '🌡️ Seasonal NDVI Analysis'}
          </Button>
        )}
        {pasture.seasonalAnalysis && (
          <div className="text-xs space-y-1 bg-[#13ff43]/5 border border-[#13ff43]/20 p-2">
            <div className="font-bold text-[#13ff43] uppercase flex items-center justify-between">
              <span>🌡️ Seasonal NDVI</span>
              <Badge variant="outline" className="text-[10px] border-emerald-300 text-emerald-600">
                {pasture.seasonalAnalysis.confidence}% conf
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-x-3 text-[11px] text-emerald-900">
              <span>Winter NDVI: {pasture.seasonalAnalysis.winterNDVI ?? '—'}</span>
              <span>Summer NDVI: {pasture.seasonalAnalysis.summerNDVI ?? '—'}</span>
              {pasture.seasonalAnalysis.cedarPct > 0 && (
                <span className="col-span-2 font-bold text-red-700 text-xs">
                  🌲 Cedar (persistence): {pasture.seasonalAnalysis.cedarPct}%
                </span>
              )}
              <span className="font-medium text-red-700">
                🌲 Evergreen: {pasture.seasonalAnalysis.evergreenPct}%
              </span>
              <span className="text-amber-700">
                🍂 Deciduous: {pasture.seasonalAnalysis.deciduousPct}%
              </span>
              <span>Dormant/Bare: {pasture.seasonalAnalysis.dormantPct}%</span>
              {pasture.seasonalAnalysis.ndviChange !== null && (
                <span>NDVI Δ: {pasture.seasonalAnalysis.ndviChange > 0 ? '+' : ''}{pasture.seasonalAnalysis.ndviChange}</span>
              )}
            </div>
            {pasture.seasonalAnalysis.winterScene && (
              <div className="text-[10px] text-muted-foreground">
                Winter: {pasture.seasonalAnalysis.winterScene.date} ({pasture.seasonalAnalysis.winterScene.cloudCover}% cloud)
              </div>
            )}
            {pasture.seasonalAnalysis.summerScene && (
              <div className="text-[10px] text-muted-foreground">
                Summer: {pasture.seasonalAnalysis.summerScene.date} ({pasture.seasonalAnalysis.summerScene.cloudCover}% cloud)
              </div>
            )}
            <div className="text-center pt-0.5">
              <button
                className="text-[10px] underline hover:no-underline text-muted-foreground"
                onClick={async () => {
                  setAnalyzingSeasonal(true);
                  await analyzeSeasonal(pasture.id);
                  setAnalyzingSeasonal(false);
                }}
                disabled={analyzingSeasonal}
              >
                {analyzingSeasonal ? 'Re-analyzing...' : 'Re-analyze'}
              </button>
            </div>
          </div>
        )}

        {/* Hours estimate + per-acre rate */}
        {pasture.acreage > 0 && (
          <div className="text-xs text-[#a98a7d] space-y-0.5 bg-[#201f1f] border border-[#353534] p-2">
            <div>
              <span className="font-medium">Rate:</span> {formatCurrency(displayedRate)}/acre
              {' | '}
              <span className="font-medium">Time:</span> {pasture.estimatedHrsPerAcre} hrs/acre
            </div>
            <div>
              Est. {totalHours} total hrs
              ({Math.ceil(totalHours / 8)} work days)
            </div>
            <div>
              <span className="font-medium">Billed acreage:</span>{' '}
              {billableAcres.toFixed(1)} ac
              {pricingMode === 'cedar_effective' ? ' from cedar analysis' : ' total pasture'}
            </div>
          </div>
        )}

        {/* AI Auto-Populate */}
        {pasture.acreage > 0 && (
          <div className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full border-[#ffb693]/50 text-[#ffb693] hover:bg-[#ffb693]/10"
              disabled={aiLoading}
              onClick={async () => {
                setAiLoading(true);
                setAiResult(null);
                const rec = await aiPopulate(pasture.id);
                setAiResult(rec);
                setAiLoading(false);
              }}
            >
              {aiLoading ? (
                <>
                  <span className="animate-spin mr-1">⚙️</span> AI Analyzing...
                </>
              ) : (
                '🤖 AI Auto-Fill Fields'
              )}
            </Button>
            {aiResult && (
              <div className="text-xs bg-[#ffb693]/5 border border-[#ffb693]/20 p-2 space-y-1">
                <div className="font-bold text-[#ffb693] uppercase">AI_RECOMMENDATION_APPLIED</div>
                <div className="text-[#a98a7d]">{aiResult.reasoning}</div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">
                    Difficulty: {aiResult.estimatedDifficulty}/10
                  </Badge>
                  {aiResult.suggestedAdders.length > 0 && (
                    <Badge variant="outline" className="text-[10px]">
                      +{aiResult.suggestedAdders.length} adders
                    </Badge>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Saved Trees */}
        {(pasture.savedTrees?.length ?? 0) > 0 && (
          <div className="space-y-1">
            <Label className="text-[10px] text-[#ffb693] uppercase font-bold tracking-widest">MARKED_TREES ({pasture.savedTrees.length})</Label>
            <div className="max-h-32 overflow-y-auto space-y-1">
              {pasture.savedTrees.map((t) => (
                <div
                  key={t.id}
                  className={`flex items-center justify-between text-[11px] px-2 py-1 ${
                    t.action === 'save'
                      ? 'bg-[#13ff43]/5 border border-[#13ff43]/20 text-[#13ff43]'
                      : 'bg-red-500/5 border border-red-500/20 text-red-400'
                  }`}
                >
                  <span>
                    {t.action === 'save' ? '🛡️' : '✂️'} {t.label}
                    <span className="text-muted-foreground ml-1">
                      ({t.height}m, ⌀{t.canopyDiameter}m)
                    </span>
                  </span>
                  <button
                    className="text-muted-foreground hover:text-destructive ml-1"
                    onClick={() => unmarkTree(pasture.id, t.id)}
                    title="Remove marking"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        <Textarea
          placeholder="Notes for this pasture..."
          value={pasture.notes}
          onChange={(e) => updatePasture(pasture.id, { notes: e.target.value })}
          className="text-xs h-16 resize-none"
        />
      </div>
    </div>
  );
}
