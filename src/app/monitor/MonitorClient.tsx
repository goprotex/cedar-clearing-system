'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { Bid } from '@/types';
import { createClient as createSupabaseClient } from '@/utils/supabase/client';
import type { LayerKey } from './MonitorMap';

type BootstrapJob = {
  id: string;
  title: string;
  status: string;
  created_at: string;
  bid_snapshot: Bid;
  cedar_total_cells: number;
  cedar_cleared_cells: number;
};

type BootstrapResponse = {
  jobs: BootstrapJob[];
  cleared: Record<string, string[]>;
  operators: Record<string, Array<{ user_id: string; lng: number; lat: number; heading: number | null; speed_mps: number | null; accuracy_m: number | null; updated_at: string }>>;
};

type OperatorPosition = BootstrapResponse['operators'][string][number];

const MapboxMap = dynamic(() => import('./MonitorMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-[#0e0e0e] flex items-center justify-center text-[#a98a7d]">
      <div className="text-center">
        <div className="text-[#FF6B00] text-xl font-black uppercase tracking-widest mb-2">LOADING_MONITOR</div>
        <div className="text-xs font-mono">INITIALIZING_GLOBAL_VIEW...</div>
      </div>
    </div>
  ),
});

function pct(cleared: number, total: number) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((cleared / total) * 100)));
}

function loadLocalBidsAsJobs(): BootstrapJob[] {
  if (typeof window === 'undefined') return [];
  const jobs: BootstrapJob[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith('ccc_bid_')) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const bid: Bid = JSON.parse(raw);
      if (!bid.pastures?.length) continue;
      let cedarTotal = 0;
      for (const p of bid.pastures) {
        const feats = p.cedarAnalysis?.gridCells?.features ?? [];
        for (const f of feats) {
          const cls = (f as { properties?: { classification?: string } }).properties?.classification;
          if (cls === 'cedar' || cls === 'oak' || cls === 'mixed_brush') cedarTotal++;
        }
      }
      jobs.push({
        id: bid.id || key.replace('ccc_bid_', ''),
        title: `${bid.bidNumber || 'Bid'} — ${bid.clientName || 'Local'}`,
        status: bid.status || 'draft',
        created_at: bid.updatedAt || new Date().toISOString(),
        bid_snapshot: bid,
        cedar_total_cells: cedarTotal,
        cedar_cleared_cells: 0,
      });
    }
  } catch { /* localStorage may be unavailable */ }
  return jobs;
}

