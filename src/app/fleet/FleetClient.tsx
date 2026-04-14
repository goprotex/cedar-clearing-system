'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import AppShell from '@/components/AppShell';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { createClient, isSupabaseConfigured } from '@/utils/supabase/client';
import { fetchApiAuthed } from '@/lib/auth-client';
import {
  type Machine,
  type MachineStatus,
  type MaintenanceLogEntry,
  type FuelLogEntry,
  type HoursLogEntry,
  type FleetUnit,
  type EquipmentCategory,
  type EquipmentCondition,
  type CheckoutRecord,
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_CONDITIONS,
  machineToJson,
  newMachineId,
  loadFleetJobOptionsMerged,
  sumHoursLoggedToday,
  rowToFleetUnit,
  loadFleetMachinesFromLocalStorage,
  clearFleetLocalStorage,
  DEFAULT_FLEET_MACHINES,
} from '@/lib/fleet-storage';
import type { ActiveJobSummary } from '@/lib/active-jobs';
import type { MonitorBootstrapResponse } from '@/types/monitor-bootstrap';
import type { Bid } from '@/types';

const MIGRATION_FLAG = 'ccc_fleet_supabase_migrated_v1';

const STATUS_STYLES: Record<MachineStatus, { bg: string; text: string; dot: string }> = {
  active: { bg: 'border-[#13ff43]', text: 'text-[#13ff43]', dot: 'bg-[#13ff43] animate-pulse' },
  idle: { bg: 'border-amber-500', text: 'text-amber-400', dot: 'bg-amber-500' },
  maintenance: { bg: 'border-[#FF6B00]', text: 'text-[#FF6B00]', dot: 'bg-[#FF6B00]' },
  offline: { bg: 'border-red-500', text: 'text-red-400', dot: 'bg-red-500' },
};

function jobLabel(jobId: string, jobs: ActiveJobSummary[]): string {
  const j = jobs.find((x) => x.id === jobId);
  if (j) return j.title || j.id;
  return jobId;
}

async function fetchRemoteJobs(): Promise<ActiveJobSummary[]> {
  const res = await fetchApiAuthed('/api/monitor/bootstrap');
  if (!res.ok) return [];
  const data = (await res.json()) as MonitorBootstrapResponse;
  const raw = data.jobs ?? [];
  return raw.map((j) => {
    const row = j as Record<string, unknown>;
    return {
      id: String(row.id ?? ''),
      title: String(row.title ?? ''),
      status: String(row.status ?? 'active'),
      created_at: String(row.created_at ?? ''),
      bid_snapshot: row.bid_snapshot as Bid,
      cedar_total_cells: Number(row.cedar_total_cells ?? 0),
      cedar_cleared_cells: Number(row.cedar_cleared_cells ?? 0),
      work_started_at: (row.work_started_at as string | null) ?? null,
      work_completed_at: (row.work_completed_at as string | null) ?? null,
      manual_machine_hours: (row.manual_machine_hours as number | null) ?? null,
      manual_fuel_gallons: (row.manual_fuel_gallons as number | null) ?? null,
    } satisfies ActiveJobSummary;
  }).filter((j) => j.id);
}

