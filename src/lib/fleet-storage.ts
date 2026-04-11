import { v4 as uuidv4 } from 'uuid';
import { loadJobsFromOperatorStorage, loadLocalStorageJobs, type ActiveJobSummary } from '@/lib/active-jobs';

export type MachineStatus = 'active' | 'idle' | 'maintenance' | 'offline';

export type MaintenanceLogEntry = {
  id: string;
  dateISO: string;
  kind: 'service' | 'repair' | 'inspection' | 'other';
  hoursAtEntry?: number;
  description: string;
};

export type FuelLogEntry = {
  id: string;
  dateISO: string;
  gallons: number;
  note?: string;
};

export type HoursLogEntry = {
  id: string;
  dateISO: string;
  deltaHours: number;
  note?: string;
};

export interface Machine {
  id: string;
  name: string;
  type: string;
  model: string;
  status: MachineStatus;
  hours: number;
  fuelLevel: number;
  lastLocation: string;
  operator: string;
  /** Job id (e.g. job_abc) or external ref like CCC-2604-412 */
  currentJob: string;
  dailyAcres: number;
  avgFuelPerHr: number;
  nextService: string;
  notes: string;
  /** Data URLs or https URLs — manual photos until cloud storage */
  photoUrls: string[];
  maintenanceLog: MaintenanceLogEntry[];
  fuelLog: FuelLogEntry[];
  hoursLog: HoursLogEntry[];
}

export type FleetPersisted = { version: 1; machines: Machine[] };

const STORAGE_KEY = 'ccc_fleet';

/** Legacy shape before notes / logs / photos */
type LegacyMachine = Omit<Machine, 'notes' | 'photoUrls' | 'maintenanceLog' | 'fuelLog' | 'hoursLog'>;

function migrateLegacyMachine(m: LegacyMachine): Machine {
  return {
    ...m,
    notes: '',
    photoUrls: [],
    maintenanceLog: [],
    fuelLog: [],
    hoursLog: [],
  };
}

export function migrateFleetPayload(raw: unknown): Machine[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return (raw as LegacyMachine[]).map((m) => migrateLegacyMachine(m));
  }
  if (typeof raw === 'object' && raw !== null && 'machines' in raw) {
    const list = (raw as FleetPersisted).machines;
    if (!Array.isArray(list)) return [];
    return list.map((m) => {
      const base = m as Machine;
      if (typeof base.notes !== 'string') base.notes = '';
      if (!Array.isArray(base.photoUrls)) base.photoUrls = [];
      if (!Array.isArray(base.maintenanceLog)) base.maintenanceLog = [];
      if (!Array.isArray(base.fuelLog)) base.fuelLog = [];
      if (!Array.isArray(base.hoursLog)) base.hoursLog = [];
      return base;
    });
  }
  return [];
}

export function loadFleetMachines(): Machine[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return migrateFleetPayload(parsed);
  } catch {
    return [];
  }
}

/** First visit: no key yet — seed with demo units (not persisted until user saves). */
export function initialFleetForClient(): Machine[] {
  const loaded = loadFleetMachines();
  if (loaded.length > 0) return loaded;
  return DEFAULT_FLEET;
}

export function saveFleetMachines(machines: Machine[]) {
  if (typeof window === 'undefined') return;
  const payload: FleetPersisted = { version: 1, machines };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function newMachineId(): string {
  return `M-${uuidv4().slice(0, 8).toUpperCase()}`;
}

export function loadFleetJobOptions(): ActiveJobSummary[] {
  if (typeof window === 'undefined') return [];
  const local = loadLocalStorageJobs();
  const ids = new Set(local.map((j) => j.id));
  const implied = loadJobsFromOperatorStorage(ids);
  const merged = [...local];
  for (const j of implied) {
    if (!ids.has(j.id)) {
      ids.add(j.id);
      merged.push(j);
    }
  }
  merged.sort((a, b) => (a.title || a.id).localeCompare(b.title || b.id));
  return merged;
}

export function sumHoursLoggedToday(machines: Machine[]): number {
  const today = new Date().toISOString().slice(0, 10);
  let sum = 0;
  for (const m of machines) {
    for (const e of m.hoursLog) {
      if (e.dateISO.slice(0, 10) === today) sum += e.deltaHours;
    }
  }
  return sum;
}

/** Shown when no localStorage fleet exists yet */
export const DEFAULT_FLEET: Machine[] = [
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
    notes: '',
    photoUrls: [],
    maintenanceLog: [],
    fuelLog: [],
    hoursLog: [],
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
    notes: '',
    photoUrls: [],
    maintenanceLog: [],
    fuelLog: [],
    hoursLog: [],
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
    notes: '',
    photoUrls: [],
    maintenanceLog: [],
    fuelLog: [],
    hoursLog: [],
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
    notes: '',
    photoUrls: [],
    maintenanceLog: [],
    fuelLog: [],
    hoursLog: [],
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
    notes: '',
    photoUrls: [],
    maintenanceLog: [],
    fuelLog: [],
    hoursLog: [],
  },
];
