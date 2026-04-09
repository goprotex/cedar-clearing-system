'use client';

import { useState } from 'react';
import AppShell from '@/components/AppShell';
import { toast } from 'sonner';

type MachineStatus = 'active' | 'idle' | 'maintenance' | 'offline';

interface Machine {
  id: string;
  name: string;
  type: string;
  model: string;
  status: MachineStatus;
  hours: number;
  fuelLevel: number;
  lastLocation: string;
  operator: string;
  currentJob: string;
  dailyAcres: number;
  avgFuelPerHr: number;
  nextService: string;
}

const STATUS_STYLES: Record<MachineStatus, { bg: string; text: string; dot: string }> = {
  active: { bg: 'border-[#13ff43]', text: 'text-[#13ff43]', dot: 'bg-[#13ff43] animate-pulse' },
  idle: { bg: 'border-amber-500', text: 'text-amber-400', dot: 'bg-amber-500' },
  maintenance: { bg: 'border-[#FF6B00]', text: 'text-[#FF6B00]', dot: 'bg-[#FF6B00]' },
  offline: { bg: 'border-red-500', text: 'text-red-400', dot: 'bg-red-500' },
};

const INITIAL_FLEET: Machine[] = [
  {
    id: 'M-001',
    name: 'BARKO_ALPHA',
    type: 'Tracked Mulcher',
    model: 'Barko 930B',
    status: 'active',
    hours: 4287,
    fuelLevel: 72,
    lastLocation: 'Pasture 3 — Willow Creek Ranch',
    operator: 'J. Martinez',
    currentJob: 'CCC-2604-412',
    dailyAcres: 3.2,
    avgFuelPerHr: 12.5,
    nextService: '2026-04-25',
  },
  {
    id: 'M-002',
    name: 'BARKO_BRAVO',
    type: 'Tracked Mulcher',
    model: 'Barko 930B',
    status: 'idle',
    hours: 3891,
    fuelLevel: 45,
    lastLocation: 'Yard — Dripping Springs',
    operator: 'R. Thompson',
    currentJob: '',
    dailyAcres: 0,
    avgFuelPerHr: 11.8,
    nextService: '2026-05-10',
  },
  {
    id: 'M-003',
    name: 'DOZER_CHARLIE',
    type: 'Dozer',
    model: 'CAT D6T',
    status: 'maintenance',
    hours: 6102,
    fuelLevel: 30,
    lastLocation: 'Shop — Johnson City',
    operator: 'Unassigned',
    currentJob: '',
    dailyAcres: 0,
    avgFuelPerHr: 15.2,
    nextService: '2026-04-12',
  },
  {
    id: 'M-004',
    name: 'GRAPPLE_DELTA',
    type: 'Grapple Truck',
    model: 'Peterbilt 567 w/ Rotobec',
    status: 'active',
    hours: 2340,
    fuelLevel: 58,
    lastLocation: 'En route — Blanco County',
    operator: 'K. Davis',
    currentJob: 'CCC-2604-412',
    dailyAcres: 0,
    avgFuelPerHr: 8.3,
    nextService: '2026-06-01',
  },
  {
    id: 'M-005',
    name: 'CHIPPER_ECHO',
    type: 'Chipper',
    model: 'Bandit 2290',
    status: 'offline',
    hours: 1820,
    fuelLevel: 0,
    lastLocation: 'Yard — Dripping Springs',
    operator: 'Unassigned',
    currentJob: '',
    dailyAcres: 0,
    avgFuelPerHr: 18.0,
    nextService: '2026-04-15',
  },
];

const STORAGE_KEY = 'ccc_fleet';

function loadFleet(): Machine[] {
  if (typeof window === 'undefined') return INITIAL_FLEET;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try { return JSON.parse(raw); } catch { /* fall through */ }
  }
  return INITIAL_FLEET;
}

function saveFleet(fleet: Machine[]) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fleet));
  }
}

