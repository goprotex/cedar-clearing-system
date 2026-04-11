import { v4 as uuidv4 } from 'uuid';
import { mergeJobsById, loadJobsFromOperatorStorage, loadLocalStorageJobs, type ActiveJobSummary } from '@/lib/active-jobs';

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
  /** Data URLs or https URLs */
  photoUrls: string[];
  maintenanceLog: MaintenanceLogEntry[];
  fuelLog: FuelLogEntry[];
  hoursLog: HoursLogEntry[];
}

/** One DB row ↔ one unit (Supabase `fleet_machines`). */
export type FleetUnit = { rowId: string; machine: Machine };

const STORAGE_KEY = 'ccc_fleet';

/** Legacy rows before nested json */
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

export type FleetPersisted = { version: 1; machines: Machine[] };

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

export function loadFleetMachinesFromLocalStorage(): Machine[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return migrateFleetPayload(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

export function clearFleetLocalStorage() {
  if (typeof window !== 'undefined') localStorage.removeItem(STORAGE_KEY);
}

export function newMachineId(): string {
  return `M-${uuidv4().slice(0, 8).toUpperCase()}`;
}

function emptyMachine(overrides: Partial<Machine> = {}): Machine {
  return {
    id: newMachineId(),
    name: 'NEW_UNIT',
    type: 'Equipment',
    model: '—',
    status: 'idle',
    hours: 0,
    fuelLevel: 0,
    lastLocation: '—',
    operator: 'Unassigned',
    currentJob: '',
    dailyAcres: 0,
    avgFuelPerHr: 0,
    nextService: '',
    notes: '',
    photoUrls: [],
    maintenanceLog: [],
    fuelLog: [],
    hoursLog: [],
    ...overrides,
  };
}

/** Parse `fleet_machines.data` jsonb into a Machine; fill missing fields. */
export function machineFromJson(data: unknown, rowId: string): Machine {
  if (!data || typeof data !== 'object') return emptyMachine();
  const d = data as Record<string, unknown>;
  const base = emptyMachine({
    id: typeof d.id === 'string' && d.id ? d.id : newMachineId(),
    name: typeof d.name === 'string' ? d.name : 'UNIT',
    type: typeof d.type === 'string' ? d.type : 'Equipment',
    model: typeof d.model === 'string' ? d.model : '—',
    status: (['active', 'idle', 'maintenance', 'offline'] as const).includes(d.status as MachineStatus)
      ? (d.status as MachineStatus)
      : 'idle',
    hours: typeof d.hours === 'number' && Number.isFinite(d.hours) ? d.hours : 0,
    fuelLevel: typeof d.fuelLevel === 'number' && Number.isFinite(d.fuelLevel) ? d.fuelLevel : 0,
    lastLocation: typeof d.lastLocation === 'string' ? d.lastLocation : '—',
    operator: typeof d.operator === 'string' ? d.operator : 'Unassigned',
    currentJob: typeof d.currentJob === 'string' ? d.currentJob : '',
    dailyAcres: typeof d.dailyAcres === 'number' && Number.isFinite(d.dailyAcres) ? d.dailyAcres : 0,
    avgFuelPerHr: typeof d.avgFuelPerHr === 'number' && Number.isFinite(d.avgFuelPerHr) ? d.avgFuelPerHr : 0,
    nextService: typeof d.nextService === 'string' ? d.nextService : '',
    notes: typeof d.notes === 'string' ? d.notes : '',
    photoUrls: Array.isArray(d.photoUrls) ? (d.photoUrls as string[]) : [],
    maintenanceLog: Array.isArray(d.maintenanceLog) ? (d.maintenanceLog as MaintenanceLogEntry[]) : [],
    fuelLog: Array.isArray(d.fuelLog) ? (d.fuelLog as FuelLogEntry[]) : [],
    hoursLog: Array.isArray(d.hoursLog) ? (d.hoursLog as HoursLogEntry[]) : [],
  });
  void rowId;
  return base;
}

export function machineToJson(m: Machine): Record<string, unknown> {
  return { ...m };
}

export function rowToFleetUnit(row: { id: string; data: unknown }): FleetUnit {
  return { rowId: row.id, machine: machineFromJson(row.data, row.id) };
}

export function sumHoursLoggedToday(units: FleetUnit[] | Machine[]): number {
  const today = new Date().toISOString().slice(0, 10);
  let sum = 0;
  const list = Array.isArray(units) && units.length && 'machine' in (units[0] as FleetUnit)
    ? (units as FleetUnit[]).map((u) => u.machine)
    : (units as Machine[]);
  for (const m of list) {
    for (const e of m.hoursLog) {
      if (e.dateISO.slice(0, 10) === today) sum += e.deltaHours;
    }
  }
  return sum;
}

/** Merge local + remote job lists for the fleet job dropdown (same as dashboard/monitor). */
export async function loadFleetJobOptionsMerged(fetchRemote: () => Promise<ActiveJobSummary[]>): Promise<ActiveJobSummary[]> {
  let remote: ActiveJobSummary[] = [];
  try {
    remote = await fetchRemote();
  } catch {
    remote = [];
  }
  const localStored = loadLocalStorageJobs();
  let merged = localStored.length > 0 ? mergeJobsById(remote, localStored) : remote.length > 0 ? remote : loadLocalStorageJobs();
  const idSet = new Set(merged.map((j) => j.id));
  merged = [...merged, ...loadJobsFromOperatorStorage(idSet)];
  merged.sort((a, b) => (a.title || a.id).localeCompare(b.title || b.id));
  return merged;
}

export const DEFAULT_FLEET_MACHINES: Machine[] = [
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
