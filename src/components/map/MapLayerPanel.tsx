'use client';

import { useState, useCallback } from 'react';
import {
  LAYER_CATEGORIES,
  OVERLAY_LAYERS,
  overlaysByCategory,
  type OverlayLayerKey,
  type LayerCategory,
} from '@/lib/map-layers';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** Existing (legacy) layer row definition passed in by the host map. */
export interface LegacyLayerDef {
  key: string;
  label: string;
  emoji: string;
  active: boolean;
  opacity: number;
  opacityRange?: [number, number];
  opacityStep?: number;
  disabled?: boolean;
  onToggle: () => void;
  onOpacity: (v: number) => void;
}

/** Group of legacy layers that should be rendered inside a category. */
export interface LegacyCategoryGroup {
  category: string;
  label: string;
  emoji: string;
  layers: LegacyLayerDef[];
}

interface MapLayerPanelProps {
  open: boolean;
  onClose: () => void;
  /** Current overlay visibility states. */
  overlayLayers: Record<OverlayLayerKey, boolean>;
  /** Current overlay opacities. */
  overlayOpacities: Record<OverlayLayerKey, number>;
  /** Toggle a single overlay layer. */
  onToggleOverlay: (key: OverlayLayerKey) => void;
  /** Update an overlay layer's opacity. */
  onOverlayOpacity: (key: OverlayLayerKey, value: number) => void;
  /**
   * Additional legacy category groups (Imagery, Analysis, etc.)
   * rendered after the overlay categories.
   */
  legacyGroups?: LegacyCategoryGroup[];
  /** Extra content rendered at the bottom (e.g. species filters). */
  children?: React.ReactNode;
  /** Use hologram-themed styling. */
  holoMode?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function MapLayerPanel({
  open,
  onClose,
  overlayLayers,
  overlayOpacities,
  onToggleOverlay,
  onOverlayOpacity,
  legacyGroups,
  children,
  holoMode = false,
}: MapLayerPanelProps) {
  const [expandedCats, setExpandedCats] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState('');

  const toggleCat = useCallback((cat: string) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  if (!open) return null;

  const grouped = overlaysByCategory();
  const lowerSearch = search.toLowerCase().trim();

  // Count active overlays per category
  const countActive = (catId: LayerCategory) => {
    const defs = grouped.get(catId) ?? [];
    return defs.filter((d) => overlayLayers[d.key]).length;
  };

  // Count active legacy per group
  const countLegacyActive = (g: LegacyCategoryGroup) =>
    g.layers.filter((l) => l.active).length;

  const panelBg = holoMode ? 'holo-panel' : 'bg-slate-900/95';
  const textMuted = holoMode ? 'text-green-400' : 'text-slate-400';
  const borderColor = holoMode ? 'border-green-800/50' : 'border-slate-700/60';

  return (
    <div
      className={`backdrop-blur-md rounded-xl shadow-2xl ${panelBg} flex flex-col overflow-hidden`}
      style={{ maxHeight: 'min(72vh, 520px)', width: 'min(85vw, 280px)' }}
    >
      {/* ── Header ── */}
      <div className={`flex items-center justify-between px-3 py-2 border-b ${borderColor}`}>
        <span className={`text-[11px] font-bold uppercase tracking-widest ${textMuted}`}>
          Layers
        </span>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-white text-sm leading-none p-1 -mr-1 touch-manipulation"
          title="Close"
        >
          ✕
        </button>
      </div>

      {/* ── Search bar ── */}
      <div className={`px-3 py-1.5 border-b ${borderColor}`}>
        <input
          type="text"
          placeholder="Search layers…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`w-full text-xs px-2 py-1 rounded-md border ${borderColor} bg-transparent placeholder:text-slate-500 focus:outline-none focus:ring-1 ${
            holoMode
              ? 'text-green-300 focus:ring-green-500/50'
              : 'text-slate-200 focus:ring-amber-500/50'
          }`}
        />
      </div>

      {/* ── Scrollable content ── */}
      <div className="flex-1 overflow-y-auto overscroll-contain px-1 py-1" style={{ WebkitOverflowScrolling: 'touch' }}>
        {/* Overlay categories */}
        {LAYER_CATEGORIES.map((cat) => {
          const defs = grouped.get(cat.id) ?? [];
          const filtered = lowerSearch
            ? defs.filter((d) => d.label.toLowerCase().includes(lowerSearch))
            : defs;
          if (filtered.length === 0) return null;

          const isExpanded = expandedCats.has(cat.id);
          const active = countActive(cat.id);

          return (
            <CategorySection
              key={cat.id}
              label={cat.label}
              emoji={cat.emoji}
              active={active}
              total={defs.length}
              expanded={isExpanded}
              onToggle={() => toggleCat(cat.id)}
              holoMode={holoMode}
            >
              {filtered.map((def) => (
                <OverlayToggleRow
                  key={def.key}
                  label={def.label}
                  emoji={def.emoji}
                  active={overlayLayers[def.key]}
                  opacity={overlayOpacities[def.key]}
                  onToggle={() => onToggleOverlay(def.key)}
                  onOpacity={(v) => onOverlayOpacity(def.key, v)}
                  holoMode={holoMode}
                />
              ))}
            </CategorySection>
          );
        })}

        {/* Legacy groups (Imagery, Analysis, etc.) */}
        {legacyGroups?.map((g) => {
          const filtered = lowerSearch
            ? g.layers.filter((l) => l.label.toLowerCase().includes(lowerSearch))
            : g.layers;
          if (filtered.length === 0) return null;

          const isExpanded = expandedCats.has(g.category);
          const active = countLegacyActive(g);

          return (
            <CategorySection
              key={g.category}
              label={g.label}
              emoji={g.emoji}
              active={active}
              total={g.layers.length}
              expanded={isExpanded}
              onToggle={() => toggleCat(g.category)}
              holoMode={holoMode}
            >
              {filtered.map((l) => (
                <LegacyToggleRow
                  key={l.key}
                  label={l.label}
                  emoji={l.emoji}
                  active={l.active}
                  opacity={l.opacity}
                  opacityRange={l.opacityRange}
                  opacityStep={l.opacityStep}
                  disabled={l.disabled}
                  onToggle={l.onToggle}
                  onOpacity={l.onOpacity}
                  holoMode={holoMode}
                />
              ))}
            </CategorySection>
          );
        })}

        {/* Extra content (species filters, etc.) */}
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function CategorySection({
  label,
  emoji,
  active,
  total,
  expanded,
  onToggle,
  holoMode,
  children,
}: {
  label: string;
  emoji: string;
  active: number;
  total: number;
  expanded: boolean;
  onToggle: () => void;
  holoMode: boolean;
  children: React.ReactNode;
}) {
  const borderColor = holoMode ? 'border-green-800/40' : 'border-slate-700/40';

  return (
    <div className={`border-b last:border-b-0 ${borderColor}`}>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-2 py-2 text-left touch-manipulation"
      >
        <span className="text-sm">{emoji}</span>
        <span
          className={`flex-1 text-xs font-semibold ${
            holoMode ? 'text-green-300' : 'text-slate-200'
          }`}
        >
          {label}
        </span>
        {active > 0 && (
          <span
            className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
              holoMode
                ? 'bg-green-700/60 text-green-200'
                : 'bg-amber-600/80 text-white'
            }`}
          >
            {active}/{total}
          </span>
        )}
        <span
          className={`text-[10px] transition-transform duration-200 ${
            expanded ? 'rotate-180' : ''
          } ${holoMode ? 'text-green-500' : 'text-slate-500'}`}
        >
          ▼
        </span>
      </button>
      {expanded && <div className="px-1 pb-1.5">{children}</div>}
    </div>
  );
}