export default function FleetClient() {
  const supabaseRef = useRef(createClient());
  const [units, setUnits] = useState<FleetUnit[]>([]);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<MachineStatus | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState<EquipmentCategory | 'all'>('all');
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [jobListTick, setJobListTick] = useState(0);
  const [jobOptions, setJobOptions] = useState<ActiveJobSummary[]>([]);
  const [detailTab, setDetailTab] = useState<'details' | 'notes' | 'logs' | 'checkout'>('details');
  const [addOpen, setAddOpen] = useState(false);
  const [newForm, setNewForm] = useState({
    name: '',
    type: 'Equipment',
    category: 'other' as EquipmentCategory,
    model: '',
    make: '',
    serialNumber: '',
    year: '',
    operator: 'Unassigned',
    lastLocation: '',
  });

  const refreshJobs = useCallback(async () => {
    const merged = await loadFleetJobOptionsMerged(fetchRemoteJobs);
    setJobOptions(merged);
  }, []);

  useEffect(() => {
    void refreshJobs();
  }, [refreshJobs, jobListTick]);

  const fetchFleet = useCallback(async (cid: string) => {
    const supabase = supabaseRef.current;
    const { data, error } = await supabase
      .from('fleet_machines')
      .select('id, data')
      .eq('company_id', cid)
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { id: string; data: unknown }[];
    return rows.map(rowToFleetUnit);
  }, []);

  const bootstrap = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoadError('Supabase is not configured.');
      setLoading(false);
      setAuthReady(true);
      return;
    }
    const supabase = supabaseRef.current;
    setLoadError(null);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      setCompanyId(null);
      setUnits([]);
      setLoading(false);
      setAuthReady(true);
      return;
    }

    const { data: profile, error: pErr } = await supabase
      .from('profiles')
      .select('company_id')
      .eq('id', session.user.id)
      .maybeSingle();
    if (pErr) {
      setLoadError(pErr.message);
      setLoading(false);
      setAuthReady(true);
      return;
    }

    const cid = profile?.company_id ?? null;
    setCompanyId(cid);
    setAuthReady(true);

    if (!cid) {
      setUnits([]);
      setLoading(false);
      return;
    }

    try {
      let list = await fetchFleet(cid);

      const localLegacy = loadFleetMachinesFromLocalStorage();
      const alreadyMigrated = typeof window !== 'undefined' && localStorage.getItem(MIGRATION_FLAG) === '1';
      if (list.length === 0 && localLegacy.length > 0 && !alreadyMigrated) {
        for (const m of localLegacy) {
          const { error: insErr } = await supabase.from('fleet_machines').insert({
            company_id: cid,
            data: machineToJson(m),
          });
          if (insErr) throw new Error(insErr.message);
        }
        clearFleetLocalStorage();
        localStorage.setItem(MIGRATION_FLAG, '1');
        toast.success('Fleet imported from this browser to the team database.');
        list = await fetchFleet(cid);
      }

      if (list.length === 0 && localLegacy.length === 0 && !alreadyMigrated) {
        for (const m of DEFAULT_FLEET_MACHINES) {
          const { error: insErr } = await supabase.from('fleet_machines').insert({
            company_id: cid,
            data: machineToJson(m),
          });
          if (insErr) throw new Error(insErr.message);
        }
        localStorage.setItem(MIGRATION_FLAG, '1');
        list = await fetchFleet(cid);
      }

      setUnits(list);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
      setUnits([]);
    } finally {
      setLoading(false);
    }
  }, [fetchFleet]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (!companyId || !isSupabaseConfigured) return;
    const supabase = supabaseRef.current;
    let t: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase
      .channel(`fleet-${companyId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'fleet_machines', filter: `company_id=eq.${companyId}` },
        () => {
          if (t) clearTimeout(t);
          t = setTimeout(() => {
            void fetchFleet(companyId).then(setUnits).catch(() => {});
          }, 150);
        },
      )
      .subscribe();
    return () => {
      if (t) clearTimeout(t);
      void supabase.removeChannel(channel);
    };
  }, [companyId, fetchFleet]);

  const updateRow = useCallback(
    async (rowId: string, machine: Machine) => {
      if (!companyId) return;
      const supabase = supabaseRef.current;
      const { error } = await supabase
        .from('fleet_machines')
        .update({ data: machineToJson(machine) })
        .eq('id', rowId)
        .eq('company_id', companyId);
      if (error) {
        toast.error(error.message);
        return;
      }
      setUnits((prev) => prev.map((u) => (u.rowId === rowId ? { rowId, machine } : u)));
    },
    [companyId],
  );

  const filtered = useMemo(() => {
    let list = filter === 'all' ? units : units.filter((u) => u.machine.status === filter);
    if (categoryFilter !== 'all') list = list.filter((u) => u.machine.category === categoryFilter);
    return list;
  }, [units, filter, categoryFilter]);
  const selected = units.find((u) => u.rowId === selectedRowId) || null;

  const counts = {
    all: units.length,
    active: units.filter((u) => u.machine.status === 'active').length,
    idle: units.filter((u) => u.machine.status === 'idle').length,
    maintenance: units.filter((u) => u.machine.status === 'maintenance').length,
    offline: units.filter((u) => u.machine.status === 'offline').length,
  };

  const categoryCounts = useMemo(() => {
    const c: Record<string, number> = { all: units.length };
    for (const cat of EQUIPMENT_CATEGORIES) c[cat.value] = 0;
    for (const u of units) c[u.machine.category] = (c[u.machine.category] || 0) + 1;
    return c;
  }, [units]);

  const serviceDueSoon = useMemo(() => {
    const soon = new Date();
    soon.setDate(soon.getDate() + 7);
    return units.filter((u) => {
      const m = u.machine;
      if (m.nextService && new Date(m.nextService) <= soon) return true;
      if (m.nextServiceHours > 0 && m.hours >= m.nextServiceHours - 50) return true;
      return false;
    });
  }, [units]);

  const checkedOut = useMemo(() => units.filter((u) => {
    const last = u.machine.checkoutHistory[0];
    return last && last.status === 'checked_out';
  }), [units]);

  const hoursToday = sumHoursLoggedToday(units);
  const totalAcresToday = units.reduce((s, u) => s + u.machine.dailyAcres, 0);
  const avgFuelLevel =
    units.length === 0 ? 0 : Math.round(units.reduce((s, u) => s + u.machine.fuelLevel, 0) / units.length);

  const updateMachine = useCallback(
    (rowId: string, patch: Partial<Machine>) => {
      const u = units.find((x) => x.rowId === rowId);
      if (!u) return;
      const nextMachine = { ...u.machine, ...patch };
      void updateRow(rowId, nextMachine);
    },
    [units, updateRow],
  );

  function updateMachineStatus(rowId: string, status: MachineStatus) {
    const u = units.find((x) => x.rowId === rowId);
    if (!u) return;
    void updateRow(rowId, { ...u.machine, status });
    toast.success(`${u.machine.id} status → ${status.toUpperCase()}`);
  }

  async function removeMachine(rowId: string) {
    const u = units.find((x) => x.rowId === rowId);
    if (!u || !companyId) return;
    if (!window.confirm(`Remove ${u.machine.name} (${u.machine.id}) from fleet? This cannot be undone.`)) return;
    const supabase = supabaseRef.current;
    const { error } = await supabase.from('fleet_machines').delete().eq('id', rowId).eq('company_id', companyId);
    if (error) {
      toast.error(error.message);
      return;
    }
    setUnits((prev) => prev.filter((x) => x.rowId !== rowId));
    if (selectedRowId === rowId) setSelectedRowId(null);
    toast.success('Unit removed');
  }

  async function addMachine() {
    if (!companyId) return;
    const name = newForm.name.trim();
    if (!name) {
      toast.error('Enter a unit name');
      return;
    }
    const m: Machine = {
      id: newMachineId(),
      name: name.toUpperCase().replace(/\s+/g, '_'),
      type: newForm.type.trim() || 'Equipment',
      category: newForm.category,
      model: newForm.model.trim() || '—',
      make: newForm.make.trim() || '',
      serialNumber: newForm.serialNumber.trim() || '',
      year: newForm.year ? parseInt(newForm.year, 10) || null : null,
      status: 'idle',
      hours: 0,
      mileage: 0,
      fuelLevel: 0,
      lastLocation: newForm.lastLocation.trim() || '—',
      operator: newForm.operator.trim() || 'Unassigned',
      currentJob: '',
      dailyAcres: 0,
      avgFuelPerHr: 0,
      nextService: '',
      nextServiceHours: 0,
      condition: 'good',
      notes: '',
      photoUrls: [],
      thumbnailIndex: 0,
      maintenanceLog: [],
      fuelLog: [],
      hoursLog: [],
      checkoutHistory: [],
    };
    const supabase = supabaseRef.current;
    const { data, error } = await supabase
      .from('fleet_machines')
      .insert({ company_id: companyId, data: machineToJson(m) })
      .select('id, data')
      .single();
    if (error) {
      toast.error(error.message);
      return;
    }
    const unit = rowToFleetUnit(data as { id: string; data: unknown });
    setUnits((prev) => [unit, ...prev]);
    setSelectedRowId(unit.rowId);
    setAddOpen(false);
    setNewForm({ name: '', type: 'Equipment', category: 'other', model: '', make: '', serialNumber: '', year: '', operator: 'Unassigned', lastLocation: '' });
    toast.success(`Added ${m.id}`);
  }

  const selectedJobSelectValue = useMemo(() => {
    if (!selected) return '';
    const match = jobOptions.some((j) => j.id === selected.machine.currentJob);
    return match ? selected.machine.currentJob : '';
  }, [selected, jobOptions]);

  if (!authReady) {
    return (
      <AppShell>
        <div className="border border-[#353534] p-8 text-[#a98a7d] font-mono text-sm">LOADING…</div>
      </AppShell>
    );
  }

  if (!isSupabaseConfigured) {
    return (
      <AppShell>
        <div className="border-l-4 border-amber-500 pl-4 mb-4">
          <h1 className="text-2xl font-black uppercase">FLEET_SYNC</h1>
          <p className="text-amber-400 text-sm mt-2">Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY to load fleet data.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="min-w-0 max-w-full overflow-x-hidden flex flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-end border-l-4 border-[#FF6B00] pl-3 sm:pl-4 min-w-0">
        <div className="min-w-0 max-w-full">
          <h1 className="text-xl sm:text-3xl md:text-4xl font-black uppercase tracking-tighter break-words">FLEET_SYNC</h1>
          <p className="text-[#ffb693] text-[10px] sm:text-xs font-mono break-words leading-snug">
            {loading ? '…' : `${units.length} UNITS`} —{' '}
            {companyId ? 'SUPABASE · COMPANY_SHARED' : 'SIGN_IN · COMPANY_REQUIRED'}
          </p>
          {!companyId && (
            <p className="text-[#5a4136] text-[10px] font-mono mt-1 max-w-full sm:max-w-xl break-words">
              Your profile needs a company to use the shared fleet. Ask an admin to add you to the team, or complete company setup in settings.
            </p>
          )}
          {companyId && (
            <p className="text-[#5a4136] text-[10px] font-mono mt-1 max-w-full sm:max-w-xl break-words">
              Manual entry until telematics is wired. Job list merges server jobs with local converted jobs on this device — refresh after creating jobs.
            </p>
          )}
        </div>
        {companyId && (
          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setJobListTick((t) => t + 1);
                toast.message('Job list refreshed');
              }}
              className="px-3 py-2 text-xs font-bold uppercase border border-[#353534] text-[#a98a7d] hover:border-[#FF6B00] hover:text-[#FF6B00]"
            >
              Refresh jobs
            </button>
            <button
              type="button"
              onClick={() => setAddOpen((o) => !o)}
              className="px-3 py-2 text-xs font-bold uppercase bg-[#FF6B00] text-black border border-[#FF6B00] hover:bg-[#ff8533]"
            >
              {addOpen ? 'Cancel' : '+ Add equipment'}
            </button>
          </div>
        )}
      </div>

      {loadError && (
        <div className="border border-red-900 text-red-400 text-xs sm:text-sm p-3 font-mono break-words">{loadError}</div>
      )}

      {companyId && addOpen && (
        <div className="border-2 border-[#353534] p-4 mb-8 space-y-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-[#a98a7d]">New unit</div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
            <label className="space-y-1">
              <span className="text-[#5a4136]">Name / callsign *</span>
              <input
                value={newForm.name}
                onChange={(e) => setNewForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full bg-[#1c1b1b] border border-[#353534] px-2 py-1.5 font-mono"
                placeholder="e.g. Mulcher North"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[#5a4136]">Category *</span>
              <select
                value={newForm.category}
                onChange={(e) => setNewForm((f) => ({ ...f, category: e.target.value as EquipmentCategory }))}
                className="w-full bg-[#1c1b1b] border border-[#353534] px-2 py-1.5"
              >
                {EQUIPMENT_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[#5a4136]">Type / description</span>
              <input
                value={newForm.type}
                onChange={(e) => setNewForm((f) => ({ ...f, type: e.target.value }))}
                className="w-full bg-[#1c1b1b] border border-[#353534] px-2 py-1.5"
                placeholder="e.g. Tracked Mulcher"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[#5a4136]">Make</span>
              <input
                value={newForm.make}
                onChange={(e) => setNewForm((f) => ({ ...f, make: e.target.value }))}
                className="w-full bg-[#1c1b1b] border border-[#353534] px-2 py-1.5"
                placeholder="e.g. Barko, CAT, Peterbilt"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[#5a4136]">Model</span>
              <input
                value={newForm.model}
                onChange={(e) => setNewForm((f) => ({ ...f, model: e.target.value }))}
                className="w-full bg-[#1c1b1b] border border-[#353534] px-2 py-1.5"
                placeholder="e.g. 930B"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[#5a4136]">Year</span>
              <input
                value={newForm.year}
                onChange={(e) => setNewForm((f) => ({ ...f, year: e.target.value }))}
                className="w-full bg-[#1c1b1b] border border-[#353534] px-2 py-1.5"
                placeholder="e.g. 2022"
                type="number"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[#5a4136]">Serial Number</span>
              <input
                value={newForm.serialNumber}
                onChange={(e) => setNewForm((f) => ({ ...f, serialNumber: e.target.value }))}
                className="w-full bg-[#1c1b1b] border border-[#353534] px-2 py-1.5 font-mono"
                placeholder="e.g. BK930-2021-00457"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[#5a4136]">Operator</span>
              <input
                value={newForm.operator}
                onChange={(e) => setNewForm((f) => ({ ...f, operator: e.target.value }))}
                className="w-full bg-[#1c1b1b] border border-[#353534] px-2 py-1.5"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[#5a4136]">Last known location</span>
              <input
                value={newForm.lastLocation}
                onChange={(e) => setNewForm((f) => ({ ...f, lastLocation: e.target.value }))}
                className="w-full bg-[#1c1b1b] border border-[#353534] px-2 py-1.5"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={() => void addMachine()}
            className="px-4 py-2 text-xs font-black uppercase bg-[#13ff43] text-black"
          >
            Create unit
          </button>
        </div>
      )}

      {companyId && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-4 min-w-0">
            <div className="border-2 border-[#353534] p-2 sm:p-4 min-w-0 overflow-hidden">
              <div className="text-[8px] sm:text-[10px] text-[#a98a7d] font-bold uppercase tracking-wide sm:tracking-widest mb-1 leading-tight">ACTIVE</div>
              <div className="text-2xl sm:text-3xl font-black text-[#13ff43] tabular-nums">{counts.active}</div>
              <div className="text-[9px] sm:text-[10px] text-[#5a4136] font-mono truncate">of {units.length}</div>
            </div>
            <div className="border-2 border-[#353534] p-2 sm:p-4 min-w-0 overflow-hidden">
              <div className="text-[8px] sm:text-[10px] text-[#a98a7d] font-bold uppercase tracking-wide sm:tracking-widest mb-1 leading-tight">HRS_TODAY</div>
              <div className="text-2xl sm:text-3xl font-black text-[#FF6B00] tabular-nums">{hoursToday.toFixed(1)}</div>
              <div className="text-[9px] sm:text-[10px] text-[#5a4136] font-mono truncate">logged</div>
            </div>
            <div className="border-2 border-[#353534] p-2 sm:p-4 min-w-0 overflow-hidden">
              <div className="text-[8px] sm:text-[10px] text-[#a98a7d] font-bold uppercase tracking-wide sm:tracking-widest mb-1 leading-tight">ACRES</div>
              <div className="text-2xl sm:text-3xl font-black text-[#ffb693] tabular-nums">{totalAcresToday.toFixed(1)}</div>
              <div className="text-[9px] sm:text-[10px] text-[#5a4136] font-mono truncate">today</div>
            </div>
            <div className="border-2 border-[#353534] p-2 sm:p-4 min-w-0 overflow-hidden">
              <div
                className="text-[8px] sm:text-[10px] text-[#a98a7d] font-bold uppercase tracking-wide sm:tracking-widest mb-1 leading-tight">FUEL Ø</div>
              <div
                className="text-2xl sm:text-3xl font-black tabular-nums"
                style={{ color: avgFuelLevel > 50 ? '#13ff43' : avgFuelLevel > 25 ? '#FF6B00' : '#ff4444' }}
              >
                {units.length ? `${avgFuelLevel}%` : '—'}
              </div>
              <div className="text-[9px] sm:text-[10px] text-[#5a4136] font-mono truncate">avg</div>
            </div>
            <div className="border-2 border-[#353534] p-2 sm:p-4 min-w-0 overflow-hidden">
              <div className="text-[8px] sm:text-[10px] text-[#a98a7d] font-bold uppercase tracking-wide sm:tracking-widest mb-1 leading-tight">CHECKED OUT</div>
              <div className="text-2xl sm:text-3xl font-black text-cyan-400 tabular-nums">{checkedOut.length}</div>
              <div className="text-[9px] sm:text-[10px] text-[#5a4136] font-mono truncate">in field</div>
            </div>
            <div className="border-2 border-[#353534] p-2 sm:p-4 min-w-0 overflow-hidden">
              <div className="text-[8px] sm:text-[10px] text-[#a98a7d] font-bold uppercase tracking-wide sm:tracking-widest mb-1 leading-tight">SERVICE DUE</div>
              <div className={`text-2xl sm:text-3xl font-black tabular-nums ${serviceDueSoon.length > 0 ? 'text-red-400' : 'text-[#5a4136]'}`}>{serviceDueSoon.length}</div>
              <div className="text-[9px] sm:text-[10px] text-[#5a4136] font-mono truncate">within 7d</div>
            </div>
          </div>

          <div className="flex gap-2 flex-wrap min-w-0">
            {(['all', 'active', 'idle', 'maintenance', 'offline'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setFilter(s)}
                className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider border transition-all ${
                  filter === s
                    ? 'bg-[#FF6B00] text-black border-[#FF6B00]'
                    : 'border-[#353534] text-[#a98a7d] hover:border-[#FF6B00] hover:text-[#FF6B00]'
                }`}
              >
                {s} ({counts[s]})
              </button>
            ))}
          </div>

          <div className="flex gap-2 flex-wrap min-w-0">
            <button
              type="button"
              onClick={() => setCategoryFilter('all')}
              className={`px-2 py-1 text-[10px] font-bold uppercase tracking-wider border transition-all ${
                categoryFilter === 'all'
                  ? 'bg-cyan-600 text-black border-cyan-600'
                  : 'border-[#353534] text-[#5a4136] hover:border-cyan-600 hover:text-cyan-400'
              }`}
            >
              All types ({categoryCounts.all})
            </button>
            {EQUIPMENT_CATEGORIES.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setCategoryFilter(c.value)}
                className={`px-2 py-1 text-[10px] font-bold uppercase tracking-wider border transition-all ${
                  categoryFilter === c.value
                    ? 'bg-cyan-600 text-black border-cyan-600'
                    : 'border-[#353534] text-[#5a4136] hover:border-cyan-600 hover:text-cyan-400'
                }`}
              >
                {c.label} ({categoryCounts[c.value] || 0})
              </button>
            ))}
          </div>

          <div className="flex flex-col lg:flex-row lg:items-stretch gap-4 lg:gap-6 min-w-0 min-h-0">
            <div className="flex-1 min-w-0 min-h-0 space-y-3 lg:max-h-[calc(100dvh-14rem)] lg:overflow-y-auto lg:pr-1 lg:-mr-1 overscroll-contain">
              {loading && (
                <div className="text-[#5a4136] font-mono text-sm border border-[#353534] p-6">Loading fleet…</div>
              )}
              {!loading && filtered.length === 0 && (
                <div className="border-2 border-[#353534] p-12 text-center">
                  <p className="text-lg font-black uppercase tracking-tight text-[#a98a7d]">NO_UNITS</p>
                  <p className="text-xs text-[#5a4136] mt-2">Add equipment or change the filter.</p>
                </div>
              )}
              {!loading &&
                filtered.map((u) => {
                  const m = u.machine;
                  const style = STATUS_STYLES[m.status];
                  const jt = m.currentJob ? jobLabel(m.currentJob, jobOptions) : '';
                  const catLabel = EQUIPMENT_CATEGORIES.find((c) => c.value === m.category)?.label || m.category;
                  const thumbUrl = m.photoUrls.length > 0 ? m.photoUrls[m.thumbnailIndex] || m.photoUrls[0] : null;
                  const lastCheckout = m.checkoutHistory[0];
                  const isCheckedOut = lastCheckout && lastCheckout.status === 'checked_out';
                  return (
                    <div
                      key={u.rowId}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setSelectedRowId(u.rowId === selectedRowId ? null : u.rowId);
                        setDetailTab('details');
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedRowId(u.rowId === selectedRowId ? null : u.rowId);
                          setDetailTab('details');
                        }
                      }}
                      className={`border-2 p-4 cursor-pointer transition-all ${
                        u.rowId === selectedRowId
                          ? 'border-[#FF6B00] bg-[#2a2a2a]'
                          : 'border-[#353534] hover:border-[#5a4136] hover:bg-[#1c1b1b]'
                      }`}
                    >
                      <div className="flex gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-3 min-w-0">
                              <span className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
                              <span className="font-mono font-black text-sm text-[#ffb693] shrink-0">{m.id}</span>
                              <span className="font-black text-sm uppercase truncate">{m.name}</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="border px-1.5 py-0.5 text-[9px] font-bold uppercase text-cyan-400 border-cyan-800">
                                {catLabel}
                              </span>
                              <span className={`border px-2 py-0.5 text-[10px] font-black uppercase ${style.bg} ${style.text}`}>
                                {m.status}
                              </span>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-2 md:gap-x-4 gap-y-1 text-xs min-w-0">
                            <div className="min-w-0">
                              <span className="text-[#5a4136]">MODEL:</span>{' '}
                              <span className="text-[#a98a7d] break-words">{m.make ? `${m.make} ` : ''}{m.model}</span>
                            </div>
                            <div className="min-w-0">
                              <span className="text-[#5a4136]">HOURS:</span>{' '}
                              <span className="font-mono tabular-nums">{m.hours.toLocaleString()}</span>
                            </div>
                            <div className="min-w-0">
                              <span className="text-[#5a4136]">FUEL:</span>{' '}
                              <span
                                className="font-mono tabular-nums"
                                style={{ color: m.fuelLevel > 50 ? '#13ff43' : m.fuelLevel > 25 ? '#FF6B00' : '#ff4444' }}
                              >
                                {m.fuelLevel}%
                              </span>
                            </div>
                            <div className="min-w-0 col-span-2 md:col-span-1">
                              <span className="text-[#5a4136]">OPERATOR:</span>{' '}
                              <span className="text-[#a98a7d] break-words">{m.operator}</span>
                            </div>
                          </div>
                          {(m.currentJob || m.lastLocation || isCheckedOut) && (
                            <div className="mt-2 text-xs space-y-0.5 break-words">
                              {isCheckedOut && (
                                <div className="min-w-0">
                                  <span className="text-cyan-600 font-bold">⬆ CHECKED OUT</span>{' '}
                                  <span className="text-[#a98a7d]">by {lastCheckout.checkedOutByName}</span>
                                </div>
                              )}
                              {m.currentJob && (
                                <div className="min-w-0">
                                  <span className="text-[#5a4136]">JOB:</span>{' '}
                                  <span className="font-mono text-[#13ff43] break-all">{jt}</span>
                                  {jt !== m.currentJob && (
                                    <span className="text-[#5a4136] ml-1 font-mono text-[10px] break-all">({m.currentJob})</span>
                                  )}
                                </div>
                              )}
                              <div className="min-w-0">
                                <span className="text-[#5a4136]">LOCATION:</span>{' '}
                                <span className="text-[#a98a7d] break-words">{m.lastLocation}</span>
                              </div>
                            </div>
                          )}
                        </div>
                        {/* Thumbnail to the right */}
                        <div
                          className="w-20 h-20 shrink-0 border border-[#353534] bg-[#1c1b1b] flex items-center justify-center overflow-hidden cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedRowId(u.rowId);
                            setDetailTab('notes');
                          }}
                          title={thumbUrl ? 'Click to manage photos' : 'Click to add photo'}
                        >
                          {thumbUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={thumbUrl} alt={m.name} className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-[#5a4136] text-[9px] font-mono text-center px-1">NO PHOTO</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>

            {selected && (
              <MachineDetailPanel
                rowId={selected.rowId}
                machine={selected.machine}
                jobOptions={jobOptions}
                selectedJobSelectValue={selectedJobSelectValue}
                detailTab={detailTab}
                setDetailTab={setDetailTab}
                onClose={() => setSelectedRowId(null)}
                onUpdate={(patch) => updateMachine(selected.rowId, patch)}
                onStatus={(s) => updateMachineStatus(selected.rowId, s)}
                onRemove={() => void removeMachine(selected.rowId)}
              />
            )}
          </div>
        </>
      )}
      </div>
    </AppShell>
  );
}

