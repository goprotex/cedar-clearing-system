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
  clearedByJob: Record<string, string[]>;
  operators: Record<string, Array<{ user_id: string; lng: number; lat: number; heading: number | null; speed_mps: number | null; accuracy_m: number | null; updated_at: string }>>;
};

type OperatorPosition = BootstrapResponse['operators'][string][number];

/** Merge polled/local-operator positions with Supabase/bootstrap data; avoid duplicate markers when both exist. */
function mergeOperatorLists(prevList: OperatorPosition[], polled: OperatorPosition[] | undefined): OperatorPosition[] {
  if (!polled?.length) return prevList;
  const map = new Map<string, OperatorPosition>();
  for (const o of prevList) map.set(o.user_id, o);
  const prevHasRealUser = prevList.some((o) => o.user_id !== 'operator');
  const polledHasRealUser = polled.some((o) => o.user_id !== 'operator');
  for (const o of polled) {
    if (o.user_id === 'operator' && (prevHasRealUser || polledHasRealUser)) continue;
    map.set(o.user_id, o);
  }
  if (prevHasRealUser || polledHasRealUser) map.delete('operator');
  return Array.from(map.values());
}

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

function loadLocalJobs(): BootstrapJob[] {
  if (typeof window === 'undefined') return [];
  const results: BootstrapJob[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith('ccc_job_') || key.startsWith('ccc_job_bid_') || key.startsWith('ccc_job_events_') || key.startsWith('ccc_job_progress_')) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const job = JSON.parse(raw) as { id: string; bidId: string; title: string; status: string; createdAt: string; cedar_total_cells?: number; cedar_cleared_cells?: number };
      if (!job.id || !job.bidId) continue;

      // Load the bid snapshot for this job
      const bidRaw = localStorage.getItem(`ccc_job_bid_${job.bidId}`);
      if (!bidRaw) continue;
      const bid: Bid = JSON.parse(bidRaw);
      if (!bid.pastures?.length) continue;

      let cedarTotal = 0;
      for (const p of bid.pastures) {
        for (const f of (p.cedarAnalysis?.gridCells?.features ?? [])) {
          const cls = (f as { properties?: { classification?: string } }).properties?.classification;
          if (cls === 'cedar' || cls === 'oak' || cls === 'mixed_brush') cedarTotal++;
        }
      }

      results.push({
        id: job.id,
        title: job.title || `Job ${job.id}`,
        status: job.status || 'active',
        created_at: job.createdAt || new Date().toISOString(),
        bid_snapshot: bid,
        cedar_total_cells: cedarTotal,
        cedar_cleared_cells: job.cedar_cleared_cells ?? 0,
      });
    }
  } catch { /* localStorage may be unavailable */ }
  return results;
}

/** Jobs implied by operator GPS keys in localStorage (operate mode writes these even when no `ccc_job_*` exists). */
function loadJobsFromOperatorStorage(existingIds: Set<string>): BootstrapJob[] {
  if (typeof window === 'undefined') return [];
  const posPrefix = 'ccc_operator_pos_';
  const trailPrefix = 'ccc_operator_trail_';
  const out: BootstrapJob[] = [];
  const seen = new Set(existingIds);

  const tryAdd = (jobId: string) => {
    if (!jobId || seen.has(jobId)) return;
    const bidId = jobId.startsWith('job_') ? jobId.slice(4) : jobId;
    const bidRaw = localStorage.getItem(`ccc_bid_${bidId}`);
    if (!bidRaw) return;
    let bid: Bid;
    try {
      bid = JSON.parse(bidRaw) as Bid;
    } catch {
      return;
    }
    if (!bid.pastures?.length) return;

    let cedarTotal = 0;
    for (const p of bid.pastures) {
      for (const f of (p.cedarAnalysis?.gridCells?.features ?? [])) {
        const cls = (f as { properties?: { classification?: string } }).properties?.classification;
        if (cls === 'cedar' || cls === 'oak' || cls === 'mixed_brush') cedarTotal++;
      }
    }

    seen.add(jobId);
    out.push({
      id: jobId,
      title: `${bid.propertyName || 'Property'} — ${bid.bidNumber} (GPS)`,
      status: 'active',
      created_at: bid.updatedAt || bid.createdAt || new Date().toISOString(),
      bid_snapshot: bid,
      cedar_total_cells: cedarTotal,
      cedar_cleared_cells: 0,
    });
  };

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.startsWith(posPrefix)) {
        tryAdd(key.slice(posPrefix.length));
      } else if (key.startsWith(trailPrefix)) {
        tryAdd(key.slice(trailPrefix.length));
      }
    }
  } catch { /* ignore */ }

  return out;
}

