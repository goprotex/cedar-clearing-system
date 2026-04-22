'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { mergeJobsById, loadLocalStorageJobs, loadJobsFromOperatorStorage, type ActiveJobSummary } from '@/lib/active-jobs';
import { fetchApiAuthed } from '@/lib/auth-client';
import { createClient as createSupabaseClient } from '@/utils/supabase/client';
import {
  type OverlayLayerKey,
  defaultOverlayState,
  defaultOverlayOpacities,
} from '@/lib/map-layers';
import MapLayerPanel, {
  useOverlayActiveCount,
} from '@/components/map/MapLayerPanel';
import type { MonitorTelemetryRow } from '@/types/monitor-bootstrap';
import type { LayerKey } from './MonitorMap';

type BootstrapJob = ActiveJobSummary;

export type OperatorProfile = { display_name: string; email: string };
export type ActiveTimeEntry = { user_id: string; clock_in: string; job_id: string };
export type JobMember = { user_id: string; role: string };

type OperatorPosition = {
  user_id: string;
  lng: number;
  lat: number;
  heading: number | null;
  speed_mps: number | null;
  accuracy_m: number | null;
  updated_at: string;
};

/** Merge polled positions with existing state: newer timestamp wins; drop generic `operator` when a real user_id exists. */
function mergeOperatorsByJob(
  prev: Record<string, OperatorPosition[]>,
  polled: Record<string, OperatorPosition[]>,
): Record<string, OperatorPosition[]> {
  const out = { ...prev };
  for (const [jobId, incoming] of Object.entries(polled)) {
    if (incoming.length === 0) continue;
    const byUser = new Map<string, OperatorPosition>();
    for (const op of prev[jobId] ?? []) byUser.set(op.user_id, op);
    const prevHasRealUser = (prev[jobId] ?? []).some((o) => o.user_id !== 'operator');
    const polledHasRealUser = incoming.some((o) => o.user_id !== 'operator');
    for (const op of incoming) {
      if (op.user_id === 'operator' && (prevHasRealUser || polledHasRealUser)) continue;
      const cur = byUser.get(op.user_id);
      const nextTs = Date.parse(op.updated_at);
      const curTs = cur ? Date.parse(cur.updated_at) : NaN;
      if (!cur || (!Number.isNaN(nextTs) && (Number.isNaN(curTs) || nextTs >= curTs))) {
        byUser.set(op.user_id, op);
      }
    }
    if (prevHasRealUser || polledHasRealUser) byUser.delete('operator');
    out[jobId] = Array.from(byUser.values());
  }
  return out;
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

export default function MonitorClient({ fullscreen: fullscreenProp }: { fullscreen?: boolean } = {}) {
  const [jobs, setJobs] = useState<BootstrapJob[]>([]);
  const [clearedByJob, setClearedByJob] = useState<Record<string, Set<string>>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [fullscreen, setFullscreen] = useState(Boolean(fullscreenProp));

  // Optional TV layout: ?tv=1 or profile preference (signed-in)
  useEffect(() => {
    if (fullscreenProp) return;
    try {
      const tv = new URLSearchParams(window.location.search).get('tv');
      if (tv === '1' || tv === 'true') setFullscreen(true);
    } catch { /* ignore */ }
  }, [fullscreenProp]);

  useEffect(() => {
    if (fullscreenProp) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchApiAuthed('/api/settings');
        if (!res.ok) return;
        const data = (await res.json()) as { profile?: { preferences?: { monitor_tv_default?: boolean } } | null };
        if (cancelled) return;
        if (data.profile?.preferences?.monitor_tv_default) setFullscreen(true);
      } catch { /* not signed in or prefs missing */ }
    })();
    return () => { cancelled = true; };
  }, [fullscreenProp]);
  const [operatorsByJob, setOperatorsByJob] = useState<Record<string, OperatorPosition[]>>({});
  const [telemetryByJob, setTelemetryByJob] = useState<Record<string, MonitorTelemetryRow[]>>({});
  const [bootstrapScope, setBootstrapScope] = useState<'membership' | 'company' | null>(null);
  const [trailsByJob, setTrailsByJob] = useState<Record<string, [number, number][]>>({});
  const [layersPanelOpen, setLayersPanelOpen] = useState(false);
  const [flyToJobId, setFlyToJobId] = useState<string | null>(null);
  const [operatorProfiles, setOperatorProfiles] = useState<Record<string, OperatorProfile>>({});
  const [activeTimeEntries, setActiveTimeEntries] = useState<Record<string, ActiveTimeEntry[]>>({});
  const [membersByJob, setMembersByJob] = useState<Record<string, JobMember[]>>({});
  const [operateMode, setOperateMode] = useState(false);
  const [operateModeUserId, setOperateModeUserId] = useState<string | null>(null);
  const [autoRotate, setAutoRotate] = useState(false);

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
  const [opacities, setOpacities] = useState<Record<LayerKey, number>>({
    soil: 0.45,
    naip: 0.85,
    naipCIR: 0.85,
    naipNDVI: 0.75,
    terrain3d: 2.0,
    cedarAI: 0.7,
    radar: 0.65,
    pastures: 0.8,
    hologram: 1.0,
  });
  const [overlayLayers, setOverlayLayers] = useState<Record<OverlayLayerKey, boolean>>(defaultOverlayState);
  const [overlayOpacities, setOverlayOpacities] = useState<Record<OverlayLayerKey, number>>(defaultOverlayOpacities);
  const overlayActiveCount = useOverlayActiveCount(overlayLayers);
  const preHologramLayersRef = useRef<Record<LayerKey, boolean> | null>(null);

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';
  const supabaseRef = useRef<ReturnType<typeof createSupabaseClient> | null>(null);

  const toggleLayer = useCallback((key: LayerKey) => {
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
      // Hologram on → preserve current state and switch to the cinematic view.
      if (key === 'hologram' && !prev.hologram) {
        preHologramLayersRef.current = { ...prev };
        next.soil = true;
        next.terrain3d = true;
        next.cedarAI = false;
        next.naipNDVI = true;
        next.naip = false;
        next.naipCIR = false;
      }
      if (key === 'hologram' && prev.hologram) {
        const saved = preHologramLayersRef.current;
        if (saved) {
          preHologramLayersRef.current = null;
          return { ...saved, hologram: false };
        }
      }
      next[key] = !prev[key];
      return next;
    });
    if (key === 'hologram') {
      setAutoRotate(false);
    }
  }, []);

  const toggleOverlay = useCallback((key: OverlayLayerKey) => {
    setOverlayLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const setOverlayOpacity = useCallback((key: OverlayLayerKey, value: number) => {
    setOverlayOpacities((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Bootstrap: try remote first, fall back to local bids
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setBusy(true);
        setErr(null);
        const res = await fetchApiAuthed('/api/monitor/bootstrap');
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as {
          jobs: BootstrapJob[];
          clearedByJob: Record<string, string[]>;
          operatorsByJob: Record<string, OperatorPosition[]>;
          telemetryByJob?: Record<string, MonitorTelemetryRow[]>;
          operatorProfiles?: Record<string, OperatorProfile>;
          activeTimeEntries?: Record<string, ActiveTimeEntry[]>;
          membersByJob?: Record<string, JobMember[]>;
          scope?: 'membership' | 'company';
        };
        if (cancelled) return;

        let remoteJobs = data.jobs ?? [];
        const localStored = loadLocalStorageJobs();
        if (localStored.length > 0) {
          remoteJobs = mergeJobsById(remoteJobs, localStored);
        } else if (remoteJobs.length === 0) {
          remoteJobs = loadLocalStorageJobs();
        }
        const next: Record<string, Set<string>> = {};
        for (const [jobId, cellIds] of Object.entries(data.clearedByJob ?? {})) {
          next[jobId] = new Set(cellIds);
        }
        setOperatorsByJob(data.operatorsByJob ?? {});
        setTelemetryByJob(data.telemetryByJob ?? {});
        setBootstrapScope(data.scope ?? 'membership');
        setOperatorProfiles(data.operatorProfiles ?? {});
        setActiveTimeEntries(data.activeTimeEntries ?? {});
        setMembersByJob(data.membersByJob ?? {});

        const mergedIds = new Set(remoteJobs.map((j) => j.id));
        remoteJobs = [...remoteJobs, ...loadJobsFromOperatorStorage(mergedIds)];

        setJobs(remoteJobs);
        setClearedByJob(next);
      } catch (e) {
        if (cancelled) return;
        // Fall back to local jobs
        const idSet = new Set<string>();
        let localJobs = loadLocalStorageJobs();
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
      setOperatorsByJob((prev) => mergeOperatorsByJob(prev, next));
      // Merge trails: only update entries that have fresh data, keep existing trails if poll returns nothing.
      // Requires at least 2 points since a GeoJSON LineString must have 2+ coordinates.
      if (Object.keys(trails).length > 0) {
        setTrailsByJob(prev => {
          const merged = { ...prev };
          for (const [jobId, coords] of Object.entries(trails)) {
            if (coords.length >= 2) merged[jobId] = coords;
          }
          return merged;
        });
      }
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
        (payload: { new: Record<string, unknown> }) => {
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
        job_id?: string; user_id?: string; lng?: number; lat?: number;
        heading?: number | null; heading_deg?: number | null;
        speed_mps?: number | null; accuracy_m?: number | null; updated_at?: string;
      } | null;
      if (!row || typeof row.job_id !== 'string' || typeof row.user_id !== 'string' || typeof row.lng !== 'number' || typeof row.lat !== 'number') return;
      const jobId = row.job_id;
      const userId = row.user_id;
      const lng = row.lng;
      const lat = row.lat;
      const heading =
        typeof row.heading === 'number' ? row.heading
          : typeof row.heading_deg === 'number' ? row.heading_deg : null;
      setOperatorsByJob((prev) => {
        const next = { ...prev };
        const arr = next[jobId] ? [...next[jobId]] : [];
        const idx = arr.findIndex((o) => o.user_id === userId);
        const entry: OperatorPosition = {
          user_id: userId,
          lng,
          lat,
          heading,
          speed_mps: typeof row.speed_mps === 'number' ? row.speed_mps : null,
          accuracy_m: typeof row.accuracy_m === 'number' ? row.accuracy_m : null,
          updated_at: typeof row.updated_at === 'string' ? row.updated_at : new Date().toISOString(),
        };
        if (idx >= 0) arr[idx] = entry; else arr.push(entry);
        next[jobId] = arr;
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

  // Realtime: job telemetry (future machine/engine stats — table may be empty until wired)
  useEffect(() => {
    if (!jobs.length) return;
    const supabase = (supabaseRef.current ??= createSupabaseClient());
    const jobIds = jobs.map((j) => j.id).filter(Boolean);
    if (!jobIds.length) return;

    const applyTelemetryRow = (payload: { new: Record<string, unknown> }) => {
      const row = payload.new as {
        job_id?: string;
        source_key?: string;
        kind?: string;
        data?: Record<string, unknown>;
        updated_at?: string;
      } | null;
      if (!row || typeof row.job_id !== 'string') return;
      const jobId = row.job_id;
      const entry: MonitorTelemetryRow = {
        source_key: typeof row.source_key === 'string' ? row.source_key : 'default',
        kind: (row.kind === 'machine' || row.kind === 'engine' || row.kind === 'progress' || row.kind === 'custom')
          ? row.kind
          : 'custom',
        data: row.data && typeof row.data === 'object' ? row.data : {},
        updated_at: typeof row.updated_at === 'string' ? row.updated_at : new Date().toISOString(),
      };
      setTelemetryByJob((prev) => {
        const next = { ...prev };
        const list = [...(next[jobId] ?? [])];
        const sk = entry.source_key;
        const i = list.findIndex((t) => t.source_key === sk);
        if (i >= 0) list[i] = entry; else list.push(entry);
        next[jobId] = list;
        return next;
      });
    };

    const filter = `job_id=in.(${jobIds.join(',')})`;
    const channel = supabase
      .channel(`monitor-telem-${jobIds.join('-').slice(0, 72)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'job_telemetry_latest', filter }, applyTelemetryRow)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'job_telemetry_latest', filter }, applyTelemetryRow)
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [jobs]);

  const totals = useMemo(() => {
    const total = jobs.reduce((s, j) => s + (j.cedar_total_cells ?? 0), 0);
    const cleared = jobs.reduce((s, j) => {
      const fromMap = clearedByJob[j.id]?.size ?? 0;
      return s + Math.max(fromMap, j.cedar_cleared_cells ?? 0);
    }, 0);
    return { total, cleared, pct: pct(cleared, total) };
  }, [jobs, clearedByJob]);

  // Clock-in handler: triggers operate mode
  const [clockingIn, setClockingIn] = useState(false);
  const handleClockIn = useCallback(async (jobId: string) => {
    try {
      setClockingIn(true);
      // Try to clock in via API
      const res = await fetchApiAuthed(`/api/jobs/${jobId}/time-entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });
      if (res.ok) {
        const data = await res.json() as { timeEntry?: { operator_id?: string; clock_in?: string } };
        const userId = data.timeEntry?.operator_id;
        if (userId) {
          setOperateModeUserId(userId);
          setOperateMode(true);
          setFullscreen(true);
          setFlyToJobId(jobId);
          // Update activeTimeEntries locally
          if (data.timeEntry?.clock_in) {
            setActiveTimeEntries(prev => ({
              ...prev,
              [jobId]: [...(prev[jobId] ?? []), { user_id: userId, clock_in: data.timeEntry!.clock_in!, job_id: jobId }],
            }));
          }
        }
      } else {
        const errData = await res.json().catch(() => ({ error: `Clock-in failed (status: ${res.status})` })) as { error?: string };
        // If already clocked in (409), still enter operate mode
        if (res.status === 409) {
          // Find existing time entry for this user
          const entries = activeTimeEntries[jobId] ?? [];
          const existingUserId = entries[0]?.user_id;
          if (existingUserId) {
            setOperateModeUserId(existingUserId);
          }
          setOperateMode(true);
          setFullscreen(true);
          setFlyToJobId(jobId);
        } else {
          alert(errData.error || 'Failed to clock in');
        }
      }
    } catch (e) {
      // Fallback: enter operate mode locally without API
      setOperateMode(true);
      setFullscreen(true);
      setFlyToJobId(jobId);
    } finally {
      setClockingIn(false);
    }
  }, [activeTimeEntries]);

  const handleExitOperateMode = useCallback(() => {
    setOperateMode(false);
    setOperateModeUserId(null);
    setFullscreen(false);
  }, []);

  return (
    <div className={`bg-[#131313] text-[#e5e2e1] ${fullscreen ? 'fixed inset-0 z-[60] overflow-hidden' : 'min-h-screen'}`}>
      {!fullscreen && (
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-3 border-l-4 border-[#FF6B00] pl-3 sm:pl-4 mb-6 min-w-0">
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-4xl font-black uppercase tracking-tighter">LIVE_MONITOR</h1>
            <p className="text-[#ffb693] text-[10px] sm:text-xs font-mono break-words">GLOBAL OPS // LIVE JOBS // WEATHER + HOLOGRAM</p>
            {bootstrapScope === 'company' && (
              <p className="text-[9px] font-mono text-[#13ff43]/80 mt-1">COMPANY_SCOPE — ALL COMPANY JOBS</p>
            )}
          </div>
          <div className="text-left sm:text-right shrink-0">
            <div className="text-[10px] font-mono text-[#a98a7d]">ALL_JOBS_PROGRESS</div>
            <div className="text-2xl sm:text-3xl font-black text-[#13ff43] tabular-nums">{totals.pct}%</div>
          </div>
        </div>
      )}

      {err && !fullscreen && (
        <div className="border border-red-500/50 bg-red-950/40 p-3 text-sm mb-4">{err}</div>
      )}

      <div className={fullscreen ? 'absolute inset-0' : 'flex flex-col lg:flex-row gap-6'}>
        <div
          className={
            fullscreen
              ? 'absolute inset-0'
              : 'flex-1 border-2 border-[#353534] relative min-h-0 h-[min(70vh,720px)]'
          }
        >
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
              opacities={opacities}
              overlayLayers={overlayLayers}
              overlayOpacities={overlayOpacities}
              flyToJobId={flyToJobId}
              operatorProfiles={operatorProfiles}
              activeTimeEntries={activeTimeEntries}
              membersByJob={membersByJob}
              operateMode={operateMode}
              operateModeUserId={operateModeUserId}
              autoRotate={autoRotate}
            />
          ) : (
            <div className="w-full h-full min-h-[min(70vh,720px)] bg-[#0e0e0e] flex items-center justify-center text-[#a98a7d] px-4">
              <div className="text-center space-y-2 border-2 border-[#353534] p-4 sm:p-8 max-w-lg">
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
          <div className="absolute bottom-[max(1rem,env(safe-area-inset-bottom,0px))] left-[max(1rem,env(safe-area-inset-left,0px))] z-10 max-w-[calc(100vw-2rem)]">
            {layersPanelOpen ? (
              <MapLayerPanel
                open={layersPanelOpen}
                onClose={() => setLayersPanelOpen(false)}
                overlayLayers={overlayLayers}
                overlayOpacities={overlayOpacities}
                onToggleOverlay={toggleOverlay}
                onOverlayOpacity={setOverlayOpacity}
                holoMode={layers.hologram}
                legacyGroups={[
                  {
                    category: 'imagery',
                    label: 'Imagery',
                    emoji: '📡',
                    layers: [
                      { key: 'soil', label: 'Soil Map', emoji: '🟫', active: layers.soil, opacity: opacities.soil, onToggle: () => toggleLayer('soil'), onOpacity: (v) => setOpacities((p) => ({ ...p, soil: v })) },
                      { key: 'naip', label: 'RGB (Hi-Res)', emoji: '🛰️', active: layers.naip, opacity: opacities.naip, onToggle: () => toggleLayer('naip'), onOpacity: (v) => setOpacities((p) => ({ ...p, naip: v })) },
                      { key: 'naipCIR', label: 'CIR (False Color)', emoji: '🔴', active: layers.naipCIR, opacity: opacities.naipCIR, onToggle: () => toggleLayer('naipCIR'), onOpacity: (v) => setOpacities((p) => ({ ...p, naipCIR: v })) },
                      { key: 'naipNDVI', label: 'NDVI', emoji: '🌿', active: layers.naipNDVI, opacity: opacities.naipNDVI, onToggle: () => toggleLayer('naipNDVI'), onOpacity: (v) => setOpacities((p) => ({ ...p, naipNDVI: v })) },
                    ],
                  },
                  {
                    category: 'analysis',
                    label: 'Analysis',
                    emoji: '🔬',
                    layers: [
                      { key: 'cedarAI', label: 'AI Cedar', emoji: '🤖', active: layers.cedarAI, opacity: opacities.cedarAI, onToggle: () => toggleLayer('cedarAI'), onOpacity: (v) => setOpacities((p) => ({ ...p, cedarAI: v })) },
                      { key: 'terrain3d', label: '3D Terrain', emoji: '⛰️', active: layers.terrain3d, opacity: opacities.terrain3d, opacityRange: [0.5, 2.5] as [number, number], opacityStep: 0.1, onToggle: () => toggleLayer('terrain3d'), onOpacity: (v) => setOpacities((p) => ({ ...p, terrain3d: v })) },
                      { key: 'hologram', label: 'Hologram', emoji: '🔮', active: layers.hologram, opacity: opacities.hologram, onToggle: () => toggleLayer('hologram'), onOpacity: (v) => setOpacities((p) => ({ ...p, hologram: v })) },
                    ],
                  },
                  {
                    category: 'operations',
                    label: 'Operations',
                    emoji: '📍',
                    layers: [
                      { key: 'pastures', label: 'Pastures', emoji: '🟩', active: layers.pastures, opacity: opacities.pastures, onToggle: () => toggleLayer('pastures'), onOpacity: (v) => setOpacities((p) => ({ ...p, pastures: v })) },
                      { key: 'radar', label: 'Radar', emoji: '🌧️', active: layers.radar, opacity: opacities.radar, onToggle: () => toggleLayer('radar'), onOpacity: (v) => setOpacities((p) => ({ ...p, radar: v })) },
                    ],
                  },
                ]}
              >
                <div className={`px-2 pb-2 pt-1 border-t ${layers.hologram ? 'border-green-800/50' : 'border-slate-700/60'}`}>
                  <button
                    onClick={() => setAutoRotate(v => !v)}
                    className={`w-full text-left px-2 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 ${
                      autoRotate
                        ? layers.hologram
                          ? 'bg-green-700/50 text-green-100 shadow-[0_0_6px_rgba(0,255,65,0.2)]'
                          : 'bg-orange-600 text-white'
                        : layers.hologram
                          ? 'text-green-300/60 hover:bg-green-900/30 hover:text-green-200'
                          : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
                    }`}
                    title={autoRotate ? 'Auto-rotation ON (zoom/pan disabled)' : 'Enable auto-rotation (disables zoom/pan)'}
                  >
                    <span className="mr-2">🔄</span>
                    Auto-Rotate
                    {autoRotate && <span className="float-right text-[9px] opacity-60">ON</span>}
                  </button>
                </div>
              </MapLayerPanel>
            ) : (
              <button
                onClick={() => setLayersPanelOpen(true)}
                className="backdrop-blur rounded-lg shadow-lg px-3 py-2 text-xs font-medium bg-slate-900/90 text-slate-300 hover:text-white transition-colors"
              >
                Layers{overlayActiveCount > 0 && ` (${overlayActiveCount})`}
              </button>
            )}
          </div>

          {/* Fullscreen TV / Operate Mode overlay */}
          {fullscreen && (
            <div className="absolute top-[max(0.75rem,env(safe-area-inset-top,0px))] left-[max(0.75rem,env(safe-area-inset-left,0px))] z-20 holo-panel backdrop-blur-sm rounded-lg px-3 sm:px-4 py-2 sm:py-3 space-y-2 max-w-[calc(100vw-2rem)]">
              <div className="text-[10px] text-[#00ff41] font-bold uppercase tracking-widest">
                {operateMode ? 'OPERATE MODE' : 'Live Monitor'}
              </div>
              {operateMode && operateModeUserId && (
                <div className="text-[10px] font-mono text-[#FF6B00]">
                  🔶 {operatorProfiles[operateModeUserId]?.display_name || operateModeUserId}
                </div>
              )}
              <div className="flex items-center gap-3">
                <div className="text-xs font-mono text-[#a98a7d]">ALL_JOBS</div>
                <div className="text-xl font-black text-[#13ff43] tabular-nums">{totals.pct}%</div>
                <div className="text-[10px] font-mono text-[#a98a7d] tabular-nums">{totals.cleared}/{totals.total}</div>
              </div>
              <div className="flex items-center gap-2">
                {operateMode ? (
                  <button onClick={handleExitOperateMode} className="px-3 py-2 rounded bg-red-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-red-500 transition-all">
                    EXIT_OPERATE
                  </button>
                ) : (
                  <button onClick={() => setFullscreen(false)} className="px-3 py-2 rounded bg-[#FF6B00] text-black text-[10px] font-black uppercase tracking-widest hover:bg-white transition-all">
                    EXIT_FULL
                  </button>
                )}
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

          {/* Clock-in / Operate Mode section */}
          {jobs.length > 0 && (
            <div className="border-2 border-[#FF6B00]/50 p-4 space-y-3">
              <div className="text-[10px] text-[#FF6B00] font-bold uppercase tracking-widest">OPERATE MODE</div>
              <p className="text-[10px] font-mono text-[#a98a7d]">Clock in to enter operate mode — map will center on you in 3D terrain with slow rotation.</p>
              <div className="space-y-2">
                {jobs.map((j) => (
                  <div key={`op-${j.id}`} className="flex items-center justify-between gap-2">
                    <span className="text-xs font-mono text-[#e5e2e1] truncate flex-1">{j.title}</span>
                    <button
                      disabled={clockingIn}
                      onClick={() => handleClockIn(j.id)}
                      className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest border border-[#FF6B00] text-[#FF6B00] hover:bg-[#FF6B00] hover:text-black transition-all disabled:opacity-50"
                    >
                      {clockingIn ? '…' : 'CLOCK IN'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

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
                  const clearedCount = Math.max(clearedByJob[j.id]?.size ?? 0, j.cedar_cleared_cells ?? 0);
                  const p = pct(clearedCount, j.cedar_total_cells);
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
                        <span>{clearedCount} cleared</span>
                        <span>{j.cedar_total_cells} total</span>
                      </div>
                      {telemetryByJob[j.id]?.length ? (
                        <div className="mt-1 text-[9px] font-mono text-[#5a4136] border-t border-[#353534] pt-1">
                          Telemetry ({telemetryByJob[j.id].length}):{' '}
                          {telemetryByJob[j.id].map((t) => t.kind).join(', ')}
                        </div>
                      ) : null}
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
