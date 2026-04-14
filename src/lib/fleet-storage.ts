import { v4 as uuidv4 } from 'uuid';
import { mergeJobsById, loadJobsFromOperatorStorage, loadLocalStorageJobs, type ActiveJobSummary } from '@/lib/active-jobs';

export type MachineStatus = 'active' | 'idle' | 'maintenance' | 'offline';

export type EquipmentCategory =
  | 'truck'
  | 'trailer'
  | 'skid_steer'
  | 'skid_steer_attachment'
  | 'barko'
  | 'small_equipment'
  | 'dozer'
  | 'excavator'
  | 'other';

export const EQUIPMENT_CATEGORIES: { value: EquipmentCategory; label: string }[] = [
  { value: 'truck', label: 'Truck' },
  { value: 'trailer', label: 'Trailer' },
  { value: 'skid_steer', label: 'Skid Steer' },
  { value: 'skid_steer_attachment', label: 'Skid Steer Attachment' },
  { value: 'barko', label: 'Barko' },
  { value: 'dozer', label: 'Dozer' },
  { value: 'excavator', label: 'Excavator' },
  { value: 'small_equipment', label: 'Small Equipment' },
  { value: 'other', label: 'Other' },
];

export type EquipmentCondition = 'excellent' | 'good' | 'fair' | 'poor' | 'needs_repair';

export const EQUIPMENT_CONDITIONS: { value: EquipmentCondition; label: string }[] = [
  { value: 'excellent', label: 'Excellent' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
  { value: 'needs_repair', label: 'Needs Repair' },
];

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

export type CheckoutRecord = {
  id: string;
  checkedOutBy: string;        // user id
  checkedOutByName: string;    // display name
  jobId: string;
  checkoutAt: string;          // ISO datetime
  checkoutHours: number | null;
  checkoutMileage: number | null;
  checkoutFuelLevel: number | null;
  checkoutCondition: EquipmentCondition | null;
  checkoutNotes: string;
  checkoutLocation: string;
  returnedAt: string | null;
  returnHours: number | null;
  returnMileage: number | null;
  returnFuelLevel: number | null;
  returnCondition: EquipmentCondition | null;
  returnNotes: string;
  returnLocation: string;
  status: 'checked_out' | 'returned';
};

export interface Machine {
  id: string;
  name: string;
  type: string;
  category: EquipmentCategory;
  model: string;
  status: MachineStatus;
  hours: number;
  mileage: number;
  fuelLevel: number;
  lastLocation: string;
  operator: string;
  /** Job id (e.g. job_abc) or external ref like CCC-2604-412 */
  currentJob: string;
  dailyAcres: number;
  avgFuelPerHr: number;
  nextService: string;
  nextServiceHours: number;
  condition: EquipmentCondition;
  serialNumber: string;
  year: number | null;
  make: string;
  notes: string;
  /** Data URLs or https URLs (Supabase Storage preferred) */
  photoUrls: string[];
  /** Primary thumbnail index in photoUrls */
  thumbnailIndex: number;
  maintenanceLog: MaintenanceLogEntry[];
  fuelLog: FuelLogEntry[];
  hoursLog: HoursLogEntry[];
  checkoutHistory: CheckoutRecord[];
}

/** One DB row ↔ one unit (Supabase `fleet_machines`). */
export type FleetUnit = { rowId: string; machine: Machine };

const STORAGE_KEY = 'ccc_fleet';

/** Legacy rows before nested json */
type LegacyMachine = Omit<Machine, 'notes' | 'photoUrls' | 'maintenanceLog' | 'fuelLog' | 'hoursLog' | 'checkoutHistory' | 'category' | 'mileage' | 'condition' | 'serialNumber' | 'year' | 'make' | 'nextServiceHours' | 'thumbnailIndex'>;

function migrateLegacyMachine(m: LegacyMachine): Machine {
  return {
    ...m,
    category: inferCategory(m.type),
    mileage: 0,
    condition: 'good',
    serialNumber: '',
    year: null,
    make: '',
    nextServiceHours: 0,
    thumbnailIndex: 0,
    notes: '',
    photoUrls: [],
    maintenanceLog: [],
    fuelLog: [],
    hoursLog: [],
    checkoutHistory: [],
  };
}

/** Infer category from free-text type field for legacy data */
function inferCategory(type: string): EquipmentCategory {
  const t = (type || '').toLowerCase();
  if (t.includes('barko') || t.includes('mulcher')) return 'barko';
  if (t.includes('skid') && (t.includes('attachment') || t.includes('head') || t.includes('grapple bucket'))) return 'skid_steer_attachment';
  if (t.includes('skid')) return 'skid_steer';
  if (t.includes('truck') || t.includes('grapple')) return 'truck';
  if (t.includes('trailer')) return 'trailer';
  if (t.includes('dozer')) return 'dozer';
  if (t.includes('excavat')) return 'excavator';
  if (t.includes('saw') || t.includes('chipper') || t.includes('chain') || t.includes('blower') || t.includes('trimmer')) return 'small_equipment';
  return 'other';
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
      if (!Array.isArray(base.checkoutHistory)) base.checkoutHistory = [];
      if (!base.category) base.category = inferCategory(base.type);
      if (typeof base.mileage !== 'number') base.mileage = 0;
      if (!base.condition) base.condition = 'good';
      if (typeof base.serialNumber !== 'string') base.serialNumber = '';
      if (typeof base.make !== 'string') base.make = '';
      if (typeof base.nextServiceHours !== 'number') base.nextServiceHours = 0;
      if (typeof base.thumbnailIndex !== 'number') base.thumbnailIndex = 0;
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
    category: 'other',
    model: '—',
    status: 'idle',
    hours: 0,
    mileage: 0,
    fuelLevel: 0,
    lastLocation: '—',
    operator: 'Unassigned',
    currentJob: '',
    dailyAcres: 0,
    avgFuelPerHr: 0,
    nextService: '',
    nextServiceHours: 0,
    condition: 'good',
    serialNumber: '',
    year: null,
    make: '',
    notes: '',
    photoUrls: [],
    thumbnailIndex: 0,
    maintenanceLog: [],
    fuelLog: [],
    hoursLog: [],
    checkoutHistory: [],
    ...overrides,
  };
}

