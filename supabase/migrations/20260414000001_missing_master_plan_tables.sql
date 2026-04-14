-- Missing master plan tables #13–#20
-- attachments, maintenance_records, teeth_change_records, calibration_records,
-- drone_surveys, drone_images, progress_snapshots, progress_reports
-- All tables are company-scoped with RLS using user_company_id().

-- ─── Attachments (master plan table #13) ──────────────────────────────────────
-- Mulcher heads, grapples, and other implements attached to fleet machines.

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  type text not null,                        -- 'mulcher_head', 'grapple', etc.
  make text,
  model text,
  serial_number text,
  compatible_machine_ids uuid[] default '{}',
  total_hours real not null default 0,
  status text not null default 'available'
    check (status in ('available', 'in_use', 'in_maintenance', 'retired')),
  installed_on uuid references public.fleet_machines (id) on delete set null,
  last_teeth_change_hours real,
  teeth_change_interval real default 150,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists attachments_company_id_idx on public.attachments (company_id);
create index if not exists attachments_installed_on_idx on public.attachments (installed_on);

alter table public.attachments enable row level security;

drop policy if exists "attachments_select_company" on public.attachments;
create policy "attachments_select_company"
  on public.attachments for select to authenticated
  using (company_id = public.user_company_id());

drop policy if exists "attachments_insert_company" on public.attachments;
create policy "attachments_insert_company"
  on public.attachments for insert to authenticated
  with check (company_id = public.user_company_id());

drop policy if exists "attachments_update_company" on public.attachments;
create policy "attachments_update_company"
  on public.attachments for update to authenticated
  using (company_id = public.user_company_id())
  with check (company_id = public.user_company_id());

drop policy if exists "attachments_delete_company" on public.attachments;
create policy "attachments_delete_company"
  on public.attachments for delete to authenticated
  using (company_id = public.user_company_id());

drop trigger if exists set_attachments_updated_at on public.attachments;
create trigger set_attachments_updated_at
  before update on public.attachments
  for each row execute function public.set_updated_at();

-- ─── Maintenance Records (master plan table #14) ──────────────────────────────
-- Service history per fleet machine or attachment.

create table if not exists public.maintenance_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  machine_id uuid references public.fleet_machines (id) on delete set null,
  attachment_id uuid references public.attachments (id) on delete set null,
  type text not null,                        -- 'scheduled', 'repair', 'inspection'
  category text not null,                    -- 'engine', 'hydraulic', 'teeth', etc.
  description text,
  engine_hours_at_service real,
  service_date date not null,
  performed_by text,
  location text,
  parts_cost numeric(10,2) not null default 0,
  labor_cost numeric(10,2) not null default 0,
  total_cost numeric(10,2) not null default 0,
  parts_used jsonb not null default '[]',
  downtime_hours real not null default 0,
  job_id uuid references public.jobs (id) on delete set null,
  next_service_due_hours real,
  next_service_type text,
  notes text,
  photos text[] default '{}',
  receipt_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists maintenance_records_company_id_idx on public.maintenance_records (company_id);
create index if not exists maintenance_records_machine_id_idx on public.maintenance_records (machine_id);
create index if not exists maintenance_records_attachment_id_idx on public.maintenance_records (attachment_id);

alter table public.maintenance_records enable row level security;

drop policy if exists "maintenance_records_select_company" on public.maintenance_records;
create policy "maintenance_records_select_company"
  on public.maintenance_records for select to authenticated
  using (company_id = public.user_company_id());

drop policy if exists "maintenance_records_insert_company" on public.maintenance_records;
create policy "maintenance_records_insert_company"
  on public.maintenance_records for insert to authenticated
  with check (company_id = public.user_company_id());

drop policy if exists "maintenance_records_update_company" on public.maintenance_records;
create policy "maintenance_records_update_company"
  on public.maintenance_records for update to authenticated
  using (company_id = public.user_company_id())
  with check (company_id = public.user_company_id());

drop policy if exists "maintenance_records_delete_company" on public.maintenance_records;
create policy "maintenance_records_delete_company"
  on public.maintenance_records for delete to authenticated
  using (company_id = public.user_company_id());

drop trigger if exists set_maintenance_records_updated_at on public.maintenance_records;
create trigger set_maintenance_records_updated_at
  before update on public.maintenance_records
  for each row execute function public.set_updated_at();

-- ─── Teeth Change Records (master plan table #15) ─────────────────────────────
-- Tracks teeth/cutter replacements and correlates wear to soil/terrain conditions.

create table if not exists public.teeth_change_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  machine_id uuid references public.fleet_machines (id) on delete set null,
  attachment_id uuid references public.attachments (id) on delete set null,
  job_id uuid references public.jobs (id) on delete set null,
  hours_since_last_change real,
  soil_series text,
  rock_fragment_pct real,
  terrain_class text,
  teeth_count int,
  cost_per_tooth numeric(6,2),
  total_cost numeric(8,2),
  brand text,
  wear_level text check (wear_level in ('low', 'medium', 'high', 'critical')),
  notes text,
  photo text,
  created_at timestamptz not null default now()
);

create index if not exists teeth_change_records_company_id_idx on public.teeth_change_records (company_id);
create index if not exists teeth_change_records_machine_id_idx on public.teeth_change_records (machine_id);
create index if not exists teeth_change_records_job_id_idx on public.teeth_change_records (job_id);

alter table public.teeth_change_records enable row level security;

drop policy if exists "teeth_change_records_select_company" on public.teeth_change_records;
create policy "teeth_change_records_select_company"
  on public.teeth_change_records for select to authenticated
  using (company_id = public.user_company_id());

drop policy if exists "teeth_change_records_insert_company" on public.teeth_change_records;
create policy "teeth_change_records_insert_company"
  on public.teeth_change_records for insert to authenticated
  with check (company_id = public.user_company_id());

drop policy if exists "teeth_change_records_update_company" on public.teeth_change_records;
create policy "teeth_change_records_update_company"
  on public.teeth_change_records for update to authenticated
  using (company_id = public.user_company_id())
  with check (company_id = public.user_company_id());

drop policy if exists "teeth_change_records_delete_company" on public.teeth_change_records;
create policy "teeth_change_records_delete_company"
  on public.teeth_change_records for delete to authenticated
  using (company_id = public.user_company_id());

-- ─── Calibration Records (master plan table #16) ─────────────────────────────
-- Feedback loop: predicted vs actual hours per completed pasture.
-- Drives ML model retraining for bid accuracy improvement.

create table if not exists public.calibration_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  bid_id uuid references public.bids (id) on delete set null,
  pasture_id uuid references public.pastures (id) on delete set null,
  vegetation_type text,
  density_class text,
  terrain_class text,
  acreage real,
  clearing_method text,
  soil_series text,
  slope_r real,
  rock_fragment_pct real,
  soil_multiplier real,
  ai_density_score real,
  predicted_hrs_per_acre real,
  actual_hrs_per_acre real,
  error_pct real,
  error_direction text check (error_direction in ('over', 'under', 'exact')),
  equipment_used text[] default '{}',
  crew_size int,
  weather_delay_hours real not null default 0,
  density_accuracy int check (density_accuracy between 1 and 5),
  soil_accuracy int check (soil_accuracy between 1 and 5),
  overall_accuracy int check (overall_accuracy between 1 and 5),
  before_photos text[] default '{}',
  after_photos text[] default '{}',
  -- Telematics-verified data (highest quality)
  telematics_engine_hours real,
  telematics_fuel_consumed real,
  telematics_active_pct real,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists calibration_records_company_id_idx on public.calibration_records (company_id);
create index if not exists calibration_records_bid_id_idx on public.calibration_records (bid_id);
create index if not exists calibration_records_pasture_id_idx on public.calibration_records (pasture_id);

alter table public.calibration_records enable row level security;

drop policy if exists "calibration_records_select_company" on public.calibration_records;
create policy "calibration_records_select_company"
  on public.calibration_records for select to authenticated
  using (company_id = public.user_company_id());

drop policy if exists "calibration_records_insert_company" on public.calibration_records;
create policy "calibration_records_insert_company"
  on public.calibration_records for insert to authenticated
  with check (company_id = public.user_company_id());

drop policy if exists "calibration_records_update_company" on public.calibration_records;
create policy "calibration_records_update_company"
  on public.calibration_records for update to authenticated
  using (company_id = public.user_company_id())
  with check (company_id = public.user_company_id());

drop policy if exists "calibration_records_delete_company" on public.calibration_records;
create policy "calibration_records_delete_company"
  on public.calibration_records for delete to authenticated
  using (company_id = public.user_company_id());

-- ─── Drone Surveys (master plan table #17) ────────────────────────────────────
-- Tracks drone photogrammetry jobs (pre/progress/post clearing).

create table if not exists public.drone_surveys (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  bid_id uuid references public.bids (id) on delete set null,
  job_id uuid references public.jobs (id) on delete set null,
  pasture_id uuid references public.pastures (id) on delete set null,
  survey_type text not null
    check (survey_type in ('pre_clearing', 'progress', 'post_clearing')),
  survey_date timestamptz not null,
  image_count int,
  coverage_polygon jsonb,
  flight_altitude_ft real,
  drone_model text,
  odm_task_id text,
  processing_status text not null default 'pending'
    check (processing_status in ('pending', 'processing', 'complete', 'failed')),
  orthomosaic_url text,
  dsm_url text,
  dtm_url text,
  chm_url text,
  point_cloud_url text,
  gsd_cm real,
  total_area_acres real,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists drone_surveys_company_id_idx on public.drone_surveys (company_id);
create index if not exists drone_surveys_job_id_idx on public.drone_surveys (job_id);

alter table public.drone_surveys enable row level security;

drop policy if exists "drone_surveys_select_company" on public.drone_surveys;
create policy "drone_surveys_select_company"
  on public.drone_surveys for select to authenticated
  using (company_id = public.user_company_id());

drop policy if exists "drone_surveys_insert_company" on public.drone_surveys;
create policy "drone_surveys_insert_company"
  on public.drone_surveys for insert to authenticated
  with check (company_id = public.user_company_id());

drop policy if exists "drone_surveys_update_company" on public.drone_surveys;
create policy "drone_surveys_update_company"
  on public.drone_surveys for update to authenticated
  using (company_id = public.user_company_id())
  with check (company_id = public.user_company_id());

drop policy if exists "drone_surveys_delete_company" on public.drone_surveys;
create policy "drone_surveys_delete_company"
  on public.drone_surveys for delete to authenticated
  using (company_id = public.user_company_id());

drop trigger if exists set_drone_surveys_updated_at on public.drone_surveys;
create trigger set_drone_surveys_updated_at
  before update on public.drone_surveys
  for each row execute function public.set_updated_at();

-- ─── Drone Images (master plan table #18) ─────────────────────────────────────
-- Individual drone photos linked to a survey, with GPS coordinates from EXIF.

create table if not exists public.drone_images (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  survey_id uuid not null references public.drone_surveys (id) on delete cascade,
  file_url text not null,
  thumbnail_url text,
  latitude real,
  longitude real,
  altitude_ft real,
  heading_deg real,
  taken_at timestamptz,
  file_size_bytes int,
  width_px int,
  height_px int,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists drone_images_company_id_idx on public.drone_images (company_id);
create index if not exists drone_images_survey_id_idx on public.drone_images (survey_id);

alter table public.drone_images enable row level security;

drop policy if exists "drone_images_select_company" on public.drone_images;
create policy "drone_images_select_company"
  on public.drone_images for select to authenticated
  using (company_id = public.user_company_id());

drop policy if exists "drone_images_insert_company" on public.drone_images;
create policy "drone_images_insert_company"
  on public.drone_images for insert to authenticated
  with check (company_id = public.user_company_id());

drop policy if exists "drone_images_update_company" on public.drone_images;
create policy "drone_images_update_company"
  on public.drone_images for update to authenticated
  using (company_id = public.user_company_id())
  with check (company_id = public.user_company_id());

drop policy if exists "drone_images_delete_company" on public.drone_images;
create policy "drone_images_delete_company"
  on public.drone_images for delete to authenticated
  using (company_id = public.user_company_id());

-- ─── Progress Snapshots (master plan table #19) ───────────────────────────────
-- Point-in-time cleared-area measurements from telematics, drone, or operator.

create table if not exists public.progress_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  pasture_id uuid references public.pastures (id) on delete set null,
  snapshot_date timestamptz not null default now(),
  source text not null
    check (source in ('telematics', 'drone', 'operator_manual')),
  progress_pct real not null check (progress_pct between 0 and 100),
  cleared_acres real,
  remaining_acres real,
  comparison_heatmap_url text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists progress_snapshots_company_id_idx on public.progress_snapshots (company_id);
create index if not exists progress_snapshots_job_id_idx on public.progress_snapshots (job_id);
create index if not exists progress_snapshots_snapshot_date_idx on public.progress_snapshots (snapshot_date);

alter table public.progress_snapshots enable row level security;

drop policy if exists "progress_snapshots_select_company" on public.progress_snapshots;
create policy "progress_snapshots_select_company"
  on public.progress_snapshots for select to authenticated
  using (company_id = public.user_company_id());

drop policy if exists "progress_snapshots_insert_company" on public.progress_snapshots;
create policy "progress_snapshots_insert_company"
  on public.progress_snapshots for insert to authenticated
  with check (company_id = public.user_company_id());

drop policy if exists "progress_snapshots_update_company" on public.progress_snapshots;
create policy "progress_snapshots_update_company"
  on public.progress_snapshots for update to authenticated
  using (company_id = public.user_company_id())
  with check (company_id = public.user_company_id());

drop policy if exists "progress_snapshots_delete_company" on public.progress_snapshots;
create policy "progress_snapshots_delete_company"
  on public.progress_snapshots for delete to authenticated
  using (company_id = public.user_company_id());

-- ─── Progress Reports (master plan table #20) ─────────────────────────────────
-- Customer-facing progress report PDFs generated from progress snapshots.

create table if not exists public.progress_reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  client_id uuid references public.clients (id) on delete set null,
  report_number text not null,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'viewed')),
  report_date date not null default current_date,
  overall_progress_pct real check (overall_progress_pct between 0 and 100),
  cleared_acres real,
  remaining_acres real,
  snapshot_ids uuid[] default '{}',
  survey_ids uuid[] default '{}',
  notes text,
  pdf_url text,
  sent_at timestamptz,
  viewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists progress_reports_company_id_idx on public.progress_reports (company_id);
create index if not exists progress_reports_job_id_idx on public.progress_reports (job_id);
create index if not exists progress_reports_client_id_idx on public.progress_reports (client_id);

alter table public.progress_reports enable row level security;

drop policy if exists "progress_reports_select_company" on public.progress_reports;
create policy "progress_reports_select_company"
  on public.progress_reports for select to authenticated
  using (company_id = public.user_company_id());

drop policy if exists "progress_reports_insert_company" on public.progress_reports;
create policy "progress_reports_insert_company"
  on public.progress_reports for insert to authenticated
  with check (company_id = public.user_company_id());

drop policy if exists "progress_reports_update_company" on public.progress_reports;
create policy "progress_reports_update_company"
  on public.progress_reports for update to authenticated
  using (company_id = public.user_company_id())
  with check (company_id = public.user_company_id());

drop policy if exists "progress_reports_delete_company" on public.progress_reports;
create policy "progress_reports_delete_company"
  on public.progress_reports for delete to authenticated
  using (company_id = public.user_company_id());

drop trigger if exists set_progress_reports_updated_at on public.progress_reports;
create trigger set_progress_reports_updated_at
  before update on public.progress_reports
  for each row execute function public.set_updated_at();
