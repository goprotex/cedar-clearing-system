'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { Bid } from '@/types';
import { createClient as createSupabaseClient } from '@/utils/supabase/client';

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

export default function MonitorClient({ fullscreen: fullscreenProp }: { fullscreen?: boolean } = {}) {
  const [jobs, setJobs] = useState<BootstrapJob[]>([]);
  const [clearedByJob, setClearedByJob] = useState<Record<string, Set<string>>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [radarOn, setRadarOn] = useState(true);
  const [cedarOn, setCedarOn] = useState(true);
  const [fullscreen, setFullscreen] = useState(Boolean(fullscreenProp));
  const [operatorsByJob, setOperatorsByJob] = useState<BootstrapResponse['operators']>({});

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';
  const supabaseRef = useRef<ReturnType<typeof createSupabaseClient> | null>(null);

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
        setJobs(data.jobs ?? []);
        const next: Record<string, Set<string>> = {};
        for (const [jobId, cellIds] of Object.entries(data.cleared ?? {})) {
          next[jobId] = new Set(cellIds);
        }
        setClearedByJob(next);
        setOperatorsByJob(data.operators ?? {});
      } catch (e) {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Realtime: subscribe to job_cleared_cells inserts and update the map + counters.
  useEffect(() => {
    if (!jobs.length) return;
    const supabase = (supabaseRef.current ??= createSupabaseClient());
    const jobIds = jobs.map((j) => j.id);

    const channel = supabase
      .channel('monitor-job-cleared-cells')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'job_cleared_cells',
          filter: `job_id=in.(${jobIds.join(',')})`,
        },
        (payload) => {
          const row = payload.new as { job_id?: string; cell_id?: string } | null;
          if (typeof row?.job_id !== 'string' || typeof row?.cell_id !== 'string') return;
          const jobId = row.job_id;
          const cellId = row.cell_id;

          setClearedByJob((prev) => {
            const next = { ...prev };
            const existing = next[jobId];
            const set = new Set(existing ? Array.from(existing) : []);
            if (set.has(cellId)) return prev;
            set.add(cellId);
            next[jobId] = set;
            return next;
          });
          setJobs((prev) =>
            prev.map((j) =>
              j.id === jobId
                ? { ...j, cedar_cleared_cells: Math.min(j.cedar_total_cells, j.cedar_cleared_cells + 1) }
                : j
            )
          );
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [jobs]);

  // Realtime: operator position updates
  useEffect(() => {
    if (!jobs.length) return;
    const supabase = (supabaseRef.current ??= createSupabaseClient());
    const jobIds = jobs.map((j) => j.id).filter(Boolean);
    if (!jobIds.length) return;

    const channel = supabase
      .channel(`monitor-ops-${jobIds.join('-').slice(0, 80)}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'job_operator_positions',
          filter: `job_id=in.(${jobIds.join(',')})`,
        },
        (payload) => {
          const row = payload.new as { job_id: string; user_id: string; lng: number; lat: number; heading: number | null; speed_mps: number | null; accuracy_m: number | null; updated_at: string } | null;
          if (!row) return;
          if (typeof row.job_id !== 'string' || typeof row.user_id !== 'string') return;
          if (typeof row.lng !== 'number' || typeof row.lat !== 'number') return;
          if (typeof row.updated_at !== 'string') return;
          setOperatorsByJob((prev) => {
            const next = { ...prev };
            const jobId = row.job_id;
            const userId = row.user_id;
            const existing = next[jobId];
            const arr = existing ? [...existing] : [];
            const idx = arr.findIndex((o) => o.user_id === userId);
            const entry: OperatorPosition = {
              user_id: userId,
              lng: row.lng,
              lat: row.lat,
              heading: typeof row.heading === 'number' ? row.heading : null,
              speed_mps: typeof row.speed_mps === 'number' ? row.speed_mps : null,
              accuracy_m: typeof row.accuracy_m === 'number' ? row.accuracy_m : null,
              updated_at: row.updated_at,
            };
            if (idx >= 0) arr[idx] = entry; else arr.push(entry);
            next[jobId] = arr;
            return next;
          });
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [jobs]);

  const totals = useMemo(() => {
    const total = jobs.reduce((s, j) => s + (j.cedar_total_cells ?? 0), 0);
    const cleared = jobs.reduce((s, j) => s + (j.cedar_cleared_cells ?? 0), 0);
    return { total, cleared, pct: pct(cleared, total) };
  }, [jobs]);

  return (
    <div className={`min-h-screen bg-[#131313] text-[#e5e2e1] ${fullscreen ? 'fixed inset-0 z-[60] p-0 overflow-hidden' : ''}`}>
      <div className={`${fullscreen ? 'hidden' : 'flex'} justify-between items-end border-l-4 border-[#FF6B00] pl-4 mb-6`}>
        <div>
          <h1 className="text-4xl font-black uppercase tracking-tighter">SCOUT_MONITOR</h1>
          <p className="text-[#ffb693] text-xs font-mono">
            GLOBAL OPS // LIVE JOBS // WEATHER + HOLOGRAM
          </p>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-mono text-[#a98a7d]">ALL_JOBS_PROGRESS</div>
          <div className="text-sm font-black text-[#13ff43]">{totals.pct}%</div>
        </div>
      </div>

      {err && (
        <div className="border border-red-500/50 bg-red-950/40 p-3 text-sm mb-4">
          {err}
        </div>
      )}

      <div className={`flex ${fullscreen ? 'flex-col' : 'flex-col lg:flex-row'} gap-6 ${fullscreen ? 'h-full' : ''}`}>
        <div className={`flex-1 border-2 border-[#353534] relative ${fullscreen ? 'h-full' : ''}`} style={fullscreen ? undefined : { minHeight: '70vh' }}>
          {mapboxToken ? (
            <MapboxMap
              accessToken={mapboxToken}
              jobs={jobs}
              clearedByJob={clearedByJob}
              operatorsByJob={operatorsByJob}
              radarOn={radarOn}
              cedarOn={cedarOn}
            />
          ) : (
            <div className="w-full h-full min-h-[70vh] bg-[#0e0e0e] flex items-center justify-center text-[#a98a7d]">
              <div className="text-center space-y-2 border-2 border-[#353534] p-8">
                <p className="text-lg font-black uppercase tracking-tighter">SATELLITE_FEED_OFFLINE</p>
                <p className="text-sm font-mono">
                  Add <code className="bg-[#353534] px-1.5 py-0.5 text-[#FF6B00]">NEXT_PUBLIC_MAPBOX_TOKEN</code> to your{' '}
                  <code className="bg-[#353534] px-1.5 py-0.5 text-[#FF6B00]">.env.local</code> file
                </p>
              </div>
            </div>
          )}
          {busy && (
            <div className="absolute inset-0 bg-black/30 flex items-center justify-center text-xs font-mono text-[#a98a7d]">
              LOADING_JOBS…
            </div>
          )}

          {/* TV overlay */}
          {fullscreen && (
            <div className="absolute top-3 left-3 z-20 holo-panel backdrop-blur-sm rounded-lg px-4 py-3 space-y-2">
              <div className="text-[10px] text-[#00ff41] font-bold uppercase tracking-widest">Office Monitor</div>
              <div className="flex items-center gap-3">
                <div className="text-xs font-mono text-[#a98a7d]">ALL_JOBS</div>
                <div className="text-xl font-black text-[#13ff43] tabular-nums">{totals.pct}%</div>
                <div className="text-[10px] font-mono text-[#a98a7d] tabular-nums">
                  {totals.cleared}/{totals.total}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setRadarOn((v) => !v)}
                  className="holo-button px-3 py-2 rounded text-[10px] font-bold uppercase tracking-widest"
                >
                  RADAR {radarOn ? 'ON' : 'OFF'}
                </button>
                <button
                  onClick={() => setCedarOn((v) => !v)}
                  className="holo-button px-3 py-2 rounded text-[10px] font-bold uppercase tracking-widest"
                >
                  CEDAR {cedarOn ? 'ON' : 'OFF'}
                </button>
                <button
                  onClick={() => setFullscreen(false)}
                  className="px-3 py-2 rounded bg-[#FF6B00] text-black text-[10px] font-black uppercase tracking-widest hover:bg-white transition-all"
                >
                  EXIT_FULL
                </button>
              </div>
            </div>
          )}
        </div>

        <div className={`w-full lg:w-96 shrink-0 space-y-4 ${fullscreen ? 'hidden' : ''}`}>
          <div className="border-2 border-[#353534] p-4 space-y-3">
            <div className="text-[10px] text-[#a98a7d] font-bold uppercase tracking-widest">LAYERS</div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-[#e5e2e1]">WEATHER_RADAR</span>
              <button
                onClick={() => setRadarOn((v) => !v)}
                className={`px-3 py-1 text-[10px] font-bold uppercase tracking-widest border ${
                  radarOn ? 'border-[#13ff43] text-[#13ff43]' : 'border-[#353534] text-[#a98a7d]'
                }`}
              >
                {radarOn ? 'ON' : 'OFF'}
              </button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-[#e5e2e1]">CEDAR_HOLOGRAM</span>
              <button
                onClick={() => setCedarOn((v) => !v)}
                className={`px-3 py-1 text-[10px] font-bold uppercase tracking-widest border ${
                  cedarOn ? 'border-[#FF6B00] text-[#FFB693]' : 'border-[#353534] text-[#a98a7d]'
                }`}
              >
                {cedarOn ? 'ON' : 'OFF'}
              </button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-[#e5e2e1]">FULLSCREEN_TV</span>
              <button
                onClick={() => setFullscreen(true)}
                className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest border border-[#13ff43] text-[#13ff43] hover:bg-[#13ff43] hover:text-black transition-all"
              >
                LAUNCH
              </button>
            </div>
          </div>

          <div className="border-2 border-[#353534] p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] text-[#a98a7d] font-bold uppercase tracking-widest">
                ACTIVE_JOBS ({jobs.length})
              </div>
              <div className="text-[10px] font-mono text-[#a98a7d]">
                {totals.cleared}/{totals.total} CELLS
              </div>
            </div>

            {jobs.length === 0 ? (
              <div className="text-sm text-[#a98a7d]">No jobs found (or you’re not signed in).</div>
            ) : (
              <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
                {jobs.map((j) => {
                  const p = pct(j.cedar_cleared_cells, j.cedar_total_cells);
                  return (
                    <div key={j.id} className="border border-[#353534] p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-xs font-black truncate">{j.title}</div>
                          <div className="text-[10px] font-mono text-[#a98a7d] truncate">{j.id}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[10px] text-[#a98a7d] font-mono">{j.status}</div>
                          <div className="text-xs font-black text-[#13ff43]">{p}%</div>
                        </div>
                      </div>
                      <div className="mt-2 w-full h-2 bg-[#353534] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-[#13ff43] to-[#00cc33]"
                          style={{ width: `${p}%` }}
                        />
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

