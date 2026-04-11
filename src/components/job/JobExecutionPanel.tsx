'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Pasture } from '@/types';
import {
  loadLocalWorkOrders,
  saveLocalWorkOrders,
  loadLocalTimeEntries,
  saveLocalTimeEntries,
  loadLocalGpsTracks,
  saveLocalGpsTracks,
  loadLocalSchedule,
  saveLocalSchedule,
  type LocalWorkOrder,
  type LocalTimeEntry,
  type LocalGpsTrack,
  type LocalScheduleBlock,
} from '@/lib/job-execution-local';

type WoRow = {
  id: string;
  pasture_id: string;
  pasture_name: string;
  instructions: string;
  status: string;
  sort_order: number;
};

type TeRow = {
  id: string;
  clock_in: string;
  clock_out: string | null;
  hours_manual: number | null;
  notes: string | null;
};

type GpsRow = {
  id: string;
  started_at: string;
  distance_m: number | null;
  area_acres_estimate: number | null;
  points: unknown;
};

type SchRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  title: string;
  notes: string | null;
};

function newId() {
  return `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function pasturesFromBid(bid: { pastures?: Pasture[] } | null | undefined): Pasture[] {
  return bid?.pastures ?? [];
}

export default function JobExecutionPanel({
  jobId,
  isRemote,
  bidSnapshot,
}: {
  jobId: string;
  isRemote: boolean;
  bidSnapshot: { pastures?: Pasture[] } | null;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [workOrders, setWorkOrders] = useState<WoRow[]>([]);
  const [timeEntries, setTimeEntries] = useState<TeRow[]>([]);
  const [gpsTracks, setGpsTracks] = useState<GpsRow[]>([]);
  const [scheduleBlocks, setScheduleBlocks] = useState<SchRow[]>([]);

  const [woPastureId, setWoPastureId] = useState('');
  const [woName, setWoName] = useState('');
  const [woInstructions, setWoInstructions] = useState('');

  const [manualHours, setManualHours] = useState('');
  const [timeNotes, setTimeNotes] = useState('');

  const [schStart, setSchStart] = useState('');
  const [schEnd, setSchEnd] = useState('');
  const [schTitle, setSchTitle] = useState('');

  const loadLocal = useCallback(() => {
    setWorkOrders(
      loadLocalWorkOrders(jobId).map((w) => ({
        id: w.id,
        pasture_id: w.pasture_id,
        pasture_name: w.pasture_name,
        instructions: w.instructions,
        status: w.status,
        sort_order: w.sort_order,
      })),
    );
    setTimeEntries(
      loadLocalTimeEntries(jobId).map((t) => ({
        id: t.id,
        clock_in: t.clock_in,
        clock_out: t.clock_out,
        hours_manual: t.hours_manual,
        notes: t.notes,
      })),
    );
    setGpsTracks(
      loadLocalGpsTracks(jobId).map((g) => ({
        id: g.id,
        started_at: g.started_at,
        distance_m: null,
        area_acres_estimate: g.area_acres_estimate,
        points: g.points,
      })),
    );
    setScheduleBlocks(
      loadLocalSchedule(jobId).map((s) => ({
        id: s.id,
        starts_at: s.starts_at,
        ends_at: s.ends_at,
        title: s.title,
        notes: s.notes,
      })),
    );
  }, [jobId]);

  const loadRemote = useCallback(async () => {
    const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/execution`, {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!res.ok) throw new Error(await res.text());
    const data = (await res.json()) as {
      workOrders: WoRow[];
      timeEntries: TeRow[];
      gpsTracks: GpsRow[];
      scheduleBlocks: SchRow[];
    };
    setWorkOrders(data.workOrders ?? []);
    setTimeEntries(data.timeEntries ?? []);
    setGpsTracks(data.gpsTracks ?? []);
    setScheduleBlocks(data.scheduleBlocks ?? []);
  }, [jobId]);

  useEffect(() => {
    if (!isRemote) {
      loadLocal();
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        setBusy(true);
        setErr(null);
        await loadRemote();
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isRemote, loadLocal, loadRemote]);

  const activeClock = timeEntries.find((t) => !t.clock_out && t.hours_manual == null);

  const refresh = async () => {
    if (isRemote) await loadRemote();
    else loadLocal();
  };

  const addWorkOrder = async () => {
    const name = woName.trim() || 'Pasture';
    const pid = woPastureId.trim();
    const instructions = woInstructions.trim();
    if (!instructions && !name) return;
    setErr(null);
    if (isRemote) {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/work-orders`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pasture_id: pid,
          pasture_name: name,
          instructions,
          sort_order: workOrders.length,
        }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? res.statusText);
    } else {
      const row: LocalWorkOrder = {
        id: newId(),
        job_id: jobId,
        pasture_id: pid,
        pasture_name: name,
        instructions,
        status: 'pending',
        sort_order: workOrders.length,
        created_at: new Date().toISOString(),
      };
      saveLocalWorkOrders(jobId, [...loadLocalWorkOrders(jobId), row]);
    }
    setWoName('');
    setWoPastureId('');
    setWoInstructions('');
    await refresh();
  };

  const patchWo = async (id: string, patch: Partial<{ status: string; instructions: string }>) => {
    if (isRemote) {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/work-orders/${id}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? res.statusText);
    } else {
      const allowed = new Set(['pending', 'in_progress', 'done', 'skipped']);
      const rows = loadLocalWorkOrders(jobId).map((w) => {
        if (w.id !== id) return w;
        const next = { ...w };
        if (typeof patch.instructions === 'string') next.instructions = patch.instructions;
        if (typeof patch.status === 'string' && allowed.has(patch.status)) {
          next.status = patch.status as LocalWorkOrder['status'];
        }
        return next;
      });
      saveLocalWorkOrders(jobId, rows);
    }
    await refresh();
  };

  const clockStart = async () => {
    setErr(null);
    try {
      if (isRemote) {
        const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/time-entries`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'start', notes: timeNotes || null }),
        });
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(d.error ?? res.statusText);
      } else {
        if (activeClock) return;
        const row: LocalTimeEntry = {
          id: newId(),
          job_id: jobId,
          work_order_id: null,
          clock_in: new Date().toISOString(),
          clock_out: null,
          hours_manual: null,
          notes: timeNotes || null,
        };
        saveLocalTimeEntries(jobId, [...loadLocalTimeEntries(jobId), row]);
      }
      setTimeNotes('');
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const clockStop = async () => {
    if (!activeClock) return;
    setErr(null);
    try {
      if (isRemote) {
        const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/time-entries`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'stop', entry_id: activeClock.id }),
        });
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(d.error ?? res.statusText);
      } else {
        const now = new Date().toISOString();
        const rows = loadLocalTimeEntries(jobId).map((t) =>
          t.id === activeClock.id ? { ...t, clock_out: now } : t,
        );
        saveLocalTimeEntries(jobId, rows);
      }
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const addManualHours = async () => {
    const h = parseFloat(manualHours);
    if (!Number.isFinite(h) || h <= 0 || h > 24) return;
    setErr(null);
    try {
      if (isRemote) {
        const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/time-entries`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'manual', hours: h, notes: timeNotes || null }),
        });
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(d.error ?? res.statusText);
      } else {
        const row: LocalTimeEntry = {
          id: newId(),
          job_id: jobId,
          work_order_id: null,
          clock_in: new Date().toISOString(),
          clock_out: new Date().toISOString(),
          hours_manual: h,
          notes: timeNotes || null,
        };
        saveLocalTimeEntries(jobId, [...loadLocalTimeEntries(jobId), row]);
      }
      setManualHours('');
      setTimeNotes('');
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const saveGpsFromOperateTrail = async () => {
    setErr(null);
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem(`ccc_operator_trail_${jobId}`) : null;
      if (!raw) {
        setErr('No GPS trail in storage — run GPS operate mode first.');
        return;
      }
      const coords = JSON.parse(raw) as [number, number][];
      if (!Array.isArray(coords) || coords.length < 2) {
        setErr('Trail too short.');
        return;
      }
      if (isRemote) {
        const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/gps-tracks`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ points: coords, source: 'phone', label: 'From operate trail' }),
        });
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(d.error ?? res.statusText);
      } else {
        let dist = 0;
        const R = 6371000;
        const toRad = (d: number) => (d * Math.PI) / 180;
        for (let i = 1; i < coords.length; i++) {
          const [lng1, lat1] = coords[i - 1];
          const [lng2, lat2] = coords[i];
          const dLat = toRad(lat2 - lat1);
          const dLng = toRad(lng2 - lng1);
          const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
          dist += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        }
        const widthM = 6 * 0.3048;
        const acres = ((dist * widthM * 0.85) / 4046.86);
        const row: LocalGpsTrack = {
          id: newId(),
          job_id: jobId,
          source: 'phone',
          started_at: new Date().toISOString(),
          ended_at: new Date().toISOString(),
          points: coords,
          distance_m: dist,
          area_acres_estimate: Math.round(acres * 100) / 100,
          label: 'From operate trail',
        };
        saveLocalGpsTracks(jobId, [...loadLocalGpsTracks(jobId), row]);
      }
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const addScheduleBlock = async () => {
    if (!schStart || !schEnd) return;
    setErr(null);
    try {
      if (isRemote) {
        const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/schedule`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            starts_at: new Date(schStart).toISOString(),
            ends_at: new Date(schEnd).toISOString(),
            title: schTitle || 'On site',
          }),
        });
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(d.error ?? res.statusText);
      } else {
        const row: LocalScheduleBlock = {
          id: newId(),
          job_id: jobId,
          starts_at: new Date(schStart).toISOString(),
          ends_at: new Date(schEnd).toISOString(),
          title: schTitle || 'On site',
          notes: null,
        };
        saveLocalSchedule(jobId, [...loadLocalSchedule(jobId), row].sort((a, b) => a.starts_at.localeCompare(b.starts_at)));
      }
      setSchStart('');
      setSchEnd('');
      setSchTitle('');
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const pastures = pasturesFromBid(bidSnapshot);

  return (
    <div className="space-y-8 mt-8">
      {err && (
        <div className="border border-amber-500/40 bg-amber-950/25 p-3 text-sm text-amber-100">{err}</div>
      )}
      {!isRemote && (
        <p className="text-[11px] font-mono text-[#5a4136]">
          Local job — work orders, time, GPS, and schedule are stored on this device. Sign in and convert the bid to sync to the team.
        </p>
      )}
      {busy && isRemote && <div className="text-[11px] font-mono text-[#5a4136]">Syncing…</div>}

      <section className="border-2 border-[#353534] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-[#a98a7d]">Work orders</h2>
          <Link href="/schedule" className="text-[10px] font-mono text-[#FF6B00] hover:underline">
            Full schedule →
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <select
            value={woPastureId}
            onChange={(e) => {
              const id = e.target.value;
              setWoPastureId(id);
              const p = pastures.find((x) => x.id === id);
              if (p) setWoName(p.name || id);
            }}
            className="bg-[#1a1a1a] border border-[#353534] text-xs px-2 py-1.5"
          >
            <option value="">Pasture (optional)</option>
            {pastures.map((p) => (
              <option key={p.id} value={p.id}>{p.name || p.id}</option>
            ))}
          </select>
          <input
            value={woName}
            onChange={(e) => setWoName(e.target.value)}
            placeholder="Label"
            className="bg-transparent border border-[#353534] px-2 py-1.5 text-xs"
          />
        </div>
        <textarea
          value={woInstructions}
          onChange={(e) => setWoInstructions(e.target.value)}
          placeholder="Instructions for crew (method, hazards, oak buffers…)"
          className="w-full bg-transparent border border-[#353534] px-2 py-2 text-xs min-h-[72px]"
        />
        <button
          type="button"
          onClick={() => void addWorkOrder().catch((e) => setErr(String(e)))}
          className="bg-[#353534] text-[#e5e2e1] px-3 py-1.5 text-[10px] font-black uppercase"
        >
          Add work order
        </button>
        <ul className="space-y-2 max-h-[220px] overflow-y-auto">
          {workOrders.map((w) => (
            <li key={w.id} className="border border-[#353534] p-2 text-xs">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-bold text-[#ffb693]">{w.pasture_name || w.pasture_id || 'Pasture'}</span>
                <select
                  value={w.status}
                  onChange={(e) => void patchWo(w.id, { status: e.target.value }).catch((err) => setErr(String(err)))}
                  className="bg-[#1a1a1a] border border-[#353534] text-[10px]"
                >
                  <option value="pending">pending</option>
                  <option value="in_progress">in_progress</option>
                  <option value="done">done</option>
                  <option value="skipped">skipped</option>
                </select>
              </div>
              <p className="text-[11px] text-[#a98a7d] mt-1 whitespace-pre-wrap">{w.instructions}</p>
            </li>
          ))}
          {workOrders.length === 0 && (
            <li className="text-[11px] text-[#5a4136]">No work orders yet.</li>
          )}
        </ul>
      </section>

      <section className="border-2 border-[#353534] p-4 space-y-3">
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-[#a98a7d]">Time</h2>
        <div className="flex flex-wrap gap-2 items-center">
          {!activeClock ? (
            <button
              type="button"
              onClick={() => void clockStart()}
              className="bg-[#13ff43] text-black px-3 py-2 text-[10px] font-black uppercase"
            >
              Clock in
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void clockStop()}
              className="bg-[#FF6B00] text-black px-3 py-2 text-[10px] font-black uppercase"
            >
              Clock out
            </button>
          )}
          <input
            value={timeNotes}
            onChange={(e) => setTimeNotes(e.target.value)}
            placeholder="Notes (optional)"
            className="flex-1 min-w-[120px] bg-transparent border border-[#353534] px-2 py-1 text-[11px]"
          />
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          <input
            type="number"
            step="0.25"
            min={0}
            max={24}
            value={manualHours}
            onChange={(e) => setManualHours(e.target.value)}
            placeholder="Manual hrs"
            className="w-28 bg-transparent border border-[#353534] px-2 py-1 text-xs"
          />
          <button
            type="button"
            onClick={() => void addManualHours()}
            className="border border-[#353534] px-2 py-1 text-[10px] uppercase text-[#a98a7d]"
          >
            Log hours
          </button>
        </div>
        <ul className="space-y-1 text-[11px] font-mono max-h-[160px] overflow-y-auto">
          {timeEntries.map((t) => (
            <li key={t.id} className="text-[#5a4136]">
              {t.hours_manual != null
                ? `${t.hours_manual}h manual`
                : `${new Date(t.clock_in).toLocaleString()} → ${t.clock_out ? new Date(t.clock_out).toLocaleString() : '…'}`}
              {t.notes ? ` — ${t.notes}` : ''}
            </li>
          ))}
        </ul>
      </section>

      <section className="border-2 border-[#353534] p-4 space-y-3">
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-[#a98a7d]">GPS trail → acres (estimate)</h2>
        <p className="text-[10px] text-[#5a4136]">
          Uses the trail from GPS operate mode (same job id). Default 6 ft cutting width × path length × 0.85 overlap.
        </p>
        <button
          type="button"
          onClick={() => void saveGpsFromOperateTrail()}
          className="border border-[#FF6B00] text-[#FF6B00] px-3 py-1.5 text-[10px] font-black uppercase"
        >
          Save trail from operate mode
        </button>
        <ul className="text-[11px] font-mono space-y-1">
          {gpsTracks.map((g) => (
            <li key={g.id} className="text-[#5a4136]">
              {g.area_acres_estimate != null ? `~${g.area_acres_estimate} ac` : '—'}
              {g.distance_m != null ? ` · ${Math.round(g.distance_m)}m` : ''}
              {' · '}
              {new Date(g.started_at).toLocaleString()}
            </li>
          ))}
        </ul>
      </section>

      <section className="border-2 border-[#353534] p-4 space-y-3">
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-[#a98a7d]">Schedule this job</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="text-[9px] text-[#5a4136] uppercase">Start</label>
            <input
              type="datetime-local"
              value={schStart}
              onChange={(e) => setSchStart(e.target.value)}
              className="w-full bg-transparent border border-[#353534] px-2 py-1 text-xs"
            />
          </div>
          <div>
            <label className="text-[9px] text-[#5a4136] uppercase">End</label>
            <input
              type="datetime-local"
              value={schEnd}
              onChange={(e) => setSchEnd(e.target.value)}
              className="w-full bg-transparent border border-[#353534] px-2 py-1 text-xs"
            />
          </div>
        </div>
        <input
          value={schTitle}
          onChange={(e) => setSchTitle(e.target.value)}
          placeholder="Title (e.g. Mulch north pasture)"
          className="w-full bg-transparent border border-[#353534] px-2 py-1 text-xs"
        />
        <button
          type="button"
          onClick={() => void addScheduleBlock()}
          className="bg-[#353534] text-[#e5e2e1] px-3 py-1.5 text-[10px] font-black uppercase"
        >
          Add block
        </button>
        <ul className="text-[11px] space-y-1">
          {scheduleBlocks.map((s) => (
            <li key={s.id} className="text-[#a98a7d]">
              <span className="text-[#ffb693]">{s.title}</span>
              {' · '}
              {new Date(s.starts_at).toLocaleString()} — {new Date(s.ends_at).toLocaleString()}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