function OverlayToggleRow({
  label,
  emoji,
  active,
  opacity,
  onToggle,
  onOpacity,
  holoMode,
}: {
  label: string;
  emoji: string;
  active: boolean;
  opacity: number;
  onToggle: () => void;
  onOpacity: (v: number) => void;
  holoMode: boolean;
}) {
  return (
    <div className="space-y-0.5">
      <button
        onClick={onToggle}
        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 touch-manipulation ${
          active
            ? holoMode
              ? 'bg-green-700/50 text-green-100 shadow-[0_0_6px_rgba(0,255,65,0.2)]'
              : 'bg-amber-600/90 text-white'
            : holoMode
              ? 'text-green-300/60 hover:bg-green-900/30 hover:text-green-200'
              : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
        }`}
      >
        <span className="text-sm shrink-0">{emoji}</span>
        <span className="flex-1 text-left">{label}</span>
        {active && (
          <span className="text-[9px] opacity-60 shrink-0">ON</span>
        )}
      </button>
      {active && (
        <div className="flex items-center gap-1.5 px-2 pb-0.5">
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => onOpacity(parseFloat(e.target.value))}
            className={`w-full h-1 cursor-pointer ${holoMode ? 'accent-green-400' : 'accent-amber-500'}`}
          />
          <span
            className={`text-[9px] w-7 text-right tabular-nums ${
              holoMode ? 'text-green-500' : 'text-slate-400'
            }`}
          >
            {Math.round(opacity * 100)}%
          </span>
        </div>
      )}
    </div>
  );
}

function LegacyToggleRow({
  label,
  emoji,
  active,
  opacity,
  opacityRange = [0, 1],
  opacityStep = 0.05,
  disabled = false,
  onToggle,
  onOpacity,
  holoMode,
}: {
  label: string;
  emoji: string;
  active: boolean;
  opacity: number;
  opacityRange?: [number, number];
  opacityStep?: number;
  disabled?: boolean;
  onToggle: () => void;
  onOpacity: (v: number) => void;
  holoMode: boolean;
}) {
  return (
    <div className="space-y-0.5">
      <button
        onClick={disabled ? undefined : onToggle}
        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 touch-manipulation ${
          disabled
            ? 'text-slate-500 cursor-not-allowed opacity-50'
            : active
              ? holoMode
                ? 'bg-green-700/50 text-green-100 shadow-[0_0_6px_rgba(0,255,65,0.2)]'
                : 'bg-amber-600/90 text-white'
              : holoMode
                ? 'text-green-300/60 hover:bg-green-900/30 hover:text-green-200'
                : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
        }`}
      >
        <span className="text-sm shrink-0">{emoji}</span>
        <span className="flex-1 text-left">{label}</span>
        {active && !disabled && (
          <span className="text-[9px] opacity-60 shrink-0">ON</span>
        )}
      </button>
      {active && !disabled && (
        <div className="flex items-center gap-1.5 px-2 pb-0.5">
          <input
            type="range"
            min={opacityRange[0]}
            max={opacityRange[1]}
            step={opacityStep}
            value={opacity}
            onChange={(e) => onOpacity(parseFloat(e.target.value))}
            className={`w-full h-1 cursor-pointer ${holoMode ? 'accent-green-400' : 'accent-amber-500'}`}
          />
          <span
            className={`text-[9px] w-7 text-right tabular-nums ${
              holoMode ? 'text-green-500' : 'text-slate-400'
            }`}
          >
            {Math.round((opacity / opacityRange[1]) * 100)}%
          </span>
        </div>
      )}
    </div>
  );
}

/** Count of active overlay layers – used for the open/close button badge. */
export function useOverlayActiveCount(
  overlayLayers: Record<OverlayLayerKey, boolean>,
): number {
  return OVERLAY_LAYERS.filter((l) => overlayLayers[l.key]).length;
}
