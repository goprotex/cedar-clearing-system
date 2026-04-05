'use client';

import type { Pasture, ClearingMethod, DensityClass, DisposalMethod, TerrainClass, VegetationType } from '@/types';
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
  const { updatePasture, removePasture, selectPasture, setDrawingMode, rateCard } = useBidStore();

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

        {/* Soil multiplier display */}
        {pasture.soilData && (
          <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
            <span className="font-medium">Soil:</span> {pasture.soilData.series}
            {' | '}
            <span className="font-medium">Slope:</span> {pasture.soilData.slope_r}%
            {' | '}
            <span className="font-medium">Rock:</span> {pasture.soilData.fragvol_r}%
            {' | '}
            <span className="font-medium">Multiplier:</span> {pasture.soilMultiplier}x
          </div>
        )}

        {/* Hours estimate */}
        {pasture.acreage > 0 && (
          <div className="text-xs text-muted-foreground">
            Est. {pasture.estimatedHrsPerAcre} hrs/acre | {Math.round(pasture.acreage * pasture.estimatedHrsPerAcre)} total hrs
          </div>
        )}

        {/* Notes */}
        <Textarea
          placeholder="Notes for this pasture..."
          value={pasture.notes}
          onChange={(e) => updatePasture(pasture.id, { notes: e.target.value })}
          className="text-xs h-16 resize-none"
        />

        {/* Remove */}
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-xs text-destructive hover:text-destructive"
          onClick={() => removePasture(pasture.id)}
        >
          Remove Pasture
        </Button>
      </CardContent>
    </Card>
  );
}
