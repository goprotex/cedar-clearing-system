/**
 * Response shape for GET /api/monitor/bootstrap.
 * `telemetryByJob` is populated when `job_telemetry_latest` has rows (future telematics).
 */
export type MonitorTelemetryRow = {
  source_key: string;
  kind: 'machine' | 'engine' | 'progress' | 'custom';
  data: Record<string, unknown>;
  updated_at: string;
};

export type MonitorBootstrapResponse = {
  jobs: unknown[];
  clearedByJob: Record<string, string[]>;
  operatorsByJob: Record<string, unknown[]>;
  /** Latest telemetry blob per job (multiple sources per job keyed in-client by source_key) */
  telemetryByJob: Record<string, MonitorTelemetryRow[]>;
  /** Operator profiles: user_id → { display_name, email } */
  operatorProfiles: Record<string, { display_name: string; email: string }>;
  /** Active (open) time entries — clock_out IS NULL */
  activeTimeEntries: Record<string, Array<{ user_id: string; clock_in: string; job_id: string }>>;
  /** Job members by job: user_id + role */
  membersByJob: Record<string, Array<{ user_id: string; role: string }>>;
  /** When true, user sees all company jobs (profile owner/manager + company bid link) */
  scope: 'membership' | 'company';
};