export default function MonitorClient({ fullscreen: fullscreenProp }: { fullscreen?: boolean } = {}) {
  const [jobs, setJobs] = useState<BootstrapJob[]>([]);
  const [clearedByJob, setClearedByJob] = useState<Record<string, Set<string>>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [fullscreen, setFullscreen] = useState(Boolean(fullscreenProp));
  const [operatorsByJob, setOperatorsByJob] = useState<BootstrapResponse['operators']>({});
  const [trailsByJob, setTrailsByJob] = useState<Record<string, [number, number][]>>({});
  const [layersPanelOpen, setLayersPanelOpen] = useState(false);
  const [flyToJobId, setFlyToJobId] = useState<string | null>(null);

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
      // Hologram on → enable cedar + NDVI
      if (key === 'hologram' && !prev.hologram) {
        next.cedarAI = true;
        next.naipNDVI = true;
        next.naip = false;
        next.naipCIR = false;
      }
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
        for (const [jobId, cellIds] of Object.entries(data.clearedByJob ?? {})) {
          next[jobId] = new Set(cellIds);
        }
        setOperatorsByJob(data.operators ?? {});

        // If no remote jobs, load converted jobs from localStorage
        if (remoteJobs.length === 0) {
          remoteJobs = loadLocalJobs();
        }

        const mergedIds = new Set(remoteJobs.map((j) => j.id));
        remoteJobs = [...remoteJobs, ...loadJobsFromOperatorStorage(mergedIds)];

        setJobs(remoteJobs);
        setClearedByJob(next);
      } catch (e) {
        if (cancelled) return;
        // Fall back to local jobs
        const idSet = new Set<string>();
        let localJobs = loadLocalJobs();
        for (const j of localJobs) idSet.add(j.id);
        localJobs = [...localJobs, ...loadJobsFromOperatorStorage(idSet)];
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

  // Load operator cleared-cell sessions from localStorage.
  // Operate mode stores at ccc_operator_${bidId} (raw bid ID).
  // Job IDs are job_${bidId}, so we derive the bid ID to find the data.
  useEffect(() => {
    if (!jobs.length) return;
    const nextCleared: Record<string, Set<string>> = { ...clearedByJob };
    let changed = false;
    for (const job of jobs) {
      if (nextCleared[job.id]?.size) continue;
      // Derive bid ID from job ID (job_${bidId} → bidId)
      const bidId = job.id.startsWith('job_') ? job.id.slice(4) : job.id;
      for (const key of [`ccc_operator_${bidId}`, `ccc_operator_${job.id}`]) {
        try {
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          const data = JSON.parse(raw) as { clearedCellIds?: string[] };
          if (data.clearedCellIds?.length) {
            nextCleared[job.id] = new Set(data.clearedCellIds);
            changed = true;
            break;
          }
        } catch { /* ignore */ }
      }
    }
    if (changed) setClearedByJob(nextCleared);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);

  // Poll server-side API + localStorage for operator positions and trails
  useEffect(() => {
    if (!jobs.length) return;
    let cancelled = false;

    const poll = async () => {
      const jobIds = jobs.map((j) => j.id);
      const next: typeof operatorsByJob = {};
      const trails: Record<string, [number, number][]> = {};

      // 1. Try server-side store (works cross-device)
      try {
        const res = await fetch(`/api/local-operator?jobIds=${jobIds.join(',')}`, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json() as Record<string, { lng: number; lat: number; accuracy_m: number | null; heading_deg: number | null; speed_mps: number | null; timestamp: number; trail: [number, number][] }>;
          for (const [jobId, pos] of Object.entries(data)) {
            if (typeof pos.lng !== 'number' || typeof pos.lat !== 'number') continue;
            if (pos.timestamp && Date.now() - pos.timestamp > 5 * 60 * 1000) continue;
            next[jobId] = [{
              user_id: 'operator',
              lng: pos.lng, lat: pos.lat,
              heading: pos.heading_deg, speed_mps: pos.speed_mps, accuracy_m: pos.accuracy_m,
              updated_at: new Date(pos.timestamp).toISOString(),
            }];
            if (pos.trail?.length >= 2) trails[jobId] = pos.trail;
          }
        }
      } catch { /* server may be unavailable */ }

      // 2. Also check localStorage (same-device fallback)
      for (const job of jobs) {
        if (next[job.id]) continue;
        const bidId = job.id.startsWith('job_') ? job.id.slice(4) : job.id;
        for (const key of [`ccc_operator_pos_${job.id}`, `ccc_operator_pos_job_${bidId}`]) {
          try {
            const raw = localStorage.getItem(key);
            if (!raw) continue;
            const pos = JSON.parse(raw) as { lng: number; lat: number; accuracy_m: number | null; heading_deg: number | null; speed_mps: number | null; timestamp: number };
            if (typeof pos.lng !== 'number' || typeof pos.lat !== 'number') continue;
            if (pos.timestamp && Date.now() - pos.timestamp > 5 * 60 * 1000) continue;
            next[job.id] = [{
              user_id: 'operator',
              lng: pos.lng, lat: pos.lat,
              heading: pos.heading_deg, speed_mps: pos.speed_mps, accuracy_m: pos.accuracy_m,
              updated_at: new Date(pos.timestamp).toISOString(),
            }];
            break;
          } catch { /* ignore */ }
        }
        // Trail from localStorage
        if (!trails[job.id]) {
          const bidId2 = job.id.startsWith('job_') ? job.id.slice(4) : job.id;
          for (const key of [`ccc_operator_trail_${job.id}`, `ccc_operator_trail_job_${bidId2}`]) {
            try {
              const raw = localStorage.getItem(key);
              if (!raw) continue;
              const coords = JSON.parse(raw) as [number, number][];
              if (Array.isArray(coords) && coords.length >= 2) { trails[job.id] = coords; break; }
            } catch { /* ignore */ }
          }
        }
      }

      if (cancelled) return;
      setOperatorsByJob((prev) => {
        const merged = { ...prev };
        for (const [jobId, ops] of Object.entries(next)) {
          merged[jobId] = mergeOperatorLists(merged[jobId] ?? [], ops);
        }
        return merged;
      });
      setTrailsByJob(trails);
    };

    void poll();
    const interval = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(interval); };
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

    const applyOperatorRow = (payload: { new: Record<string, unknown> }) => {
      const row = payload.new as {
        job_id: string; user_id: string; lng: number; lat: number;
        heading?: number | null; speed_mps?: number | null; accuracy_m?: number | null; updated_at: string;
      } | null;
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
    };

    const filter = `job_id=in.(${jobIds.join(',')})`;
    const channel = supabase
      .channel(`monitor-ops-${jobIds.join('-').slice(0, 80)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'job_operator_positions', filter }, applyOperatorRow)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'job_operator_positions', filter }, applyOperatorRow)
      .subscribe();

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
    <div className={`bg-[#131313] text-[#e5e2e1] ${fullscreen ? 'fixed inset-0 z-[60] overflow-hidden' : 'min-h-screen'}`}>
      {!fullscreen && (
        <div className="flex justify-between items-end border-l-4 border-[#FF6B00] pl-4 mb-6">
          <div>
            <h1 className="text-4xl font-black uppercase tracking-tighter">SCOUT_MONITOR</h1>
            <p className="text-[#ffb693] text-xs font-mono">GLOBAL OPS // LIVE JOBS // WEATHER + HOLOGRAM</p>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-mono text-[#a98a7d]">ALL_JOBS_PROGRESS</div>
            <div className="text-sm font-black text-[#13ff43]">{totals.pct}%</div>
          </div>
        </div>
      )}

      {err && !fullscreen && (
        <div className="border border-red-500/50 bg-red-950/40 p-3 text-sm mb-4">{err}</div>
      )}

      <div className={fullscreen ? 'absolute inset-0' : 'flex flex-col lg:flex-row gap-6'}>
        <div className={fullscreen ? 'absolute inset-0' : 'flex-1 border-2 border-[#353534] relative'} style={fullscreen ? undefined : { minHeight: '70vh' }}>
          {mapboxToken ? (
            <MapboxMap
              accessToken={mapboxToken}
              jobs={jobs}
              clearedByJob={clearedByJob}
              operatorsByJob={operatorsByJob}
              trailsByJob={trailsByJob}
              radarOn={layers.radar}
              cedarOn={layers.cedarAI}
              layers={layers}
              flyToJobId={flyToJobId}
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
              <div className="text-sm text-[#a98a7d]">No jobs found. Convert a bid to a job from the bid editor first.</div>
            ) : (
              <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
                {jobs.map((j) => {
                  const p = pct(j.cedar_cleared_cells, j.cedar_total_cells);
                  return (
                    <button
                      key={j.id}
                      onClick={() => setFlyToJobId(j.id === flyToJobId ? null : j.id)}
                      className={`w-full text-left border p-3 transition-all ${
                        flyToJobId === j.id
                          ? 'border-[#13ff43] bg-[#13ff43]/5'
                          : 'border-[#353534] hover:border-[#a98a7d]'
                      }`}
                    >
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
                    </button>
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