export default function FleetClient() {
  const [fleet, setFleet] = useState<Machine[]>(loadFleet);
  const [filter, setFilter] = useState<MachineStatus | 'all'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = filter === 'all' ? fleet : fleet.filter((m) => m.status === filter);
  const selected = fleet.find((m) => m.id === selectedId) || null;

  const counts = {
    all: fleet.length,
    active: fleet.filter((m) => m.status === 'active').length,
    idle: fleet.filter((m) => m.status === 'idle').length,
    maintenance: fleet.filter((m) => m.status === 'maintenance').length,
    offline: fleet.filter((m) => m.status === 'offline').length,
  };

  const totalHoursToday = fleet
    .filter((m) => m.status === 'active')
    .reduce((s) => s + 8, 0);
  const totalAcresToday = fleet.reduce((s, m) => s + m.dailyAcres, 0);
  const avgFuelLevel = Math.round(fleet.reduce((s, m) => s + m.fuelLevel, 0) / fleet.length);

  function updateMachineStatus(id: string, status: MachineStatus) {
    const next = fleet.map((m) => (m.id === id ? { ...m, status } : m));
    setFleet(next);
    saveFleet(next);
    toast.success(`${id} status updated to ${status.toUpperCase()}`);
  }

  return (
    <AppShell>
      <div className="flex justify-between items-end border-l-4 border-[#FF6B00] pl-4 mb-8">
        <div>
          <h1 className="text-4xl font-black uppercase tracking-tighter">FLEET_SYNC</h1>
          <p className="text-[#ffb693] text-xs font-mono">
            {fleet.length} UNITS // REAL-TIME TELEMETRY
          </p>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="border-2 border-[#353534] p-4">
          <div className="text-[10px] text-[#a98a7d] font-bold uppercase tracking-widest mb-1">ACTIVE_UNITS</div>
          <div className="text-3xl font-black text-[#13ff43]">{counts.active}</div>
          <div className="text-[10px] text-[#5a4136] font-mono">of {fleet.length} total</div>
        </div>
        <div className="border-2 border-[#353534] p-4">
          <div className="text-[10px] text-[#a98a7d] font-bold uppercase tracking-widest mb-1">FIELD_HOURS_TODAY</div>
          <div className="text-3xl font-black text-[#FF6B00]">{totalHoursToday}</div>
          <div className="text-[10px] text-[#5a4136] font-mono">estimated hrs</div>
        </div>
        <div className="border-2 border-[#353534] p-4">
          <div className="text-[10px] text-[#a98a7d] font-bold uppercase tracking-widest mb-1">ACRES_TODAY</div>
          <div className="text-3xl font-black text-[#ffb693]">{totalAcresToday.toFixed(1)}</div>
          <div className="text-[10px] text-[#5a4136] font-mono">acres cleared</div>
        </div>
        <div className="border-2 border-[#353534] p-4">
          <div className="text-[10px] text-[#a98a7d] font-bold uppercase tracking-widest mb-1">AVG_FUEL</div>
          <div className="text-3xl font-black" style={{ color: avgFuelLevel > 50 ? '#13ff43' : avgFuelLevel > 25 ? '#FF6B00' : '#ff4444' }}>
            {avgFuelLevel}%
          </div>
          <div className="text-[10px] text-[#5a4136] font-mono">fleet average</div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {(['all', 'active', 'idle', 'maintenance', 'offline'] as const).map((s) => (
          <button
            key={s}
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
        {/* Machine list */}
        <div className="flex-1 space-y-3">
          {filtered.length === 0 && (
            <div className="border-2 border-[#353534] p-12 text-center">
              <p className="text-lg font-black uppercase tracking-tight text-[#a98a7d]">NO_UNITS_MATCH</p>
            </div>
          )}
          {filtered.map((m) => {
            const style = STATUS_STYLES[m.status];
            return (
              <div
                key={m.id}
                onClick={() => setSelectedId(m.id === selectedId ? null : m.id)}
                className={`border-2 p-4 cursor-pointer transition-all ${
                  m.id === selectedId
                    ? 'border-[#FF6B00] bg-[#2a2a2a]'
                    : 'border-[#353534] hover:border-[#5a4136] hover:bg-[#1c1b1b]'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
                    <span className="font-mono font-black text-sm text-[#ffb693]">{m.id}</span>
                    <span className="font-black text-sm uppercase">{m.name}</span>
                  </div>
                  <span className={`border px-2 py-0.5 text-[10px] font-black uppercase ${style.bg} ${style.text}`}>
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
                    <span className="font-mono" style={{ color: m.fuelLevel > 50 ? '#13ff43' : m.fuelLevel > 25 ? '#FF6B00' : '#ff4444' }}>
                      {m.fuelLevel}%
                    </span>
                  </div>
                  <div>
                    <span className="text-[#5a4136]">OPERATOR:</span>{' '}
                    <span className="text-[#a98a7d]">{m.operator}</span>
                  </div>
                </div>
                {m.currentJob && (
                  <div className="mt-2 text-xs">
                    <span className="text-[#5a4136]">JOB:</span>{' '}
                    <span className="font-mono text-[#13ff43]">{m.currentJob}</span>
                    <span className="text-[#5a4136] ml-3">LOCATION:</span>{' '}
                    <span className="text-[#a98a7d]">{m.lastLocation}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="w-full lg:w-80 border-2 border-[#FF6B00] bg-[#1c1b1b] p-4 shrink-0 self-start">
            <div className="flex items-center justify-between mb-4">
              <span className="font-black text-lg uppercase text-[#FF6B00]">{selected.name}</span>
              <button
                onClick={() => setSelectedId(null)}
                className="text-[#5a4136] hover:text-[#a98a7d] text-xs font-bold"
              >
                CLOSE
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="border-b border-[#353534] pb-3">
                <div className="text-[10px] text-[#5a4136] uppercase tracking-widest mb-1">UNIT_ID</div>
                <div className="font-mono font-bold text-[#ffb693]">{selected.id}</div>
              </div>
              <div className="border-b border-[#353534] pb-3">
                <div className="text-[10px] text-[#5a4136] uppercase tracking-widest mb-1">TYPE</div>
                <div>{selected.type}</div>
              </div>
              <div className="border-b border-[#353534] pb-3">
                <div className="text-[10px] text-[#5a4136] uppercase tracking-widest mb-1">MODEL</div>
                <div>{selected.model}</div>
              </div>
              <div className="border-b border-[#353534] pb-3">
                <div className="text-[10px] text-[#5a4136] uppercase tracking-widest mb-1">TOTAL_HOURS</div>
                <div className="font-mono text-lg font-black">{selected.hours.toLocaleString()}</div>
              </div>
              <div className="border-b border-[#353534] pb-3">
                <div className="text-[10px] text-[#5a4136] uppercase tracking-widest mb-1">AVG_FUEL_CONSUMPTION</div>
                <div className="font-mono">{selected.avgFuelPerHr} gal/hr</div>
              </div>
              <div className="border-b border-[#353534] pb-3">
                <div className="text-[10px] text-[#5a4136] uppercase tracking-widest mb-1">DAILY_OUTPUT</div>
                <div className="font-mono">{selected.dailyAcres} acres/day</div>
              </div>
              <div className="border-b border-[#353534] pb-3">
                <div className="text-[10px] text-[#5a4136] uppercase tracking-widest mb-1">LOCATION</div>
                <div className="text-[#a98a7d]">{selected.lastLocation}</div>
              </div>
              <div className="border-b border-[#353534] pb-3">
                <div className="text-[10px] text-[#5a4136] uppercase tracking-widest mb-1">NEXT_SERVICE</div>
                <div className="font-mono">{selected.nextService}</div>
              </div>

              <div className="pt-2">
                <div className="text-[10px] text-[#5a4136] uppercase tracking-widest mb-2">SET_STATUS</div>
                <div className="grid grid-cols-2 gap-2">
                  {(['active', 'idle', 'maintenance', 'offline'] as MachineStatus[]).map((s) => (
                    <button
                      key={s}
                      onClick={() => updateMachineStatus(selected.id, s)}
                      className={`px-2 py-1.5 text-[10px] font-bold uppercase border transition-all ${
                        selected.status === s
                          ? `${STATUS_STYLES[s].bg} ${STATUS_STYLES[s].text}`
                          : 'border-[#353534] text-[#5a4136] hover:text-[#a98a7d] hover:border-[#a98a7d]'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
