/** Local fallback for job execution when Supabase job API is unavailable */

export type LocalWorkOrder = {
  id: string;
  job_id: string;
  pasture_id: string;
  pasture_name: string;
  instructions: string;
  status: 'pending' | 'in_progress' | 'done' | 'skipped';
  sort_order: number;
  created_at: string;
};

export type LocalTimeEntry = {
  id: string;
  job_id: string;
  work_order_id: string | null;
  clock_in: string;
  clock_out: string | null;
  hours_manual: number | null;
  notes: string | null;
};

export type LocalGpsTrack = {
  id: string;
  job_id: string;
  source: 'phone' | 'manual' | 'import';
  started_at: string;
  ended_at: string | null;
  points: [number, number][];
  distance_m: number | null;
  area_acres_estimate: number | null;
  label: string | null;
};

export type LocalScheduleBlock = {
  id: string;
  job_id: string;
  starts_at: string;
  ends_at: string;
  title: string;
  notes: string | null;
};

function keyWorkOrders(jobId: string) {
  return `ccc_job_work_orders_${jobId}`;
}
function keyTime(jobId: string) {
  return `ccc_job_time_entries_${jobId}`;
}
function keyGps(jobId: string) {
  return `ccc_job_gps_tracks_${jobId}`;
}
function keySchedule(jobId: string) {
  return `ccc_job_schedule_${jobId}`;
}

export function loadLocalWorkOrders(jobId: string): LocalWorkOrder[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(keyWorkOrders(jobId));
    return raw ? (JSON.parse(raw) as LocalWorkOrder[]) : [];
  } catch {
    return [];
  }
}

export function saveLocalWorkOrders(jobId: string, rows: LocalWorkOrder[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(keyWorkOrders(jobId), JSON.stringify(rows));
}

export function loadLocalTimeEntries(jobId: string): LocalTimeEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(keyTime(jobId));
    return raw ? (JSON.parse(raw) as LocalTimeEntry[]) : [];
  } catch {
    return [];
  }
}

export function saveLocalTimeEntries(jobId: string, rows: LocalTimeEntry[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(keyTime(jobId), JSON.stringify(rows));
}

export function loadLocalGpsTracks(jobId: string): LocalGpsTrack[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(keyGps(jobId));
    return raw ? (JSON.parse(raw) as LocalGpsTrack[]) : [];
  } catch {
    return [];
  }
}

export function saveLocalGpsTracks(jobId: string, rows: LocalGpsTrack[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(keyGps(jobId), JSON.stringify(rows));
}

export function loadLocalSchedule(jobId: string): LocalScheduleBlock[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(keySchedule(jobId));
    return raw ? (JSON.parse(raw) as LocalScheduleBlock[]) : [];
  } catch {
    return [];
  }
}

export function saveLocalSchedule(jobId: string, rows: LocalScheduleBlock[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(keySchedule(jobId), JSON.stringify(rows));
}
