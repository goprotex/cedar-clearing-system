'use client';

import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import AppShell from '@/components/AppShell';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import {
  type Machine,
  type MachineStatus,
  type MaintenanceLogEntry,
  type FuelLogEntry,
  type HoursLogEntry,
  saveFleetMachines,
  newMachineId,
  loadFleetJobOptions,
  sumHoursLoggedToday,
  DEFAULT_FLEET,
  initialFleetForClient,
} from '@/lib/fleet-storage';
import type { ActiveJobSummary } from '@/lib/active-jobs';

const STORAGE_KEY = 'ccc_fleet';

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

export default function FleetClient() {
  const [fleet, setFleet] = useState<Machine[]>(() => initialFleetForClient());
  const [filter, setFilter] = useState<MachineStatus | 'all'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [jobListTick, setJobListTick] = useState(0);
  void jobListTick;
  const jobOptions = loadFleetJobOptions();
  const [detailTab, setDetailTab] = useState<'details' | 'notes' | 'logs'>('details');
  const [addOpen, setAddOpen] = useState(false);
  const [newForm, setNewForm] = useState({
    name: '',
    type: 'Equipment',
    model: '',
    operator: 'Unassigned',
    lastLocation: '',
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!localStorage.getItem(STORAGE_KEY)) {
      saveFleetMachines(DEFAULT_FLEET);
    }
  }, []);

  const persist = useCallback((next: Machine[]) => {
    setFleet(next);
    saveFleetMachines(next);
  }, []);

  const filtered = filter === 'all' ? fleet : fleet.filter((m) => m.status === filter);
  const selected = fleet.find((m) => m.id === selectedId) || null;

  const counts = {
    all: fleet.length,
    active: fleet.filter((m) => m.status === 'active').length,
    idle: fleet.filter((m) => m.status === 'idle').length,
    maintenance: fleet.filter((m) => m.status === 'maintenance').length,
    offline: fleet.filter((m) => m.status === 'offline').length,
  };

  const hoursToday = sumHoursLoggedToday(fleet);
  const totalAcresToday = fleet.reduce((s, m) => s + m.dailyAcres, 0);
  const avgFuelLevel =
    fleet.length === 0 ? 0 : Math.round(fleet.reduce((s, m) => s + m.fuelLevel, 0) / fleet.length);

  const updateMachine = useCallback(
    (id: string, patch: Partial<Machine>) => {
      const next = fleet.map((m) => (m.id === id ? { ...m, ...patch } : m));
      persist(next);
    },
    [fleet, persist],
  );

  function updateMachineStatus(id: string, status: MachineStatus) {
    const next = fleet.map((m) => (m.id === id ? { ...m, status } : m));
    persist(next);
    toast.success(`${id} status → ${status.toUpperCase()}`);
  }

  function removeMachine(id: string) {
    const m = fleet.find((x) => x.id === id);
    if (!m) return;
    if (!window.confirm(`Remove ${m.name} (${id}) from fleet? This cannot be undone.`)) return;
    const next = fleet.filter((x) => x.id !== id);
    persist(next);
    if (selectedId === id) setSelectedId(null);
    toast.success('Unit removed');
  }

  function addMachine() {
    const name = newForm.name.trim();
    if (!name) {
      toast.error('Enter a unit name');
      return;
    }
    const m: Machine = {
      id: newMachineId(),
      name: name.toUpperCase().replace(/\s+/g, '_'),
      type: newForm.type.trim() || 'Equipment',
      model: newForm.model.trim() || '—',
      status: 'idle',
      hours: 0,
      fuelLevel: 0,
      lastLocation: newForm.lastLocation.trim() || '—',
      operator: newForm.operator.trim() || 'Unassigned',
      currentJob: '',
      dailyAcres: 0,
      avgFuelPerHr: 0,
      nextService: '',
      notes: '',
      photoUrls: [],
      maintenanceLog: [],
      fuelLog: [],
      hoursLog: [],
    };
    persist([...fleet, m]);
    setSelectedId(m.id);
    setAddOpen(false);
    setNewForm({ name: '', type: 'Equipment', model: '', operator: 'Unassigned', lastLocation: '' });
    toast.success(`Added ${m.id}`);
  }

  const selectedJobSelectValue = useMemo(() => {
    if (!selected) return '';
    const match = jobOptions.some((j) => j.id === selected.currentJob);
    return match ? selected.currentJob : '';
  }, [selected, jobOptions]);

  return (
    <AppShell>
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-4 border-l-4 border-[#FF6B00] pl-4 mb-8">
        <div>
          <h1 className="text-4xl font-black uppercase tracking-tighter">FLEET_SYNC</h1>
          <p className="text-[#ffb693] text-xs font-mono">
            {fleet.length} UNITS // MANUAL_ENTRY · LOCAL_STORAGE
          </p>
          <p className="text-[#5a4136] text-[10px] font-mono mt-1 max-w-xl">
            Telemetry is not wired yet — add equipment, assign jobs, photos, notes, hours, fuel, and maintenance by hand.
            Job list comes from converted jobs on this device; refresh after creating jobs in the estimator.
          </p>
        </div>
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
      </div>

      {addOpen && (
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
              <span className="text-[#5a4136]">Type</span>
              <input
                value={newForm.type}
                onChange={(e) => setNewForm((f) => ({ ...f, type: e.target.value }))}
                className="w-full bg-[#1c1b1b] border border-[#353534] px-2 py-1.5"
                placeholder="Tracked mulcher, dozer…"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[#5a4136]">Model</span>
              <input
                value={newForm.model}
                onChange={(e) => setNewForm((f) => ({ ...f, model: e.target.value }))}
                className="w-full bg-[#1c1b1b] border border-[#353534] px-2 py-1.5"
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
            <label className="space-y-1 md:col-span-2">
              <span className="text-[#5a4136]">Last known location</span>
              <input
                value={newForm.lastLocation}
                onChange={(e) => setNewForm((f) => ({ ...f, lastLocation: e.target.value }))}
                className="w-full bg-[#1c1b1b] border border-[#353534] px-2 py-1.5"
                placeholder="Yard, ranch name, county…"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={addMachine}
            className="px-4 py-2 text-xs font-black uppercase bg-[#13ff43] text-black"
          >
            Create unit
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="border-2 border-[#353534] p-4">
          <div className="text-[10px] text-[#a98a7d] font-bold uppercase tracking-widest mb-1">ACTIVE_UNITS</div>
          <div className="text-3xl font-black text-[#13ff43]">{counts.active}</div>
          <div className="text-[10px] text-[#5a4136] font-mono">of {fleet.length} total</div>
        </div>
        <div className="border-2 border-[#353534] p-4">
          <div className="text-[10px] text-[#a98a7d] font-bold uppercase tracking-widest mb-1">HOURS_LOGGED_TODAY</div>
          <div className="text-3xl font-black text-[#FF6B00]">{hoursToday.toFixed(1)}</div>
          <div className="text-[10px] text-[#5a4136] font-mono">manual log entries</div>
        </div>
        <div className="border-2 border-[#353534] p-4">
          <div className="text-[10px] text-[#a98a7d] font-bold uppercase tracking-widest mb-1">ACRES_TODAY</div>
          <div className="text-3xl font-black text-[#ffb693]">{totalAcresToday.toFixed(1)}</div>
          <div className="text-[10px] text-[#5a4136] font-mono">entered per unit</div>
        </div>
        <div className="border-2 border-[#353534] p-4">
          <div className="text-[10px] text-[#a98a7d] font-bold uppercase tracking-widest mb-1">AVG_FUEL</div>
          <div
            className="text-3xl font-black"
            style={{ color: avgFuelLevel > 50 ? '#13ff43' : avgFuelLevel > 25 ? '#FF6B00' : '#ff4444' }}
          >
            {fleet.length ? `${avgFuelLevel}%` : '—'}
          </div>
          <div className="text-[10px] text-[#5a4136] font-mono">gauge (manual)</div>
        </div>
      </div>

      <div className="flex gap-2 mb-6 flex-wrap">
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

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-1 space-y-3">
          {filtered.length === 0 && (
            <div className="border-2 border-[#353534] p-12 text-center">
              <p className="text-lg font-black uppercase tracking-tight text-[#a98a7d]">NO_UNITS_MATCH</p>
              <p className="text-xs text-[#5a4136] mt-2">Add equipment or change the filter.</p>
            </div>
          )}
          {filtered.map((m) => {
            const style = STATUS_STYLES[m.status];
            const jobTitle = m.currentJob ? jobLabel(m.currentJob, jobOptions) : '';
            return (
              <div
                key={m.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  setSelectedId(m.id === selectedId ? null : m.id);
                  setDetailTab('details');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelectedId(m.id === selectedId ? null : m.id);
                    setDetailTab('details');
                  }
                }}
                className={`border-2 p-4 cursor-pointer transition-all ${
                  m.id === selectedId
                    ? 'border-[#FF6B00] bg-[#2a2a2a]'
                    : 'border-[#353534] hover:border-[#5a4136] hover:bg-[#1c1b1b]'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
                    <span className="font-mono font-black text-sm text-[#ffb693] shrink-0">{m.id}</span>
                    <span className="font-black text-sm uppercase truncate">{m.name}</span>
                  </div>
                  <span className={`border px-2 py-0.5 text-[10px] font-black uppercase shrink-0 ${style.bg} ${style.text}`}>
                    {m.status}
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-xs">
                  <div>
                    <span className="text-[#5a4136]">MODEL:</span>{' '}
                    <span className="text-[#a98a7d]">{m.model}</span>
                  </div>
                  <div>
                    <span className="text-[#5a4136]">HOURS:</span>{' '}
                    <span className="font-mono">{m.hours.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-[#5a4136]">FUEL:</span>{' '}
                    <span
                      className="font-mono"
                      style={{ color: m.fuelLevel > 50 ? '#13ff43' : m.fuelLevel > 25 ? '#FF6B00' : '#ff4444' }}
                    >
                      {m.fuelLevel}%
                    </span>
                  </div>
                  <div>
                    <span className="text-[#5a4136]">OPERATOR:</span>{' '}
                    <span className="text-[#a98a7d]">{m.operator}</span>
                  </div>
                </div>
                {(m.currentJob || m.lastLocation) && (
                  <div className="mt-2 text-xs space-y-0.5">
                    {m.currentJob && (
                      <div>
                        <span className="text-[#5a4136]">JOB:</span>{' '}
                        <span className="font-mono text-[#13ff43]">{jobTitle}</span>
                        {jobTitle !== m.currentJob && (
                          <span className="text-[#5a4136] ml-1 font-mono text-[10px]">({m.currentJob})</span>
                        )}
                      </div>
                    )}
                    <div>
                      <span className="text-[#5a4136]">LOCATION:</span>{' '}
                      <span className="text-[#a98a7d]">{m.lastLocation}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {selected && (
          <MachineDetailPanel
            machine={selected}
            jobOptions={jobOptions}
            selectedJobSelectValue={selectedJobSelectValue}
            detailTab={detailTab}
            setDetailTab={setDetailTab}
            onClose={() => setSelectedId(null)}
            onUpdate={(patch) => updateMachine(selected.id, patch)}
            onStatus={(s) => updateMachineStatus(selected.id, s)}
            onRemove={() => removeMachine(selected.id)}
          />
        )}
      </div>
    </AppShell>
  );
}

function MachineDetailPanel({
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
  machine: Machine;
  jobOptions: ActiveJobSummary[];
  selectedJobSelectValue: string;
  detailTab: 'details' | 'notes' | 'logs';
  setDetailTab: (t: 'details' | 'notes' | 'logs') => void;
  onClose: () => void;
  onUpdate: (patch: Partial<Machine>) => void;
  onStatus: (s: MachineStatus) => void;
  onRemove: () => void;
}) {
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

  async function onPhotoPick(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    e.target.value = '';
    if (!files?.length) return;
    const maxPhotos = 6;
    if (m.photoUrls.length >= maxPhotos) {
      toast.error(`Max ${maxPhotos} photos per unit (browser storage)`);
      return;
    }
    const cap = maxPhotos - m.photoUrls.length;
    const toRead = Array.from(files)
      .filter((f) => f.type.startsWith('image/'))
      .slice(0, cap);
    const newUrls: string[] = [];
    for (const file of toRead) {
      let data: string;
      try {
        data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('read'));
          reader.readAsDataURL(file);
        });
      } catch {
        toast.error('Could not read image');
        continue;
      }
      if (data.length > 900_000) {
        toast.error('Image too large — try a smaller photo');
        continue;
      }
      newUrls.push(data);
    }
    if (newUrls.length > 0) {
      onUpdate({ photoUrls: [...m.photoUrls, ...newUrls] });
      toast.success('Photo(s) saved locally');
    }
  }

  function removePhoto(idx: number) {
    onUpdate({ photoUrls: m.photoUrls.filter((_, i) => i !== idx) });
  }

  return (
    <div className="w-full lg:w-[28rem] border-2 border-[#FF6B00] bg-[#1c1b1b] p-4 shrink-0 self-start flex flex-col max-h-[85vh]">
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
        {(['details', 'notes', 'logs'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setDetailTab(t)}
            className={`px-2 py-1 text-[10px] font-black uppercase tracking-wider border ${
              detailTab === t ? 'border-[#FF6B00] text-[#FF6B00]' : 'border-transparent text-[#5a4136] hover:text-[#a98a7d]'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="overflow-y-auto flex-1 space-y-3 text-xs pr-1">
        {detailTab === 'details' && (
          <>
            <FieldRow label="TYPE" value={m.type} onChange={(type) => onUpdate({ type })} />
            <FieldRow label="MODEL" value={m.model} onChange={(model) => onUpdate({ model })} />
            <FieldRow label="OPERATOR" value={m.operator} onChange={(operator) => onUpdate({ operator })} />
            <FieldRow label="LOCATION" value={m.lastLocation} onChange={(lastLocation) => onUpdate({ lastLocation })} />

            <div className="border-b border-[#353534] pb-3">
              <div className="text-[10px] text-[#5a4136] uppercase tracking-widest mb-1">ASSIGN_JOB</div>
              <select
                value={selectedJobSelectValue}
                onChange={(e) => {
                  const v = e.target.value;
                  onUpdate({ currentJob: v });
                }}
                className="w-full bg-[#1c1b1b] border border-[#353534] px-2 py-1.5 text-[#a98a7d] mb-2"
              >
                <option value="">— Unassigned —</option>
                {jobOptions.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title || j.id} ({j.id})
                  </option>
                ))}
              </select>
              <div className="text-[10px] text-[#5a4136] mb-1">Or bid / external ref (free text)</div>
              <input
                value={m.currentJob}
                onChange={(e) => onUpdate({ currentJob: e.target.value })}
                className="w-full bg-[#1c1b1b] border border-[#353534] px-2 py-1.5 font-mono"
                placeholder="e.g. CCC-2604-412 or job_…"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <LabeledNumber
                label="HOUR_METER"
                value={m.hours}
                onCommit={(hours) => onUpdate({ hours: Math.max(0, hours) })}
              />
              <LabeledNumber
                label="FUEL_GAUGE_%"
                value={m.fuelLevel}
                onCommit={(fuelLevel) => onUpdate({ fuelLevel: Math.min(100, Math.max(0, fuelLevel)) })}
                max={100}
              />
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
            </div>

            <div className="border-b border-[#353534] pb-3">
              <div className="text-[10px] text-[#5a4136] uppercase tracking-widest mb-1">NEXT_SERVICE (date)</div>
              <input
                type="date"
                value={m.nextService?.slice(0, 10) ?? ''}
                onChange={(e) => onUpdate({ nextService: e.target.value })}
                className="w-full bg-[#1c1b1b] border border-[#353534] px-2 py-1.5 font-mono"
              />
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
              rows={10}
              className="w-full bg-[#1c1b1b] border border-[#353534] px-2 py-2 text-[#a98a7d] font-mono text-[11px] leading-relaxed resize-y min-h-[120px]"
              placeholder="Inspection notes, issues, who to call, serial #s…"
            />
            <div className="text-[10px] text-[#5a4136] uppercase tracking-widest mb-1 mt-4">PHOTOS (local only)</div>
            <p className="text-[10px] text-[#5a4136] mb-2">Stored in this browser as data URLs. Keep images small.</p>
            <input type="file" accept="image/*" multiple onChange={onPhotoPick} className="text-[10px] w-full" />
            <div className="grid grid-cols-2 gap-2 mt-2">
              {m.photoUrls.map((url, idx) => (
                <div key={idx} className="relative border border-[#353534] aspect-video bg-black">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removePhoto(idx)}
                    className="absolute top-1 right-1 bg-black/80 text-red-400 text-[10px] px-1 font-bold"
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
                placeholder="Note (station, card #…)"
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
      </div>
    </div>
  );
}

function FieldRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="border-b border-[#353534] pb-3">
      <div className="text-[10px] text-[#5a4136] uppercase tracking-widest mb-1">{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-[#1c1b1b] border border-[#353534] px-2 py-1.5 text-[#a98a7d]"
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
    <div>
      <div className="text-[10px] text-[#5a4136] uppercase tracking-widest mb-1">{label}</div>
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
        className="w-full bg-[#1c1b1b] border border-[#353534] px-2 py-1.5 font-mono"
      />
    </div>
  );
}