function MachineDetailPanel({
  rowId,
  machine: m,
  jobOptions,
  selectedJobSelectValue,
  detailTab,
  setDetailTab,
  onClose,
  onUpdate,
  onStatus,
  onRemove,
}: {
  rowId: string;
  machine: Machine;
  jobOptions: ActiveJobSummary[];
  selectedJobSelectValue: string;
  detailTab: 'details' | 'notes' | 'logs' | 'checkout';
  setDetailTab: (t: 'details' | 'notes' | 'logs' | 'checkout') => void;
  onClose: () => void;
  onUpdate: (patch: Partial<Machine>) => void;
  onStatus: (s: MachineStatus) => void;
  onRemove: () => void;
}) {
  void rowId;
  const [maintForm, setMaintForm] = useState({
    kind: 'service' as MaintenanceLogEntry['kind'],
    dateISO: new Date().toISOString().slice(0, 10),
    description: '',
  });
  const [fuelForm, setFuelForm] = useState({
    dateISO: new Date().toISOString().slice(0, 10),
    gallons: '',
    note: '',
  });
  const [hoursForm, setHoursForm] = useState({
    dateISO: new Date().toISOString().slice(0, 10),
    delta: '',
    note: '',
  });

  const [checkoutForm, setCheckoutForm] = useState({
    jobId: '',
    hours: String(m.hours),
    mileage: String(m.mileage),
    fuelLevel: String(m.fuelLevel),
    condition: m.condition as EquipmentCondition,
    location: m.lastLocation,
    notes: '',
    operatorName: m.operator,
  });

  const [photoUploading, setPhotoUploading] = useState(false);

  function appendMaintenance() {
    const description = maintForm.description.trim();
    if (!description) {
      toast.error('Describe the work');
      return;
    }
    const entry: MaintenanceLogEntry = {
      id: uuidv4(),
      dateISO: new Date(maintForm.dateISO + 'T12:00:00').toISOString(),
      kind: maintForm.kind,
      hoursAtEntry: m.hours,
      description,
    };
    onUpdate({ maintenanceLog: [entry, ...m.maintenanceLog] });
    setMaintForm((f) => ({ ...f, description: '' }));
    toast.success('Maintenance entry saved');
  }

  function appendFuel() {
    const g = parseFloat(fuelForm.gallons);
    if (!Number.isFinite(g) || g <= 0) {
      toast.error('Enter gallons');
      return;
    }
    const entry: FuelLogEntry = {
      id: uuidv4(),
      dateISO: new Date(fuelForm.dateISO + 'T12:00:00').toISOString(),
      gallons: g,
      note: fuelForm.note.trim() || undefined,
    };
    onUpdate({ fuelLog: [entry, ...m.fuelLog] });
    setFuelForm((f) => ({ ...f, gallons: '', note: '' }));
    toast.success('Fuel entry saved');
  }

  function appendHours() {
    const d = parseFloat(hoursForm.delta);
    if (!Number.isFinite(d) || d === 0) {
      toast.error('Enter hours to add (use negative to correct)');
      return;
    }
    const entry: HoursLogEntry = {
      id: uuidv4(),
      dateISO: new Date(hoursForm.dateISO + 'T12:00:00').toISOString(),
      deltaHours: d,
      note: hoursForm.note.trim() || undefined,
    };
    const nextHours = Math.max(0, m.hours + d);
    onUpdate({ hoursLog: [entry, ...m.hoursLog], hours: nextHours });
    setHoursForm((f) => ({ ...f, delta: '', note: '' }));
    toast.success('Hours updated');
  }

  // Max size for a compressed fleet photo stored as base64 in Supabase JSONB (~225KB actual)
  const MAX_COMPRESSED_IMAGE_BYTES = 300_000;

  async function onPhotoPick(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    e.target.value = '';
    if (!files?.length) return;
    const maxPhotos = 20;
    if (m.photoUrls.length >= maxPhotos) {
      toast.error(`Max ${maxPhotos} photos per unit`);
      return;
    }
    const cap = maxPhotos - m.photoUrls.length;
    const toRead = Array.from(files)
      .filter((f) => f.type.startsWith('image/'))
      .slice(0, cap);

    setPhotoUploading(true);
    const newUrls: string[] = [];

    for (const file of toRead) {
      try {
        // Try uploading to Supabase Storage first
        const supabase = createClient();
        const { data: { session: s } } = await supabase.auth.getSession();
        if (s?.user) {
          const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
          const path = `${m.id}/${Date.now()}-${uuidv4().slice(0, 8)}.${ext}`;
          const { error: upErr } = await supabase.storage.from('equipment-photos').upload(path, file, {
            upsert: false,
            contentType: file.type || 'image/jpeg',
          });
          if (!upErr) {
            const { data: pub } = supabase.storage.from('equipment-photos').getPublicUrl(path);
            newUrls.push(pub.publicUrl);
            continue;
          }
          // If storage fails, fall back to base64
          console.warn('Storage upload failed, falling back to base64:', upErr.message);
        }

        // Fallback: base64 encoding with compression
        const originalDataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('read'));
          reader.readAsDataURL(file);
        });
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            const MAX = 800;
            const scale = Math.min(1, MAX / Math.max(img.width, img.height));
            const w = Math.round(img.width * scale);
            const h = Math.round(img.height * scale);
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (!ctx) { reject(new Error('canvas')); return; }
            ctx.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/jpeg', 0.75));
          };
          img.onerror = () => reject(new Error('decode'));
          img.src = originalDataUrl;
        });
        if (dataUrl.length > MAX_COMPRESSED_IMAGE_BYTES) {
          toast.error('Image still too large after compression — use a smaller photo');
          continue;
        }
        newUrls.push(dataUrl);
      } catch {
        toast.error('Could not process image');
      }
    }
    setPhotoUploading(false);
    if (newUrls.length > 0) {
      onUpdate({ photoUrls: [...m.photoUrls, ...newUrls] });
      toast.success('Photo(s) saved');
    }
  }

  function removePhoto(idx: number) {
    const updated = m.photoUrls.filter((_, i) => i !== idx);
    const newThumb = m.thumbnailIndex >= updated.length ? 0 : m.thumbnailIndex;
    onUpdate({ photoUrls: updated, thumbnailIndex: newThumb });
  }

  function setAsThumbnail(idx: number) {
    onUpdate({ thumbnailIndex: idx });
    toast.success('Thumbnail updated');
  }

  function handleCheckout() {
    const hrs = parseFloat(checkoutForm.hours);
    const mi = parseFloat(checkoutForm.mileage);
    const fuel = parseFloat(checkoutForm.fuelLevel);
    const record: CheckoutRecord = {
      id: uuidv4(),
      checkedOutBy: '', // Will be set server-side in future; for now display name
      checkedOutByName: checkoutForm.operatorName || 'Unknown',
      jobId: checkoutForm.jobId,
      checkoutAt: new Date().toISOString(),
      checkoutHours: Number.isFinite(hrs) ? hrs : null,
      checkoutMileage: Number.isFinite(mi) ? mi : null,
      checkoutFuelLevel: Number.isFinite(fuel) ? fuel : null,
      checkoutCondition: checkoutForm.condition,
      checkoutNotes: checkoutForm.notes,
      checkoutLocation: checkoutForm.location,
      returnedAt: null,
      returnHours: null,
      returnMileage: null,
      returnFuelLevel: null,
      returnCondition: null,
      returnNotes: '',
      returnLocation: '',
      status: 'checked_out',
    };
    const patch: Partial<Machine> = {
      checkoutHistory: [record, ...m.checkoutHistory],
      status: 'active' as MachineStatus,
      operator: checkoutForm.operatorName || m.operator,
    };
    if (Number.isFinite(hrs)) patch.hours = hrs;
    if (Number.isFinite(mi)) patch.mileage = mi;
    if (Number.isFinite(fuel)) patch.fuelLevel = fuel;
    if (checkoutForm.condition) patch.condition = checkoutForm.condition;
    if (checkoutForm.location) patch.lastLocation = checkoutForm.location;
    if (checkoutForm.jobId) patch.currentJob = checkoutForm.jobId;
    onUpdate(patch);
    toast.success('Equipment checked out');
    setCheckoutForm((f) => ({ ...f, notes: '' }));
  }

  function handleReturn() {
    const last = m.checkoutHistory[0];
    if (!last || last.status !== 'checked_out') {
      toast.error('Equipment is not currently checked out');
      return;
    }
    const hrs = parseFloat(checkoutForm.hours);
    const mi = parseFloat(checkoutForm.mileage);
    const fuel = parseFloat(checkoutForm.fuelLevel);
    const updated: CheckoutRecord = {
      ...last,
      status: 'returned',
      returnedAt: new Date().toISOString(),
      returnHours: Number.isFinite(hrs) ? hrs : null,
      returnMileage: Number.isFinite(mi) ? mi : null,
      returnFuelLevel: Number.isFinite(fuel) ? fuel : null,
      returnCondition: checkoutForm.condition,
      returnNotes: checkoutForm.notes,
      returnLocation: checkoutForm.location,
    };
    const patch: Partial<Machine> = {
      checkoutHistory: [updated, ...m.checkoutHistory.slice(1)],
      status: 'idle' as MachineStatus,
      operator: 'Unassigned',
      currentJob: '',
    };
    if (Number.isFinite(hrs)) patch.hours = hrs;
    if (Number.isFinite(mi)) patch.mileage = mi;
    if (Number.isFinite(fuel)) patch.fuelLevel = fuel;
    if (checkoutForm.condition) patch.condition = checkoutForm.condition;
    if (checkoutForm.location) patch.lastLocation = checkoutForm.location;
    onUpdate(patch);
    toast.success('Equipment returned');
    setCheckoutForm((f) => ({ ...f, notes: '' }));
  }

  const lastCheckout = m.checkoutHistory[0];
  const isCheckedOut = lastCheckout && lastCheckout.status === 'checked_out';

  return (
    <div className="w-full min-w-0 max-w-full lg:w-[min(28rem,100%)] lg:max-w-[min(28rem,calc(100vw-18rem-3rem))] border-2 border-[#FF6B00] bg-[#1c1b1b] p-3 sm:p-4 shrink-0 lg:sticky lg:top-[calc(5.5rem+env(safe-area-inset-top,0px))] flex flex-col max-h-[min(85dvh,32rem)] lg:max-h-[calc(100dvh-5.5rem-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px))]">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <span className="font-black text-lg uppercase text-[#FF6B00] block truncate">{m.name}</span>
          <span className="font-mono text-[10px] text-[#5a4136]">{m.id}</span>
        </div>
        <button type="button" onClick={onClose} className="text-[#5a4136] hover:text-[#a98a7d] text-xs font-bold shrink-0">
          CLOSE
        </button>
      </div>

      <div className="flex gap-1 mb-4 border-b border-[#353534] pb-2">
        {(['details', 'notes', 'logs', 'checkout'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setDetailTab(t)}
            className={`px-2 py-1 text-[10px] font-black uppercase tracking-wider border ${
              detailTab === t ? 'border-[#FF6B00] text-[#FF6B00]' : 'border-transparent text-[#5a4136] hover:text-[#a98a7d]'
            }`}
          >
            {t === 'checkout' ? (isCheckedOut ? '↩ Return' : '⬆ Checkout') : t}
          </button>
        ))}
      </div>

      <div className="overflow-y-auto overflow-x-hidden flex-1 min-h-0 space-y-3 text-xs pr-1 touch-pan-y">
        {detailTab === 'details' && (
          <>
            <div className="border-b border-[#353534] pb-3 min-w-0">
              <div className="text-[10px] text-[#5a4136] uppercase tracking-widest mb-1">Category</div>
              <select
                value={m.category}
                onChange={(e) => onUpdate({ category: e.target.value as EquipmentCategory })}
                className="w-full bg-[#1c1b1b] border border-[#353534] px-2 py-1.5 text-[#a98a7d] text-sm"
              >
                {EQUIPMENT_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <FieldRow label="TYPE" value={m.type} onChange={(type) => onUpdate({ type })} />
            <FieldRow label="MAKE" value={m.make} onChange={(make) => onUpdate({ make })} />
            <FieldRow label="MODEL" value={m.model} onChange={(model) => onUpdate({ model })} />
            <FieldRow label="SERIAL NUMBER" value={m.serialNumber} onChange={(serialNumber) => onUpdate({ serialNumber })} />
            <FieldRow label="OPERATOR" value={m.operator} onChange={(operator) => onUpdate({ operator })} />
            <FieldRow label="LOCATION" value={m.lastLocation} onChange={(lastLocation) => onUpdate({ lastLocation })} />

            <div className="border-b border-[#353534] pb-3 min-w-0">
              <div className="text-[10px] text-[#5a4136] uppercase tracking-wide mb-1">Job / ref</div>
              <select
                value={selectedJobSelectValue}
                onChange={(e) => onUpdate({ currentJob: e.target.value })}
                className="w-full min-w-0 max-w-full bg-[#1c1b1b] border border-[#353534] px-2 py-1.5 text-[#a98a7d] mb-2 text-sm"
              >
                <option value="">— Unassigned —</option>
                {jobOptions.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title || j.id} ({j.id})
                  </option>
                ))}
              </select>
              <div className="text-[10px] text-[#5a4136] mb-1">Or bid / external ref</div>
              <input
                value={m.currentJob}
                onChange={(e) => onUpdate({ currentJob: e.target.value })}
                className="w-full min-w-0 max-w-full bg-[#1c1b1b] border border-[#353534] px-2 py-1.5 font-mono text-sm break-all"
                placeholder="e.g. CCC-2604-412"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <LabeledNumber label="HOUR_METER" value={m.hours} onCommit={(hours) => onUpdate({ hours: Math.max(0, hours) })} />
              <LabeledNumber
                label="FUEL_GAUGE_%"
                value={m.fuelLevel}
                onCommit={(fuelLevel) => onUpdate({ fuelLevel: Math.min(100, Math.max(0, fuelLevel)) })}
                max={100}
              />
              <LabeledNumber label="MILEAGE" value={m.mileage} onCommit={(mileage) => onUpdate({ mileage: Math.max(0, mileage) })} />
              <LabeledNumber
                label="ACRES_TODAY"
                value={m.dailyAcres}
                onCommit={(dailyAcres) => onUpdate({ dailyAcres: Math.max(0, dailyAcres) })}
                step={0.1}
              />
              <LabeledNumber
                label="AVG_GAL/HR"
                value={m.avgFuelPerHr}
                onCommit={(avgFuelPerHr) => onUpdate({ avgFuelPerHr: Math.max(0, avgFuelPerHr) })}
                step={0.1}
              />
              <LabeledNumber
                label="YEAR"
                value={m.year ?? 0}
                onCommit={(year) => onUpdate({ year: year > 0 ? year : null })}
              />
            </div>

            <div className="border-b border-[#353534] pb-3 min-w-0">
              <div className="text-[10px] text-[#5a4136] uppercase tracking-widest mb-1">CONDITION</div>
              <select
                value={m.condition}
                onChange={(e) => onUpdate({ condition: e.target.value as EquipmentCondition })}
                className="w-full bg-[#1c1b1b] border border-[#353534] px-2 py-1.5 text-[#a98a7d] text-sm"
              >
                {EQUIPMENT_CONDITIONS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>

            <div className="border-b border-[#353534] pb-3">
              <div className="text-[10px] text-[#5a4136] uppercase tracking-widest mb-1">NEXT_SERVICE</div>
              <input
                type="date"
                value={m.nextService?.slice(0, 10) ?? ''}
                onChange={(e) => onUpdate({ nextService: e.target.value })}
                className="w-full bg-[#1c1b1b] border border-[#353534] px-2 py-1.5 font-mono"
              />
              <div className="text-[10px] text-[#5a4136] uppercase tracking-widest mb-1 mt-2">SERVICE_DUE_HOURS</div>
              <input
                type="number"
                value={m.nextServiceHours || ''}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  onUpdate({ nextServiceHours: Number.isFinite(v) ? Math.max(0, v) : 0 });
                }}
                className="w-full bg-[#1c1b1b] border border-[#353534] px-2 py-1.5 font-mono"
                placeholder="e.g. 4500"
              />
              {m.nextServiceHours > 0 && m.hours >= m.nextServiceHours - 50 && (
                <div className="text-red-400 text-[10px] font-bold mt-1">⚠ SERVICE DUE — {m.nextServiceHours - m.hours} hrs remaining</div>
              )}
            </div>

            <div>
              <div className="text-[10px] text-[#5a4136] uppercase tracking-widest mb-2">SET_STATUS</div>
              <div className="grid grid-cols-2 gap-2">
                {(['active', 'idle', 'maintenance', 'offline'] as MachineStatus[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => onStatus(s)}
                    className={`px-2 py-1.5 text-[10px] font-bold uppercase border transition-all ${
                      m.status === s
                        ? `${STATUS_STYLES[s].bg} ${STATUS_STYLES[s].text}`
                        : 'border-[#353534] text-[#5a4136] hover:text-[#a98a7d] hover:border-[#a98a7d]'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={onRemove}
              className="w-full py-2 text-[10px] font-black uppercase border border-red-900 text-red-500 hover:bg-red-950/40"
            >
              Remove unit from fleet
            </button>
          </>
        )}

        {detailTab === 'notes' && (
          <>
            <div className="text-[10px] text-[#5a4136] uppercase tracking-widest mb-1">UNIT_NOTES</div>
            <textarea
              value={m.notes}
              onChange={(e) => onUpdate({ notes: e.target.value })}
              rows={6}
              className="w-full min-w-0 max-h-40 sm:max-h-48 bg-[#1c1b1b] border border-[#353534] px-2 py-2 text-[#a98a7d] font-mono text-[11px] leading-relaxed resize-y min-h-[100px] overflow-y-auto"
            />
            <div className="text-[10px] text-[#5a4136] uppercase tracking-widest mb-1 mt-4">PHOTOS ({m.photoUrls.length}/20)</div>
            <p className="text-[10px] text-[#5a4136] mb-2">Click a photo to set it as the list thumbnail. Photos are stored in Supabase Storage when available.</p>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(e) => void onPhotoPick(e)}
              className="text-[10px] w-full"
              disabled={photoUploading}
            />
            {photoUploading && <div className="text-[10px] text-[#FF6B00] font-mono animate-pulse">Uploading…</div>}
            <div className="grid grid-cols-3 gap-2 mt-2">
              {m.photoUrls.map((url, idx) => (
                <div
                  key={idx}
                  className={`relative border-2 aspect-square bg-black cursor-pointer ${idx === m.thumbnailIndex ? 'border-[#13ff43]' : 'border-[#353534]'}`}
                  onClick={() => setAsThumbnail(idx)}
                  title="Click to set as thumbnail"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="w-full h-full object-cover" />
                  {idx === m.thumbnailIndex && (
                    <div className="absolute bottom-0 left-0 right-0 bg-[#13ff43]/90 text-black text-[8px] font-black uppercase text-center py-0.5">
                      THUMBNAIL
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removePhoto(idx); }}
                    className="absolute top-1 right-1 bg-black/80 text-red-400 text-[10px] px-1 font-bold hover:bg-red-900/80"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {detailTab === 'logs' && (
          <>
            <div className="border border-[#353534] p-2 space-y-2">
              <div className="text-[10px] font-bold text-[#FF6B00] uppercase">Log hours</div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={hoursForm.dateISO}
                  onChange={(e) => setHoursForm((f) => ({ ...f, dateISO: e.target.value }))}
                  className="bg-[#1c1b1b] border border-[#353534] px-1 py-1 font-mono text-[10px]"
                />
                <input
                  placeholder="+/- hours"
                  value={hoursForm.delta}
                  onChange={(e) => setHoursForm((f) => ({ ...f, delta: e.target.value }))}
                  className="bg-[#1c1b1b] border border-[#353534] px-1 py-1 font-mono text-[10px]"
                />
              </div>
              <input
                placeholder="Note (optional)"
                value={hoursForm.note}
                onChange={(e) => setHoursForm((f) => ({ ...f, note: e.target.value }))}
                className="w-full bg-[#1c1b1b] border border-[#353534] px-1 py-1 text-[10px]"
              />
              <button type="button" onClick={appendHours} className="text-[10px] font-black uppercase bg-[#353534] px-2 py-1 w-full">
                Add & apply to meter
              </button>
            </div>

            <div className="border border-[#353534] p-2 space-y-2">
              <div className="text-[10px] font-bold text-[#FF6B00] uppercase">Log fuel</div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={fuelForm.dateISO}
                  onChange={(e) => setFuelForm((f) => ({ ...f, dateISO: e.target.value }))}
                  className="bg-[#1c1b1b] border border-[#353534] px-1 py-1 font-mono text-[10px]"
                />
                <input
                  placeholder="Gallons"
                  value={fuelForm.gallons}
                  onChange={(e) => setFuelForm((f) => ({ ...f, gallons: e.target.value }))}
                  className="bg-[#1c1b1b] border border-[#353534] px-1 py-1 font-mono text-[10px]"
                />
              </div>
              <input
                placeholder="Note"
                value={fuelForm.note}
                onChange={(e) => setFuelForm((f) => ({ ...f, note: e.target.value }))}
                className="w-full bg-[#1c1b1b] border border-[#353534] px-1 py-1 text-[10px]"
              />
              <button type="button" onClick={appendFuel} className="text-[10px] font-black uppercase bg-[#353534] px-2 py-1 w-full">
                Add fuel entry
              </button>
            </div>

            <div className="border border-[#353534] p-2 space-y-2">
              <div className="text-[10px] font-bold text-[#FF6B00] uppercase">Maintenance</div>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={maintForm.kind}
                  onChange={(e) =>
                    setMaintForm((f) => ({ ...f, kind: e.target.value as MaintenanceLogEntry['kind'] }))
                  }
                  className="bg-[#1c1b1b] border border-[#353534] px-1 py-1 text-[10px]"
                >
                  <option value="service">Service</option>
                  <option value="repair">Repair</option>
                  <option value="inspection">Inspection</option>
                  <option value="other">Other</option>
                </select>
                <input
                  type="date"
                  value={maintForm.dateISO}
                  onChange={(e) => setMaintForm((f) => ({ ...f, dateISO: e.target.value }))}
                  className="bg-[#1c1b1b] border border-[#353534] px-1 py-1 font-mono text-[10px]"
                />
              </div>
              <textarea
                placeholder="What was done"
                value={maintForm.description}
                onChange={(e) => setMaintForm((f) => ({ ...f, description: e.target.value }))}
                rows={2}
                className="w-full bg-[#1c1b1b] border border-[#353534] px-1 py-1 text-[10px]"
              />
              <button type="button" onClick={appendMaintenance} className="text-[10px] font-black uppercase bg-[#353534] px-2 py-1 w-full">
                Add maintenance entry
              </button>
            </div>

            <div className="text-[10px] text-[#a98a7d] font-bold uppercase tracking-widest">Hours history</div>
            <ul className="space-y-1 max-h-28 overflow-y-auto font-mono text-[10px]">
              {m.hoursLog.length === 0 && <li className="text-[#5a4136]">No entries</li>}
              {m.hoursLog.map((e) => (
                <li key={e.id} className="border-b border-[#2a2a2a] pb-1">
                  {e.dateISO.slice(0, 10)} · {e.deltaHours > 0 ? '+' : ''}
                  {e.deltaHours}h {e.note ? `— ${e.note}` : ''}
                </li>
              ))}
            </ul>

            <div className="text-[10px] text-[#a98a7d] font-bold uppercase tracking-widest">Fuel history</div>
            <ul className="space-y-1 max-h-28 overflow-y-auto font-mono text-[10px]">
              {m.fuelLog.length === 0 && <li className="text-[#5a4136]">No entries</li>}
              {m.fuelLog.map((e) => (
                <li key={e.id} className="border-b border-[#2a2a2a] pb-1">
                  {e.dateISO.slice(0, 10)} · {e.gallons} gal {e.note ? `— ${e.note}` : ''}
                </li>
              ))}
            </ul>

            <div className="text-[10px] text-[#a98a7d] font-bold uppercase tracking-widest">Maintenance history</div>
            <ul className="space-y-1 max-h-32 overflow-y-auto text-[10px]">
              {m.maintenanceLog.length === 0 && <li className="text-[#5a4136]">No entries</li>}
              {m.maintenanceLog.map((e) => (
                <li key={e.id} className="border-b border-[#2a2a2a] pb-1">
                  <span className="font-mono text-[#ffb693]">{e.dateISO.slice(0, 10)}</span> · {e.kind} @ {e.hoursAtEntry ?? '—'}h
                  <div className="text-[#a98a7d]">{e.description}</div>
                </li>
              ))}
            </ul>
          </>
        )}

        {detailTab === 'checkout' && (
          <>
            <div className={`border-2 p-3 space-y-3 ${isCheckedOut ? 'border-cyan-800' : 'border-[#353534]'}`}>
              <div className="text-[10px] font-bold uppercase tracking-widest text-[#FF6B00]">
                {isCheckedOut ? '↩ RETURN EQUIPMENT' : '⬆ CHECK OUT EQUIPMENT'}
              </div>
              {isCheckedOut && (
                <div className="text-[10px] text-cyan-400 font-mono">
                  Checked out by {lastCheckout.checkedOutByName} on {new Date(lastCheckout.checkoutAt).toLocaleDateString()}
                  {lastCheckout.jobId && <span> · Job: {lastCheckout.jobId}</span>}
                </div>
              )}
              <label className="block space-y-1">
                <span className="text-[10px] text-[#5a4136] uppercase">Operator</span>
                <input
                  value={checkoutForm.operatorName}
                  onChange={(e) => setCheckoutForm((f) => ({ ...f, operatorName: e.target.value }))}
                  className="w-full bg-[#1c1b1b] border border-[#353534] px-2 py-1.5 text-[10px]"
                  placeholder="Who is checking this out?"
                />
              </label>
              {!isCheckedOut && (
                <label className="block space-y-1">
                  <span className="text-[10px] text-[#5a4136] uppercase">Assign to Job</span>
                  <select
                    value={checkoutForm.jobId}
                    onChange={(e) => setCheckoutForm((f) => ({ ...f, jobId: e.target.value }))}
                    className="w-full bg-[#1c1b1b] border border-[#353534] px-2 py-1.5 text-[10px]"
                  >
                    <option value="">— No job —</option>
                    {jobOptions.map((j) => (
                      <option key={j.id} value={j.id}>{j.title || j.id}</option>
                    ))}
                  </select>
                </label>
              )}
              <div className="text-[10px] font-bold text-[#a98a7d] uppercase tracking-widest">Telematics Snapshot</div>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-[9px] text-[#5a4136] uppercase">Hours</span>
                  <input
                    type="number"
                    value={checkoutForm.hours}
                    onChange={(e) => setCheckoutForm((f) => ({ ...f, hours: e.target.value }))}
                    className="w-full bg-[#1c1b1b] border border-[#353534] px-2 py-1.5 font-mono text-[10px]"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[9px] text-[#5a4136] uppercase">Mileage</span>
                  <input
                    type="number"
                    value={checkoutForm.mileage}
                    onChange={(e) => setCheckoutForm((f) => ({ ...f, mileage: e.target.value }))}
                    className="w-full bg-[#1c1b1b] border border-[#353534] px-2 py-1.5 font-mono text-[10px]"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[9px] text-[#5a4136] uppercase">Fuel Level %</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={checkoutForm.fuelLevel}
                    onChange={(e) => setCheckoutForm((f) => ({ ...f, fuelLevel: e.target.value }))}
                    className="w-full bg-[#1c1b1b] border border-[#353534] px-2 py-1.5 font-mono text-[10px]"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[9px] text-[#5a4136] uppercase">Condition</span>
                  <select
                    value={checkoutForm.condition}
                    onChange={(e) => setCheckoutForm((f) => ({ ...f, condition: e.target.value as EquipmentCondition }))}
                    className="w-full bg-[#1c1b1b] border border-[#353534] px-2 py-1.5 text-[10px]"
                  >
                    {EQUIPMENT_CONDITIONS.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block space-y-1">
                <span className="text-[9px] text-[#5a4136] uppercase">Location</span>
                <input
                  value={checkoutForm.location}
                  onChange={(e) => setCheckoutForm((f) => ({ ...f, location: e.target.value }))}
                  className="w-full bg-[#1c1b1b] border border-[#353534] px-2 py-1.5 text-[10px]"
                  placeholder="Where is this equipment going?"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[9px] text-[#5a4136] uppercase">Notes</span>
                <textarea
                  value={checkoutForm.notes}
                  onChange={(e) => setCheckoutForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  className="w-full bg-[#1c1b1b] border border-[#353534] px-2 py-1.5 text-[10px]"
                  placeholder="Any notes on condition, issues, etc."
                />
              </label>
              {isCheckedOut ? (
                <button
                  type="button"
                  onClick={handleReturn}
                  className="w-full py-2 text-[10px] font-black uppercase bg-cyan-600 text-black"
                >
                  ↩ Return equipment
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleCheckout}
                  className="w-full py-2 text-[10px] font-black uppercase bg-[#13ff43] text-black"
                >
                  ⬆ Check out equipment
                </button>
              )}
            </div>

            <div className="text-[10px] text-[#a98a7d] font-bold uppercase tracking-widest mt-4">Checkout History</div>
            <ul className="space-y-2 max-h-48 overflow-y-auto text-[10px]">
              {m.checkoutHistory.length === 0 && <li className="text-[#5a4136]">No checkout records</li>}
              {m.checkoutHistory.map((c) => (
                <li key={c.id} className={`border p-2 ${c.status === 'checked_out' ? 'border-cyan-800 bg-cyan-900/10' : 'border-[#2a2a2a]'}`}>
                  <div className="flex justify-between">
                    <span className="font-bold text-[#ffb693]">{c.checkedOutByName}</span>
                    <span className={`font-bold uppercase ${c.status === 'checked_out' ? 'text-cyan-400' : 'text-[#5a4136]'}`}>{c.status.replace('_', ' ')}</span>
                  </div>
                  <div className="text-[#5a4136] font-mono mt-1">
                    Out: {new Date(c.checkoutAt).toLocaleString()}
                    {c.returnedAt && <span> · In: {new Date(c.returnedAt).toLocaleString()}</span>}
                  </div>
                  <div className="text-[#5a4136] mt-1">
                    {c.checkoutHours != null && <span>Hrs: {c.checkoutHours}{c.returnHours != null && ` → ${c.returnHours}`} · </span>}
                    {c.checkoutMileage != null && <span>Mi: {c.checkoutMileage}{c.returnMileage != null && ` → ${c.returnMileage}`} · </span>}
                    {c.checkoutCondition && <span>Cond: {c.checkoutCondition}{c.returnCondition && ` → ${c.returnCondition}`}</span>}
                  </div>
                  {c.checkoutNotes && <div className="text-[#a98a7d] mt-1">Out: {c.checkoutNotes}</div>}
                  {c.returnNotes && <div className="text-[#a98a7d]">In: {c.returnNotes}</div>}
                  {c.jobId && <div className="text-[#13ff43] font-mono mt-1">Job: {c.jobId}</div>}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function FieldRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="border-b border-[#353534] pb-3 min-w-0">
      <div className="text-[10px] text-[#5a4136] uppercase tracking-widest mb-1 break-words">{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full min-w-0 max-w-full bg-[#1c1b1b] border border-[#353534] px-2 py-1.5 text-[#a98a7d] text-sm break-words"
      />
    </div>
  );
}

function LabeledNumber({
  label,
  value,
  onCommit,
  max,
  step = 1,
}: {
  label: string;
  value: number;
  onCommit: (n: number) => void;
  max?: number;
  step?: number;
}) {
  const [local, setLocal] = useState(String(value));
  useEffect(() => {
    setLocal(String(value));
  }, [value]);
  return (
    <div className="min-w-0">
      <div className="text-[9px] sm:text-[10px] text-[#5a4136] uppercase tracking-wide mb-1 break-words leading-tight">{label}</div>
      <input
        type="number"
        value={local}
        min={0}
        max={max}
        step={step}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          const n = parseFloat(local);
          if (!Number.isFinite(n)) setLocal(String(value));
          else onCommit(n);
        }}
        className="w-full min-w-0 max-w-full bg-[#1c1b1b] border border-[#353534] px-2 py-1.5 font-mono text-sm"
      />
    </div>
  );
}
