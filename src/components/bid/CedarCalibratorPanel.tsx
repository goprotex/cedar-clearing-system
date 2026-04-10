'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  type CirClassifierCalibration,
  CIR_CALIBRATION_STORAGE_KEY,
  DEFAULT_CIR_CALIBRATION,
  loadCirCalibration,
  resetCirCalibration,
  saveCirCalibration,
} from '@/lib/cir-calibration';

const FIELDS: { key: keyof CirClassifierCalibration; label: string; hint?: string }[] = [
  { key: 'scatteredCedarCtxLt', label: 'Scattered cedar: 60m NDVI <', hint: 'pasture invader' },
  { key: 'scatteredCedarNdviGt', label: '…and crown NDVI >' },
  { key: 'scatteredCedarIsoGt', label: '…and isolation >' },
  { key: 'scatteredCedarCtxLt2', label: 'Open grass: ctx <' },
  { key: 'scatteredCedarIsoGt2', label: '…isolation >' },
  { key: 'woodlandOakCtxGt', label: 'Woodland oak: ctx >' },
  { key: 'woodlandOakBroadGt', label: '…broad (GNDVI−NDVI) >' },
  { key: 'highOakCtxGt', label: 'Dense canopy oak: ctx >' },
  { key: 'highOakNdviGt', label: '…NDVI >' },
  { key: 'elongateOakAspectGt', label: 'Elongate oak: aspect >' },
  { key: 'elongateOakCtxGt', label: '…ctx >' },
  { key: 'roundCedarAspectLt', label: 'Round cedar: aspect <' },
  { key: 'roundCedarBroadLt', label: '…broad <' },
  { key: 'mixedTexGt', label: 'Mixed: NDVI std >' },
  { key: 'mixedNdviGt', label: '…NDVI >' },
  { key: 'conflictCedarMin', label: 'Conflict: cedar score ≥' },
  { key: 'conflictOakMin', label: '…oak score ≥' },
  { key: 'conflictMixedAdd', label: '…mixed boost' },
  { key: 'conflictScale', label: '…penalty scale (×)' },
  { key: 'confidenceDivisor', label: 'Confidence ÷' },
  { key: 'floorScore', label: 'Floor score' },
];

export default function CedarCalibratorPanel() {
  const [cal, setCal] = useState<CirClassifierCalibration>(() => loadCirCalibration());
  const [jsonText, setJsonText] = useState('');

  const update = useCallback((key: keyof CirClassifierCalibration, value: string) => {
    const n = parseFloat(value);
    if (Number.isNaN(n)) return;
    setCal((prev) => ({ ...prev, [key]: n }));
  }, []);

  const handleSave = useCallback(() => {
    saveCirCalibration(cal);
    toast.success('Cedar/oak calibration saved. Re-run analysis on a pasture to apply.');
  }, [cal]);

  const handleReset = useCallback(() => {
    resetCirCalibration();
    setCal({ ...DEFAULT_CIR_CALIBRATION });
    toast.info('Calibration reset to defaults.');
  }, []);

  const handleExport = useCallback(() => {
    const s = JSON.stringify(cal, null, 2);
    void navigator.clipboard.writeText(s);
    setJsonText(s);
    toast.success('Copied calibration JSON to clipboard.');
  }, [cal]);

  const handleImport = useCallback(() => {
    try {
      const parsed = JSON.parse(jsonText) as Partial<CirClassifierCalibration>;
      const next = { ...DEFAULT_CIR_CALIBRATION, ...parsed };
      setCal(next);
      saveCirCalibration(next);
      toast.success('Imported and saved calibration.');
    } catch {
      toast.error('Invalid JSON.');
    }
  }, [jsonText]);

  return (
    <div className="space-y-4 border border-[#353534] rounded-md p-3 bg-[#1c1b1b]">
      <div>
        <h3 className="text-xs font-black uppercase tracking-widest text-[#FF6B00]">Cedar / oak (CIR) calibration</h3>
        <p className="text-[10px] text-[#a98a7d] mt-1 leading-relaxed">
          Tunes the heuristic in <code className="text-[#13ff43]">cir-crown-classify</code>. Values persist in{' '}
          <code className="text-[#a98a7d]">{CIR_CALIBRATION_STORAGE_KEY}</code>. After saving, run{' '}
          <strong className="text-[#e5e2e1]">cedar analysis</strong> again on a pasture.
        </p>
      </div>

      <div className="space-y-2 max-h-[min(50vh,420px)] overflow-y-auto pr-1">
        {FIELDS.map(({ key, label, hint }) => (
          <div key={key} className="flex items-center gap-2 text-[11px]">
            <label className="flex-1 text-[#a98a7d] leading-tight" title={hint}>
              {label}
            </label>
            <Input
              type="number"
              step="any"
              className="h-8 w-24 font-mono text-xs bg-[#131313] border-[#353534] text-[#e5e2e1]"
              value={String(cal[key])}
              onChange={(e) => update(key, e.target.value)}
            />
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" className="bg-[#FF6B00] text-black font-black text-xs uppercase" onClick={handleSave}>
          Save
        </Button>
        <Button size="sm" variant="outline" className="text-xs border-[#353534]" onClick={handleReset}>
          Reset defaults
        </Button>
        <Button size="sm" variant="outline" className="text-xs border-[#353534]" onClick={handleExport}>
          Copy JSON
        </Button>
      </div>

      <div className="space-y-1">
        <label className="text-[10px] uppercase text-[#5a4136] font-bold">Import JSON</label>
        <textarea
          className="w-full min-h-[88px] text-[10px] font-mono bg-[#131313] border border-[#353534] rounded p-2 text-[#a98a7d]"
          placeholder="Paste exported JSON…"
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
        />
        <Button size="sm" variant="outline" className="text-xs border-[#353534] w-full" onClick={handleImport}>
          Apply import
        </Button>
      </div>
    </div>
  );
}