/** Parse `fleet_machines.data` jsonb into a Machine; fill missing fields. */
export function machineFromJson(data: unknown, rowId: string): Machine {
  if (!data || typeof data !== 'object') return emptyMachine();
  const d = data as Record<string, unknown>;
  const VALID_CATEGORIES = new Set<string>(EQUIPMENT_CATEGORIES.map((c) => c.value));
  const VALID_CONDITIONS = new Set<string>(EQUIPMENT_CONDITIONS.map((c) => c.value));
  const typeStr = typeof d.type === 'string' ? d.type : 'Equipment';
  const base = emptyMachine({
    id: typeof d.id === 'string' && d.id ? d.id : newMachineId(),
    name: typeof d.name === 'string' ? d.name : 'UNIT',
    type: typeStr,
    category: typeof d.category === 'string' && VALID_CATEGORIES.has(d.category)
      ? (d.category as EquipmentCategory)
      : inferCategory(typeStr),
    model: typeof d.model === 'string' ? d.model : '—',
    status: (['active', 'idle', 'maintenance', 'offline'] as const).includes(d.status as MachineStatus)
      ? (d.status as MachineStatus)
      : 'idle',
    hours: typeof d.hours === 'number' && Number.isFinite(d.hours) ? d.hours : 0,
    mileage: typeof d.mileage === 'number' && Number.isFinite(d.mileage) ? d.mileage : 0,
    fuelLevel: typeof d.fuelLevel === 'number' && Number.isFinite(d.fuelLevel) ? d.fuelLevel : 0,
    lastLocation: typeof d.lastLocation === 'string' ? d.lastLocation : '—',
    operator: typeof d.operator === 'string' ? d.operator : 'Unassigned',
    currentJob: typeof d.currentJob === 'string' ? d.currentJob : '',
    dailyAcres: typeof d.dailyAcres === 'number' && Number.isFinite(d.dailyAcres) ? d.dailyAcres : 0,
    avgFuelPerHr: typeof d.avgFuelPerHr === 'number' && Number.isFinite(d.avgFuelPerHr) ? d.avgFuelPerHr : 0,
    nextService: typeof d.nextService === 'string' ? d.nextService : '',
    nextServiceHours: typeof d.nextServiceHours === 'number' && Number.isFinite(d.nextServiceHours) ? d.nextServiceHours : 0,
    condition: typeof d.condition === 'string' && VALID_CONDITIONS.has(d.condition)
      ? (d.condition as EquipmentCondition)
      : 'good',
    serialNumber: typeof d.serialNumber === 'string' ? d.serialNumber : '',
    year: typeof d.year === 'number' && Number.isFinite(d.year) ? d.year : null,
    make: typeof d.make === 'string' ? d.make : '',
    notes: typeof d.notes === 'string' ? d.notes : '',
    photoUrls: Array.isArray(d.photoUrls) ? (d.photoUrls as string[]) : [],
    thumbnailIndex: typeof d.thumbnailIndex === 'number' && Number.isFinite(d.thumbnailIndex) ? d.thumbnailIndex : 0,
    maintenanceLog: Array.isArray(d.maintenanceLog) ? (d.maintenanceLog as MaintenanceLogEntry[]) : [],
    fuelLog: Array.isArray(d.fuelLog) ? (d.fuelLog as FuelLogEntry[]) : [],
    hoursLog: Array.isArray(d.hoursLog) ? (d.hoursLog as HoursLogEntry[]) : [],
    checkoutHistory: Array.isArray(d.checkoutHistory) ? (d.checkoutHistory as CheckoutRecord[]) : [],
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
    category: 'barko',
    model: 'Barko 930B',
    status: 'active',
    hours: 4287,
    mileage: 0,
    fuelLevel: 72,
    lastLocation: 'Pasture 3 — Willow Creek Ranch',
    operator: 'J. Martinez',
    currentJob: 'CCC-2604-412',
    dailyAcres: 3.2,
    avgFuelPerHr: 12.5,
    nextService: '2026-04-25',
    nextServiceHours: 4500,
    condition: 'good',
    serialNumber: 'BK930-2021-00457',
    year: 2021,
    make: 'Barko',
    notes: '',
    photoUrls: [],
    thumbnailIndex: 0,
    maintenanceLog: [],
    fuelLog: [],
    hoursLog: [],
    checkoutHistory: [],
  },
  {
    id: 'M-002',
    name: 'BARKO_BRAVO',
    type: 'Tracked Mulcher',
    category: 'barko',
    model: 'Barko 930B',
    status: 'idle',
    hours: 3891,
    mileage: 0,
    fuelLevel: 45,
    lastLocation: 'Yard — Dripping Springs',
    operator: 'R. Thompson',
    currentJob: '',
    dailyAcres: 0,
    avgFuelPerHr: 11.8,
    nextService: '2026-05-10',
    nextServiceHours: 4000,
    condition: 'good',
    serialNumber: 'BK930-2020-00312',
    year: 2020,
    make: 'Barko',
    notes: '',
    photoUrls: [],
    thumbnailIndex: 0,
    maintenanceLog: [],
    fuelLog: [],
    hoursLog: [],
    checkoutHistory: [],
  },
  {
    id: 'M-003',
    name: 'DOZER_CHARLIE',
    type: 'Dozer',
    category: 'dozer',
    model: 'CAT D6T',
    status: 'maintenance',
    hours: 6102,
    mileage: 0,
    fuelLevel: 30,
    lastLocation: 'Shop — Johnson City',
    operator: 'Unassigned',
    currentJob: '',
    dailyAcres: 0,
    avgFuelPerHr: 15.2,
    nextService: '2026-04-12',
    nextServiceHours: 6250,
    condition: 'fair',
    serialNumber: 'CAT-D6T-2019-88431',
    year: 2019,
    make: 'Caterpillar',
    notes: '',
    photoUrls: [],
    thumbnailIndex: 0,
    maintenanceLog: [],
    fuelLog: [],
    hoursLog: [],
    checkoutHistory: [],
  },
  {
    id: 'M-004',
    name: 'GRAPPLE_DELTA',
    type: 'Grapple Truck',
    category: 'truck',
    model: 'Peterbilt 567 w/ Rotobec',
    status: 'active',
    hours: 2340,
    mileage: 84200,
    fuelLevel: 58,
    lastLocation: 'En route — Blanco County',
    operator: 'K. Davis',
    currentJob: 'CCC-2604-412',
    dailyAcres: 0,
    avgFuelPerHr: 8.3,
    nextService: '2026-06-01',
    nextServiceHours: 2500,
    condition: 'good',
    serialNumber: 'PB567-2022-01923',
    year: 2022,
    make: 'Peterbilt',
    notes: '',
    photoUrls: [],
    thumbnailIndex: 0,
    maintenanceLog: [],
    fuelLog: [],
    hoursLog: [],
    checkoutHistory: [],
  },
  {
    id: 'M-005',
    name: 'CHIPPER_ECHO',
    type: 'Chipper',
    category: 'small_equipment',
    model: 'Bandit 2290',
    status: 'offline',
    hours: 1820,
    mileage: 0,
    fuelLevel: 0,
    lastLocation: 'Yard — Dripping Springs',
    operator: 'Unassigned',
    currentJob: '',
    dailyAcres: 0,
    avgFuelPerHr: 18.0,
    nextService: '2026-04-15',
    nextServiceHours: 2000,
    condition: 'poor',
    serialNumber: 'BND-2290-2018-5542',
    year: 2018,
    make: 'Bandit',
    notes: '',
    photoUrls: [],
    thumbnailIndex: 0,
    maintenanceLog: [],
    fuelLog: [],
    hoursLog: [],
    checkoutHistory: [],
  },
];
