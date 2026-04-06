'use client';

import { useState } from 'react';
import type { Pasture, ClearingMethod, DensityClass, DisposalMethod, TerrainClass, VegetationType, AIRecommendation } from '@/types';
import { useBidStore } from '@/lib/store';
import {
  formatCurrency,
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
  const { updatePasture, removePasture, selectPasture, setDrawingMode, rateCard, analyzeCedar, analyzeSeasonal, aiPopulate, unmarkTree } = useBidStore();
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzingSeasonal, setAnalyzingSeasonal] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<AIRecommendation | null>(null);

  const methodConfig = rateCard.methodConfigs.find((m) => m.id === pasture.clearingMethod);

  return (
    <Card
      className={`transition-all cursor-pointer ${
        isSelected ? 'ring-2 ring-amber-500 shadow-lg' : 'hover:shadow-md'
      }`}
      onClick={() => selectPasture(pasture.id)}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            <Input
              value={pasture.name}
              onChange={(e) => updatePasture(pasture.id, { name: e.target.value })}
              onClick={(e) => e.stopPropagation()}
              className="h-7 text-base font-semibold border-none p-0 focus-visible:ring-1"
            />
          </CardTitle>
          <div className="flex items-center gap-2">
            {pasture.acreage > 0 && (
              <Badge variant="secondary" className="font-mono">
                {pasture.acreage} ac
              </Badge>
            )}
            {pasture.subtotal > 0 && (
              <Badge className="bg-emerald-600 font-mono">
                {formatCurrency(pasture.subtotal)}
              </Badge>
            )}
            <button
              title="Remove pasture"
              className="text-muted-foreground hover:text-destructive transition-colors p-0.5"
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
      </CardHeader>

      <CardContent className="space-y-3" onClick={(e) => e.stopPropagation()}>
        {/* Draw polygon button */}
        {pasture.acreage === 0 && (
          <Button
            variant="outline"
            size="sm"
            className="w-full border-dashed border-amber-500 text-amber-700 hover:bg-amber-50"
            onClick={() => {
              selectPasture(pasture.id);
              setDrawingMode(true);
            }}
          >
            Draw Pasture Boundary on Map
          </Button>
        )}

        {pasture.acreage > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs text-muted-foreground"
            onClick={() => {
              selectPasture(pasture.id);
              setDrawingMode(true);
            }}
          >
            Redraw Boundary
          </Button>
        )}

        {/* Vegetation Type */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Vegetation</Label>
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
            <Label className="text-xs">Density</Label>
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
            <Label className="text-xs">Terrain</Label>
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
            <Label className="text-xs">Clearing Method</Label>
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
          <Label className="text-xs">Disposal Method</Label>
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
          <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
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
          <Label className="text-xs font-medium">Add-ons</Label>
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
        {pasture.acreage > 0 && !pasture.soilData && (
          <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2 animate-pulse">
            Loading soil data...
          </div>
        )}
        {pasture.soilData && (
          <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2 space-y-0.5">
            <div className="font-medium text-foreground">
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
            className="w-full text-xs border-red-300 text-red-700 hover:bg-red-50"
            disabled={analyzing}
            onClick={async () => {
              setAnalyzing(true);
              await analyzeCedar(pasture.id);
              setAnalyzing(false);
            }}
          >
            {analyzing ? 'Analyzing imagery with AI...' : '🤖 Analyze Cedar (AI)'}
          </Button>
        )}
        {pasture.cedarAnalysis && (
          <div className="text-xs space-y-2">
            {/* Spectral Analysis */}
            <div className="text-muted-foreground bg-muted/50 border rounded p-2 space-y-1">
              <div className="font-semibold text-foreground flex items-center justify-between">
                <span>📊 Spectral Analysis (NAIP)</span>
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
            </div>

            {/* Claude Vision Analysis */}
            {pasture.cedarAnalysis.claudeVision && (
              <div className="bg-violet-50 border border-violet-200 rounded p-2 space-y-1">
                <div className="font-semibold text-violet-800 flex items-center justify-between">
                  <span>🧠 AI Vision Analysis</span>
                  <Badge variant="outline" className="text-[10px] border-violet-300 text-violet-600">
                    {pasture.cedarAnalysis.claudeVision.confidence}% conf
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-x-3 text-[11px] text-violet-900">
                  <span className="font-medium">
                    Cedar: {pasture.cedarAnalysis.claudeVision.cedarPct}%
                    <span className="text-[10px] text-violet-600 ml-1">
                      ({pasture.cedarAnalysis.claudeVision.cedarDensity})
                    </span>
                  </span>
                  <span>Oak: {pasture.cedarAnalysis.claudeVision.oakPct}%</span>
                  <span>Brush: {pasture.cedarAnalysis.claudeVision.brushPct}%</span>
                  <span>Grass: {pasture.cedarAnalysis.claudeVision.grassPct}%</span>
                  <span>Bare: {pasture.cedarAnalysis.claudeVision.barePct}%</span>
                </div>
                <p className="text-[11px] text-violet-800 leading-relaxed pt-0.5 italic">
                  {pasture.cedarAnalysis.claudeVision.notes}
                </p>
              </div>
            )}

            {!pasture.cedarAnalysis.claudeVision && (
              <div className="text-[10px] text-muted-foreground bg-muted/30 rounded p-1.5 text-center">
                AI Vision unavailable — check CLAUDE_VISION env var
              </div>
            )}

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
                {analyzing ? 'Re-analyzing...' : 'Re-analyze'}
              </button>
            </div>
          </div>
        )}

        {/* Seasonal NDVI Analysis */}
        {!pasture.seasonalAnalysis && pasture.polygon.geometry.coordinates.length > 0 && pasture.acreage > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs border-emerald-300 text-emerald-700 hover:bg-emerald-50"
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
          <div className="text-xs space-y-1 bg-emerald-50 border border-emerald-200 rounded p-2">
            <div className="font-semibold text-emerald-800 flex items-center justify-between">
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
          <div className="text-xs text-muted-foreground space-y-0.5">
            <div>
              <span className="font-medium">Rate:</span> {formatCurrency(Math.round(pasture.subtotal / pasture.acreage))}/acre
              {' | '}
              <span className="font-medium">Time:</span> {pasture.estimatedHrsPerAcre} hrs/acre
            </div>
            <div>
              Est. {Math.round(pasture.acreage * pasture.estimatedHrsPerAcre)} total hrs
              ({Math.ceil(pasture.acreage * pasture.estimatedHrsPerAcre / 8)} work days)
            </div>
          </div>
        )}

        {/* AI Auto-Populate */}
        {pasture.acreage > 0 && (
          <div className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full border-cyan-600 text-cyan-700 hover:bg-cyan-50"
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
              <div className="text-xs bg-cyan-50 border border-cyan-200 rounded p-2 space-y-1">
                <div className="font-semibold text-cyan-800">AI Recommendation Applied</div>
                <div className="text-cyan-700">{aiResult.reasoning}</div>
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
            <Label className="text-xs font-semibold">Marked Trees ({pasture.savedTrees.length})</Label>
            <div className="max-h-32 overflow-y-auto space-y-1">
              {pasture.savedTrees.map((t) => (
                <div
                  key={t.id}
                  className={`flex items-center justify-between text-[11px] px-2 py-1 rounded ${
                    t.action === 'save'
                      ? 'bg-green-50 border border-green-200 text-green-800'
                      : 'bg-red-50 border border-red-200 text-red-800'
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
      </CardContent>
    </Card>
  );
}