export default function MonitorClient({ fullscreen: fullscreenProp }: { fullscreen?: boolean } = {}) {
  const [jobs, setJobs] = useState<BootstrapJob[]>([]);
  const [clearedByJob, setClearedByJob] = useState<Record<string, Set<string>>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [fullscreen, setFullscreen] = useState(Boolean(fullscreenProp));
  const [operatorsByJob, setOperatorsByJob] = useState<BootstrapResponse['operators']>({});
  const [layersPanelOpen, setLayersPanelOpen] = useState(false);

  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({
    soil: false,
    naip: false,
    naipCIR: false,
    naipNDVI: false,
    terrain3d: false,
    cedarAI: true,
    radar: true,
    pastures: true,
    hologram: false,
  });

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';
  const supabaseRef = useRef<ReturnType<typeof createSupabaseClient> | null>(null);

  const toggleLayer = (key: LayerKey) => {
    setLayers(prev => {
      const next = { ...prev };
      // NAIP variants are mutually exclusive
      if (key === 'naip' || key === 'naipCIR' || key === 'naipNDVI') {
        if (!prev[key]) {
          next.naip = false;
          next.naipCIR = false;
          next.naipNDVI = false;
        }
      }
      // Hologram on → disable terrain (they conflict), enable cedar + NDVI
      if (key === 'hologram' && !prev.hologram) {
        next.terrain3d = false;
        next.cedarAI = true;
        next.naipNDVI = true;
        next.naip = false;
        next.naipCIR = false;
      }
      // Block terrain while hologram active
      if (key === 'terrain3d' && prev.hologram) return prev;
      next[key] = !prev[key];
      return next;
    });
  };

  // Bootstrap: try remote first, fall back to local bids
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setBusy(true);
        setErr(null);
        const res = await fetch('/api/monitor/bootstrap', { cache: 'no-store' });
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as BootstrapResponse;
        if (cancelled) return;

        let remoteJobs = data.jobs ?? [];
        const next: Record<string, Set<string>> = {};
        for (const [jobId, cellIds] of Object.entries(data.cleared ?? {})) {
          next[jobId] = new Set(cellIds);
        }
        setOperatorsByJob(data.operators ?? {});

        // If no remote jobs, load from localStorage
        if (remoteJobs.length === 0) {
          remoteJobs = loadLocalBidsAsJobs();
        }

        setJobs(remoteJobs);
        setClearedByJob(next);
      } catch (e) {
        if (cancelled) return;
        // Fall back to local bids
        const localJobs = loadLocalBidsAsJobs();
        if (localJobs.length > 0) {
          setJobs(localJobs);
          setErr(null);
        } else {
          setErr(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Also load operator sessions from localStorage for local jobs
  useEffect(() => {
    if (!jobs.length) return;
    const nextCleared: Record<string, Set<string>> = { ...clearedByJob };
    let changed = false;
    for (const job of jobs) {
      if (nextCleared[job.id]?.size) continue;
      try {
        const raw = localStorage.getItem(`ccc_operator_${job.id}`);
        if (!raw) continue;
        const data = JSON.parse(raw) as { clearedCellIds?: string[] };
        if (data.clearedCellIds?.length) {
          nextCleared[job.id] = new Set(data.clearedCellIds);
          changed = true;
        }
      } catch { /* ignore */ }
    }
    if (changed) setClearedByJob(nextCleared);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);

  // Realtime: cleared cells
  useEffect(() => {
    if (!jobs.length) return;
    const supabase = (supabaseRef.current ??= createSupabaseClient());
    const jobIds = jobs.map((j) => j.id).filter(Boolean);
    if (!jobIds.length) return;

    const channel = supabase
      .channel('monitor-job-cleared-cells')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'job_cleared_cells', filter: `job_id=in.(${jobIds.join(',')})` },
        (payload) => {
          const row = payload.new as { job_id?: string; cell_id?: string } | null;
          if (typeof row?.job_id !== 'string' || typeof row?.cell_id !== 'string') return;
          setClearedByJob((prev) => {
            const next = { ...prev };
            const set = new Set(prev[row.job_id!] ? Array.from(prev[row.job_id!]) : []);
            if (set.has(row.cell_id!)) return prev;
            set.add(row.cell_id!);
            next[row.job_id!] = set;
            return next;
          });
          setJobs((prev) => prev.map((j) =>
            j.id === row.job_id ? { ...j, cedar_cleared_cells: Math.min(j.cedar_total_cells, j.cedar_cleared_cells + 1) } : j
          ));
        }
      ).subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [jobs]);

  // Realtime: operator positions
  useEffect(() => {
    if (!jobs.length) return;
    const supabase = (supabaseRef.current ??= createSupabaseClient());
    const jobIds = jobs.map((j) => j.id).filter(Boolean);
    if (!jobIds.length) return;

    const channel = supabase
      .channel(`monitor-ops-${jobIds.join('-').slice(0, 80)}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'job_operator_positions', filter: `job_id=in.(${jobIds.join(',')})` },
        (payload) => {
          const row = payload.new as { job_id: string; user_id: string; lng: number; lat: number; heading: number | null; speed_mps: number | null; accuracy_m: number | null; updated_at: string } | null;
          if (!row || typeof row.job_id !== 'string' || typeof row.lng !== 'number' || typeof row.lat !== 'number') return;
          setOperatorsByJob((prev) => {
            const next = { ...prev };
            const arr = next[row.job_id] ? [...next[row.job_id]] : [];
            const idx = arr.findIndex((o) => o.user_id === row.user_id);
            const entry: OperatorPosition = {
              user_id: row.user_id, lng: row.lng, lat: row.lat,
              heading: typeof row.heading === 'number' ? row.heading : null,
              speed_mps: typeof row.speed_mps === 'number' ? row.speed_mps : null,
              accuracy_m: typeof row.accuracy_m === 'number' ? row.accuracy_m : null,
              updated_at: row.updated_at,
            };
            if (idx >= 0) arr[idx] = entry; else arr.push(entry);
            next[row.job_id] = arr;
            return next;
          });
        }
      ).subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [jobs]);

  const totals = useMemo(() => {
    const total = jobs.reduce((s, j) => s + (j.cedar_total_cells ?? 0), 0);
    const cleared = jobs.reduce((s, j) => s + (j.cedar_cleared_cells ?? 0), 0);
    return { total, cleared, pct: pct(cleared, total) };
  }, [jobs]);

  const LAYER_DEFS: Array<{ key: LayerKey; label: string; group?: string }> = [
    { key: 'pastures', label: '🟩 Pastures' },
    { key: 'cedarAI', label: '🤖 AI Cedar' },
    { key: 'radar', label: '🌧️ Radar' },
    { key: 'soil', label: '🟫 Soil', group: 'imagery' },
    { key: 'naip', label: '🛰️ RGB', group: 'imagery' },
    { key: 'naipCIR', label: '🔴 CIR', group: 'imagery' },
    { key: 'naipNDVI', label: '🌿 NDVI', group: 'imagery' },
    { key: 'terrain3d', label: '⛰️ 3D Terrain' },
    { key: 'hologram', label: '🔮 Hologram' },
  ];

  return (
    <div className={`min-h-screen bg-[#131313] text-[#e5e2e1] ${fullscreen ? 'fixed inset-0 z-[60] p-0 overflow-hidden' : ''}`}>
      <div className={`${fullscreen ? 'hidden' : 'flex'} justify-between items-end border-l-4 border-[#FF6B00] pl-4 mb-6`}>
        <div>
          <h1 className="text-4xl font-black uppercase tracking-tighter">SCOUT_MONITOR</h1>
          <p className="text-[#ffb693] text-xs font-mono">GLOBAL OPS // LIVE JOBS // WEATHER + HOLOGRAM</p>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-mono text-[#a98a7d]">ALL_JOBS_PROGRESS</div>
          <div className="text-sm font-black text-[#13ff43]">{totals.pct}%</div>
        </div>
      </div>

      {err && (
        <div className="border border-red-500/50 bg-red-950/40 p-3 text-sm mb-4">{err}</div>
      )}

      <div className={`flex ${fullscreen ? 'flex-col' : 'flex-col lg:flex-row'} gap-6 ${fullscreen ? 'h-full' : ''}`}>
        <div className={`flex-1 border-2 border-[#353534] relative ${fullscreen ? 'h-full' : ''}`} style={fullscreen ? undefined : { minHeight: '70vh' }}>
          {mapboxToken ? (
            <MapboxMap
              accessToken={mapboxToken}
              jobs={jobs}
              clearedByJob={clearedByJob}
              operatorsByJob={operatorsByJob}
              radarOn={layers.radar}
              cedarOn={layers.cedarAI}
              layers={layers}
            />
          ) : (
            <div className="w-full h-full min-h-[70vh] bg-[#0e0e0e] flex items-center justify-center text-[#a98a7d]">
              <div className="text-center space-y-2 border-2 border-[#353534] p-8">
                <p className="text-lg font-black uppercase tracking-tighter">SATELLITE_FEED_OFFLINE</p>
                <p className="text-sm font-mono">
                  Add <code className="bg-[#353534] px-1.5 py-0.5 text-[#FF6B00]">NEXT_PUBLIC_MAPBOX_TOKEN</code> to <code className="bg-[#353534] px-1.5 py-0.5 text-[#FF6B00]">.env.local</code>
                </p>
              </div>
            </div>
          )}
          {busy && (
            <div className="absolute inset-0 bg-black/30 flex items-center justify-center text-xs font-mono text-[#a98a7d]">
              LOADING_JOBS…
            </div>
          )}

          {/* Layer control — floating panel on the map */}
          <div className="absolute bottom-4 left-4 z-10">
            {layersPanelOpen ? (
              <div className="backdrop-blur rounded-lg shadow-lg p-2 min-w-[180px] bg-slate-900/90">
                <div className="flex items-center justify-between px-1 pb-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Layers</span>
                  <button onClick={() => setLayersPanelOpen(false)} className="text-slate-400 hover:text-white text-xs leading-none">✕</button>
                </div>
                {LAYER_DEFS.map((def, i) => (
                  <div key={def.key}>
                    {i > 0 && def.group === 'imagery' && LAYER_DEFS[i - 1]?.group !== 'imagery' && (
                      <div className="border-t border-slate-700 my-1" />
                    )}
                    <button
                      onClick={() => toggleLayer(def.key)}
                      className={`w-full text-left px-2 py-1 rounded text-xs font-medium transition-all duration-200 ${
                        layers[def.key]
                          ? 'bg-amber-600 text-white'
                          : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                      }`}
                    >
                      {def.label}
                      {layers[def.key] && <span className="float-right text-[10px] opacity-75">ON</span>}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <button
                onClick={() => setLayersPanelOpen(true)}
                className="backdrop-blur rounded-lg shadow-lg px-3 py-2 text-xs font-medium bg-slate-900/90 text-slate-300 hover:text-white transition-colors"
              >
                Layers
              </button>
            )}
          </div>

          {/* Fullscreen TV overlay */}
          {fullscreen && (
            <div className="absolute top-3 left-3 z-20 holo-panel backdrop-blur-sm rounded-lg px-4 py-3 space-y-2">
              <div className="text-[10px] text-[#00ff41] font-bold uppercase tracking-widest">Office Monitor</div>
              <div className="flex items-center gap-3">
                <div className="text-xs font-mono text-[#a98a7d]">ALL_JOBS</div>
                <div className="text-xl font-black text-[#13ff43] tabular-nums">{totals.pct}%</div>
                <div className="text-[10px] font-mono text-[#a98a7d] tabular-nums">{totals.cleared}/{totals.total}</div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setFullscreen(false)} className="px-3 py-2 rounded bg-[#FF6B00] text-black text-[10px] font-black uppercase tracking-widest hover:bg-white transition-all">
                  EXIT_FULL
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className={`w-full lg:w-96 shrink-0 space-y-4 ${fullscreen ? 'hidden' : ''}`}>
          <div className="border-2 border-[#353534] p-4 space-y-3">
            <div className="text-[10px] text-[#a98a7d] font-bold uppercase tracking-widest">CONTROLS</div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-[#e5e2e1]">FULLSCREEN_TV</span>
              <button onClick={() => setFullscreen(true)} className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest border border-[#13ff43] text-[#13ff43] hover:bg-[#13ff43] hover:text-black transition-all">
                LAUNCH
              </button>
            </div>
          </div>

          <div className="border-2 border-[#353534] p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] text-[#a98a7d] font-bold uppercase tracking-widest">ACTIVE_JOBS ({jobs.length})</div>
              <div className="text-[10px] font-mono text-[#a98a7d]">{totals.cleared}/{totals.total} CELLS</div>
            </div>

            {jobs.length === 0 ? (
              <div className="text-sm text-[#a98a7d]">No jobs found. Create a bid and draw pastures first.</div>
            ) : (
              <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
                {jobs.map((j) => {
                  const p = pct(j.cedar_cleared_cells, j.cedar_total_cells);
                  return (
                    <div key={j.id} className="border border-[#353534] p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-xs font-black truncate">{j.title}</div>
                          <div className="text-[10px] font-mono text-[#a98a7d] truncate">{j.status}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-xs font-black text-[#13ff43]">{p}%</div>
                        </div>
                      </div>
                      <div className="mt-2 w-full h-2 bg-[#353534] rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-[#13ff43] to-[#00cc33]" style={{ width: `${p}%` }} />
                      </div>
                      <div className="mt-1 flex justify-between text-[10px] font-mono text-[#a98a7d]">
                        <span>{j.cedar_cleared_cells} cleared</span>
                        <span>{j.cedar_total_cells} total</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
