# TODO — Cedar Hack (Cactus Creek Clearing System)

> **Last updated:** April 2026
>
> This is the comprehensive task list derived from the master plan documents. It covers
> everything remaining to complete the full system — frontend features, backend/Supabase
> wiring, mobile/UX improvements, and integrations. Items are grouped by priority and
> system area. Checked items are complete; unchecked items are outstanding.

---

## Table of Contents

1. [Completed Work (What's Done)](#1-completed-work-whats-done)
2. [Critical: Supabase & Backend Wiring](#2-critical-supabase--backend-wiring)
3. [Mobile & UX Improvements](#3-mobile--ux-improvements-for-non-technical-field-users)
4. [Bid System Enhancements](#4-bid-system-enhancements)
5. [Operator / Field Crew Experience](#5-operator--field-crew-experience)
6. [Job & Operations Management](#6-job--operations-management)
7. [Fleet & Equipment Management](#7-fleet--equipment-management)
8. [Scheduling & Dispatch](#8-scheduling--dispatch)
9. [3D Holographic View (Deferred)](#9-3d-holographic-view-deferred)
10. [Drone Photogrammetry Integration](#10-drone-photogrammetry-integration)
11. [AI & Cedar Detection Pipeline](#11-ai--cedar-detection-pipeline)
12. [Customer Portal & CRM](#12-customer-portal--crm)
13. [Invoicing & Financial](#13-invoicing--financial)
14. [Analytics & Reporting](#14-analytics--reporting)
15. [Notifications & Communication](#15-notifications--communication)
16. [Progress Tracking & Customer Reports](#16-progress-tracking--customer-reports)
17. [Self-Improving Feedback Loop](#17-self-improving-feedback-loop)
18. [Infrastructure & DevOps](#18-infrastructure--devops)

---

## 1. Completed Work (What's Done)

These features are built and working today:

- [x] **Bid management** — Full CRUD via `/bids` and `/bid/[id]` with BidEditorClient, pasture cards, map polygon drawing
- [x] **Cedar detection (streaming)** — Multi-band spectral analysis (NAIP + Sentinel-2) via `/api/cedar-detect` with chunked processing, resume/checkpoint support
- [x] **Fleet management** — `/fleet` page with add/edit machines, fuel log, maintenance log, hours tracking (localStorage + Supabase hybrid)
- [x] **Job lifecycle** — `/operations` dashboard, convert bid→job via `/api/jobs/from-bid`, team invites, status tracking
- [x] **Real-time monitoring** — `/monitor` and `/monitor/tv` with live GPS positions, cleared cell counter, team roster via Supabase Realtime
- [x] **On-site operator mode** — `/operate/[id]` with GPS trail, 2D cedar overlay, work order execution
- [x] **Time tracking** — Clock in/out and manual entry in `JobExecutionPanel.tsx`
- [x] **Configurable rate cards** — `RateCardSettings.tsx` and `rates.ts` with multi-factor pricing (density, terrain, method, soil)
- [x] **Geospatial analysis** — NDVI, SAVI, GNDVI indices; spectral fusion; seasonal intelligence via `/api/seasonal`
- [x] **PDF export** — Multi-page bid documents via jsPDF (cover, overview, pasture details, summary, terms, signatures)
- [x] **Multi-user jobs** — Company-scoped team assignments, job invites, RLS policies
- [x] **Offline-first job data** — GPS trail persistence to localStorage, work orders persist offline
- [x] **Supabase auth** — Magic link + password auth with session refresh middleware
- [x] **Soil data integration** — `/api/soil` and `/api/soilweb` querying NRCS/USDA
- [x] **Elevation data** — `/api/elevation` for terrain queries
- [x] **AI bid population** — `/api/ai-populate` via Anthropic Claude
- [x] **Client management** — `/clients` and `/clients/[id]` with full CRUD
- [x] **System health** — `/sys-health` diagnostics page
- [x] **Landing page** — Hero, features, auth links with Framer Motion animations

---

## 2. Critical: Supabase & Backend Wiring

These are the highest-priority items — the system can't fully function in production
until these are wired up. Currently, bids and fleet data live primarily in localStorage
which means no multi-device sync, no data backup, and single-browser-only access.

### 2.1 Migrate Bids from localStorage to Supabase (Primary Data Source)

- [ ] **Bid write-through to Supabase** — Currently bids are saved to `ccc_bid_{bidId}` in localStorage only. Wire up the existing `bids` and `pastures` Supabase tables as the primary write target, with localStorage as an offline cache/fallback.
  - The `bids` and `pastures` tables already exist in the migration (`20260410_000002_core_tables.sql`)
  - `src/lib/db.ts` has Supabase adapter helpers — connect these to the Zustand store (`src/lib/store.ts`)
  - On save: write to Supabase first, then cache in localStorage
  - On load: fetch from Supabase, fall back to localStorage if offline
- [ ] **Bid list sync** — Replace `ccc_bids_list` localStorage key with Supabase query on `/bids` page load
- [ ] **Pasture polygon storage** — Pasture GeoJSON polygons need to save to the `pastures.polygon` column (already in schema) rather than only being in the Zustand store
- [ ] **Rate card snapshot** — When saving a bid, snapshot the current rate card into `bids.rate_card_snapshot` so historical bids retain their pricing even if the rate card changes
- [ ] **Bid status workflow** — Wire up bid status transitions (draft → sent → accepted → declined → expired) in the UI and enforce via Supabase RLS/triggers
- [ ] **Bid versioning** — Track bid revisions; store previous versions so you can see "Revision 3 of 5"

### 2.2 Migrate Fleet from localStorage to Supabase

- [ ] **Fleet machine sync** — `fleet_machines` table exists in migration (`20260412120000_fleet_machines.sql`). Wire `src/lib/fleet-storage.ts` to use Supabase as primary, localStorage as offline cache
  - The `ccc_fleet_migration_flag` localStorage key suggests migration was planned but not completed
- [ ] **Fleet machine CRUD via API** — Create `/api/fleet` and `/api/fleet/[id]` API routes with proper RLS (company-scoped)
- [ ] **Maintenance records table** — Create migration for `maintenance_records` table (master plan table #14) to track service history, parts cost, labor cost, downtime
- [ ] **Teeth change records table** — Create migration for `teeth_change_records` table (master plan table #15) to correlate teeth life with soil series and rock %

### 2.3 Missing Supabase Tables (From Master Plan Data Model)

The master plan defines 24 tables. Currently ~15 exist. These are still needed:

- [ ] **`properties`** — Multiple properties per client (gate codes, access notes, boundaries). The table exists in the schema but the UI doesn't use it — wire `/clients/[id]` to allow adding/editing properties
- [ ] **`attachments`** — Mulcher heads, grapples (master plan table #13). Track compatible machines, total hours, teeth change intervals
- [ ] **`maintenance_records`** — Service history per machine/attachment (master plan table #14)
- [ ] **`teeth_change_records`** — Consumable tracking by soil type (master plan table #15)
- [ ] **`calibration_records`** — Feedback loop data: predicted vs actual hours (master plan table #16)
- [ ] **`drone_surveys`** — Photogrammetry job tracking (master plan table #17)
- [ ] **`drone_images`** — Individual drone photos with EXIF GPS (master plan table #18)
- [ ] **`progress_snapshots`** — Before/after drone comparison calculations (master plan table #19)
- [ ] **`progress_reports`** — Customer-facing progress PDFs (master plan table #20)
- [ ] **`invoices`** — Financial documents with line items, change orders, payment status (master plan table #21)
- [ ] **`pdf_versions`** — Version control for generated PDFs (master plan table #22)
- [ ] **`contact_logs`** — CRM communication history (master plan table #24)
- [ ] **`telematics_readings`** — Raw GPS/engine data from OEM APIs (master plan table #12)
- [ ] **`audit_log`** — Compliance audit trail for all data changes

### 2.4 Missing API Routes (From Master Plan)

- [ ] **`DELETE /api/jobs/[id]`** — Job deletion (currently not exposed)
- [ ] **`PATCH /api/jobs/[id]/work-orders/[workOrderId]`** — Work order update (currently not exposed)
- [ ] **`GET/POST /api/fleet`** — Fleet CRUD API routes
- [ ] **`POST /api/fleet/[id]/maintenance`** — Record maintenance event
- [ ] **`POST /api/fleet/[id]/teeth-change`** — Log teeth change
- [ ] **`GET /api/fleet/[id]/telematics`** — Fetch latest telematics reading
- [ ] **`POST /api/drone/upload`** — Drone image ingest with EXIF extraction
- [ ] **`POST /api/drone/process`** — Submit to OpenDroneMap, poll status
- [ ] **`GET /api/drone/task/[taskId]`** — Poll ODM processing status
- [ ] **`POST /api/invoices`** — Generate invoice from completed job
- [ ] **`POST /api/invoices/[id]/email`** — Email invoice to customer
- [ ] **`GET /api/analytics/dashboard`** — Owner dashboard metrics
- [ ] **`GET /api/analytics/profitability`** — Job profitability by method/soil
- [ ] **`POST /api/progress/snapshot`** — Calculate completion % from drone/telematics
- [ ] **`POST /api/progress/report`** — Generate and email progress report PDF
- [ ] **`GET/POST /api/customers/[id]/contact-log`** — CRM communication history
- [ ] **`POST /api/schedule/weather`** — Fetch 7-day forecast for job site
- [ ] **`GET /api/telematics/sync`** — Scheduled job to poll equipment OEM APIs
- [ ] **`POST /api/time-entries/[id]/approve`** — Crew lead time entry approval

### 2.5 RLS & Security Gaps

- [ ] **Role enforcement in UI** — Roles (owner, operator, crew_lead, viewer) are defined in the `profiles` table but the UI doesn't enforce them. An operator shouldn't see rate card settings; a viewer shouldn't be able to edit bids.
  - Add role checks in `AppShell.tsx` sidebar navigation
  - Add role checks in each page component (show/hide edit buttons)
  - Add role checks in API routes (return 403 for unauthorized role)
- [ ] **RLS for fleet tables** — `fleet_machines` has company-scoped RLS, but `maintenance_records`, `attachments`, `teeth_change_records` will need the same pattern
- [ ] **RLS for financial tables** — `invoices` should be restricted to owner/crew_lead roles; operators see read-only
- [ ] **API key auth for external integrations** — The master plan mentions telematics webhook endpoints; these need a separate auth mechanism (API key or webhook signature verification)
- [ ] **Supabase Storage buckets** — Create storage buckets for: `drone-images`, `orthomosaics`, `bid-pdfs`, `progress-reports`, `equipment-photos`, `before-after-photos`

### 2.6 Supabase Realtime Subscriptions

- [ ] **Bid updates in real-time** — If two users edit the same bid, changes should sync via Supabase Realtime (currently localStorage is single-browser only)
- [ ] **Job status changes** — Subscribe to `jobs` table changes so the `/operations` dashboard updates live when a job status changes
- [ ] **Fleet status updates** — Equipment status changes (available → assigned → maintenance) should push to all connected clients
- [ ] **Notification feed** — Realtime subscription for user-specific notifications (job assignments, invite responses, maintenance alerts)

---

## 3. Mobile & UX Improvements (For Non-Technical Field Users)

The primary users are clearing crew operators — guys on bulldozers and mulchers in the
Texas Hill Country. They're on phones (not laptops), often in direct sunlight, wearing
gloves, with spotty cell service. Every interaction needs to be dead simple.

### 3.1 Overall App Navigation & Onboarding

- [ ] **Simplified mobile navigation** — Replace the desktop sidebar with a bottom tab bar on mobile (5 tabs max: Jobs, Map, Fleet, Bids, More). The current sidebar hamburger menu requires too many taps.
  - `AppShell.tsx` already has responsive behavior but needs a dedicated mobile bottom nav component
  - Use large 44px+ touch targets for all nav items
  - Badge counts on tabs (e.g., "3 active jobs", "1 maintenance alert")
- [ ] **Role-based home screen** — After login, route users to the right place automatically:
  - **Owner/crew lead** → `/operations` dashboard
  - **Operator** → `/operate/[id]` for their assigned job (or job picker if multiple)
  - **Viewer** → `/bids` list (read-only)
- [ ] **First-time onboarding wizard** — Walk new users through:
  1. Company profile setup (name, logo, contact info)
  2. Rate card configuration (or accept defaults for Hill Country cedar clearing)
  3. Add first piece of equipment
  4. Draw first bid polygon
  - Use a step-by-step overlay with big buttons, not a dense settings page
- [ ] **Quick-action floating button (FAB)** — On mobile, add a floating action button with the most common actions: "New Bid", "Clock In", "Log Hours". One tap to the most frequent task.
- [ ] **Breadcrumb simplification** — Remove breadcrumbs on mobile (they waste space). Use a simple back arrow + page title.

### 3.2 Operator Mobile Experience (The "Money Screen")

This is the most critical mobile view — it's what operators use all day in the field.

- [ ] **Large, glove-friendly buttons** — All touch targets must be minimum 48px height (preferably 56px). Current buttons in `OperatorClient.tsx` need sizing review.
  - Clock in/out button should be huge (full-width, 64px+ tall, high contrast)
  - "Mark Area Cleared" button should be prominent and always visible
- [ ] **High-contrast mode for sunlight** — Add a sunlight/outdoor mode toggle:
  - White text on black background for map overlay controls
  - Increase contrast on all status indicators
  - Larger font sizes (minimum 16px body, 20px for key metrics)
  - Consider auto-detecting ambient light if possible (CSS `prefers-contrast: more`)
- [ ] **Simplified operator dashboard** — When an operator opens the app, show:
  - Today's job name and location (big text, top of screen)
  - "Clock In" mega-button (if not clocked in)
  - Map with their GPS dot, pasture boundaries, and cedar overlay
  - Current acres cleared / total acres (big progress bar)
  - Equipment assigned and next service due
  - That's it. No rate cards, no bid details, no admin settings.
- [ ] **One-tap clock in/out** — Currently time tracking is inside `JobExecutionPanel.tsx`. For mobile operators, clock in should be a single tap from the main screen — no navigating into panels or tabs.
- [ ] **GPS accuracy indicator** — Show a colored dot (green = accurate, yellow = moderate, red = poor) so operators know if their GPS trail is reliable. Use the `accuracy` field from `navigator.geolocation.watchPosition()`.
- [ ] **Offline status banner** — Show a clear, persistent banner when offline: "📡 Offline — data will sync when back in range". Many Hill Country sites have no cell service. Operators need confidence their data isn't lost.
- [ ] **Shake-to-report** — Consider a "shake phone to report issue" gesture for quick equipment problem reporting (engine warning, flat tire, etc.) — opens a simplified form with tappable preset options rather than typing.

### 3.3 Map Interactions on Mobile

- [ ] **Larger polygon draw handles** — Mapbox GL Draw's default vertex handles are tiny on mobile. Override the styles to make vertices 20px+ diameter circles.
- [ ] **Pinch-to-zoom without accidental draws** — Disable polygon drawing mode by default on mobile. Require explicit "Draw" button press to enter drawing mode. Currently, two-finger pinch can conflict with drawing gestures.
- [ ] **Map layer toggle simplification** — The current layer toggles (satellite, NDVI, soil, contours, cedar overlay) should use large icon buttons in a floating toolbar, not a dropdown menu. Each icon should show active/inactive state clearly.
- [ ] **Offline tile caching** — Cache Mapbox satellite tiles for the active job area so the map works in dead zones. Use Service Worker + Cache API to pre-download tiles at zoom levels 13-17 for the job polygon bbox.
  - Show a "Download map for offline" button on the job detail page
  - Display cached area as a dashed outline on the map
  - Estimated download size indicator (e.g., "~15 MB for this area")
- [ ] **Map follows operator GPS** — Add a "follow me" toggle that centers the map on the operator's GPS position (like navigation apps). Currently the map is static — operators have to manually pan to find themselves.

### 3.4 Form Inputs & Data Entry

- [ ] **Tappable selection grids instead of dropdowns** — For vegetation type, density, terrain, clearing method, and disposal method, replace `<select>` dropdowns with visual tap grids (3-4 large buttons per row). Operators shouldn't have to scroll through dropdown options — they should see and tap.
  - Example: Density selector → 4 buttons: "Light 🌿" / "Moderate 🌲" / "Heavy 🌲🌲" / "Extreme 🌲🌲🌲"
  - Example: Method selector → icons for Mulch, Chainsaw, Dozer, Selective, etc.
- [ ] **Voice-to-text for notes** — Add a microphone button next to all text input fields (job notes, daily log, equipment issues). Operators in the field can't easily type — let them dictate.
  - Use the Web Speech API (`SpeechRecognition` interface)
  - Show a pulsing red circle while recording
- [ ] **Photo capture integration** — Allow operators to take photos directly from the app (before/after shots, equipment issues, site conditions):
  - Use `<input type="file" accept="image/*" capture="environment">` for camera
  - Auto-tag photos with GPS coordinates, timestamp, and active job ID
  - Store in Supabase Storage `job-photos` bucket
  - Display photo gallery on job detail page
- [ ] **Daily end-of-day log (tappable)** — Replace the current notes text area with a guided daily log:
  - "Acres cleared today" → slider or number stepper (not text input)
  - "Equipment issues?" → tappable options: None / Minor / Major / Breakdown
  - "Conditions?" → tappable: Dry / Dusty / Muddy / Rocky / Steep
  - "Weather impact?" → tappable: None / Rain Delay / Wind Delay / Heat Break
  - "Notes" → optional text field with voice-to-text
  - One big "Submit Daily Log" button at the bottom
- [ ] **Number inputs with stepper buttons** — For all numeric inputs (acres, hours, fuel gallons), add +/- stepper buttons alongside the text input. Prevents keyboard pop-up on mobile for simple adjustments.

### 3.5 Performance & Loading on Mobile

- [ ] **NDVI overlay performance** — NAIP NDVI raster tiles load from USGS ImageServer which is slow on cellular. Improvements:
  - Pre-render NDVI tiles server-side and cache in Supabase Storage
  - Use lower-resolution tiles on mobile (zoom-limited to level 15)
  - Show a "Loading analysis..." skeleton with progress indicator
  - Allow operators to dismiss/hide the overlay if it's slowing things down
- [ ] **Lazy-load heavy components** — Cedar analysis, PDF generation, and the rate card editor should load on-demand (`React.lazy` / `next/dynamic`). Don't ship these to operators who don't need them.
- [ ] **Reduce initial bundle for operator route** — The `/operate/[id]` route should be as lightweight as possible. Strip out bid editing, rate card, and admin components from this route's bundle.
- [ ] **Skeleton loading states** — Add skeleton screens (shimmer placeholders) for all data-loading pages instead of blank screens or spinners. Non-technical users interpret blank screens as "broken".
- [ ] **Image optimization** — Use Next.js `<Image>` component for all images. Map screenshots and satellite imagery should serve in WebP with appropriate `sizes` for mobile viewports.
- [ ] **Reduce Mapbox load time** — Set `optimizeForTerrain: false` and `fadeDuration: 0` on mobile to improve initial map render speed. Load satellite tiles only for the job's bounding box, not the entire viewport.

### 3.6 PWA & Offline Capability

- [ ] **Full PWA offline shell** — The app has `next-pwa` configured but needs a proper offline experience:
  - Cache the app shell (HTML, CSS, JS) so the app opens instantly even offline
  - Show cached job data when offline
  - Queue all writes (time entries, GPS tracks, notes, cleared cells) in IndexedDB
  - Sync queue when connectivity returns (with conflict resolution)
  - Show sync status indicator: "3 items pending sync" → "All synced ✓"
- [ ] **Background GPS sync** — Use the Background Sync API to continue uploading GPS tracks even when the app is in the background or the phone screen is off
- [ ] **Add to Home Screen prompt** — Prompt operators to install the PWA on first visit. On iOS, show instructions for "Add to Home Screen" since iOS doesn't auto-prompt.
- [ ] **Offline map tiles** — Pre-cache satellite tiles for active job areas (see 3.3 above)

### 3.7 Accessibility & Inclusivity

- [ ] **Large text option** — Add a text size toggle in settings (Normal / Large / Extra Large). Many field workers are 40-60+ years old and may struggle with small text.
- [ ] **Color-blind friendly overlays** — The cedar (red) vs oak (blue) vs cleared (green) color coding should work for red-green color blindness. Add pattern overlays (hatching, dots) as a secondary indicator.
- [ ] **Spanish language support** — Many clearing crew members in the Hill Country speak Spanish as a primary language. Prioritize translating the operator interface (clock in/out, daily log, equipment status). The admin/bidding interface can remain English-only initially.
- [ ] **Simple error messages** — Replace technical error messages ("RLS policy violation", "401 Unauthorized") with plain language ("Something went wrong — try again" or "You don't have permission to do this. Ask your crew lead for access."). Log technical details to console for debugging.

---

## 4. Bid System Enhancements

The bid system is the most complete area of the app. These items refine and extend it.

- [ ] **Multi-option bids** — Present 2-3 method options per bid on the PDF (e.g., Premium $64k / Standard $45k / Budget $34k). This shifts customer psychology from "hire them?" to "which package?"
  - Allow selecting different methods per pasture within the same bid
  - Generate comparison pricing table in the PDF
  - UI: tabs or toggle in BidEditorClient showing "Option A / Option B / Option C"
- [ ] **Bid templates** — Save bid configurations as reusable templates (e.g., "Standard Hill Country Cedar" with pre-set rates, methods, and disposal). New bids can start from a template instead of scratch.
- [ ] **Bid duplication** — "Duplicate this bid" button to quickly create a similar bid for a nearby property or repeat customer
- [ ] **Bid sharing via link** — Generate a unique shareable URL that shows a read-only bid view (no auth required) for customer review. Track when the customer opens it (set bid status to "viewed").
- [ ] **Electronic signature** — Allow customers to sign bids digitally from the shared link. Use a simple canvas-based signature pad. Converts bid status to "accepted" on sign.
- [ ] **Bid expiration** — Auto-set bid expiry (default 30 days). Show countdown on bid card. Move to "expired" status automatically via Supabase cron or edge function.
- [ ] **Custom line items** — The schema supports `custom_line_items` JSONB but the UI may not have full add/edit/remove. Ensure users can add items like "Gate repair: $350" or "Extra mobilization: $500".
- [ ] **Bid PDF improvements:**
  - [ ] Include AI density heatmap image in the PDF
  - [ ] Include soil data summary per pasture
  - [ ] Add 3D screenshot when hologram view is working
  - [ ] Watermark "DRAFT" on unsent bids
  - [ ] Add configurable terms & conditions text (per company)
  - [ ] Version the PDF (keep old versions in Supabase Storage)
- [ ] **Map screenshot in bid PDF** — Use Mapbox Static Images API or `map.getCanvas().toDataURL()` to embed a satellite map screenshot with polygon outlines in the PDF

---

## 5. Operator / Field Crew Experience

Beyond the UX improvements in section 3, these are feature additions for operators.

- [ ] **Work order display on mobile** — Each pasture should generate a visible work order on the operator's phone showing:
  - Clearing method and step-by-step instructions
  - Protected species (which trees NOT to cut — with photos/examples)
  - Stump treatment requirements
  - Disposal method
  - Hazards (power lines, septic, wells, fences)
  - Buffer zones displayed on map (red = no-clear, blue = protect oaks, yellow = fence lines)
- [ ] **Mark area cleared (2D)** — Implement "mark cleared" as a 2D feature using cedar analysis grid cells. Operator taps on map grid cells to mark them cleared. This was disabled when 3D was removed.
  - Alternative: auto-calculate cleared area from GPS trail × cutting width
  - Show cleared cells in green overlay in real-time
- [ ] **Equipment pre-trip inspection** — Before clocking in, prompt operator to confirm daily pre-trip check:
  - Tappable checklist: Oil level ✓, Hydraulic fluid ✓, Tracks/tires ✓, Guards ✓, Fire extinguisher ✓
  - Takes 30 seconds, saves company from liability
  - Store results in Supabase for compliance
- [ ] **Quick equipment issue reporting** — Big red "Report Problem" button that opens a form with:
  - Tappable issue types: Engine Warning, Hydraulic Leak, Track/Tire, Electrical, Fire Extinguisher, Other
  - Severity: Can Continue / Need Parts / Machine Down
  - Photo upload
  - Auto-notifies crew lead via push notification
- [ ] **Buddy system / safety check-in** — For solo operators in remote areas:
  - Auto check-in every 2 hours (simple "I'm OK" tap)
  - If no response in 30 minutes, alert crew lead with last known GPS position
  - Emergency SOS button that shares GPS with designated contacts

---

## 6. Job & Operations Management

- [ ] **Job deletion API** — `DELETE /api/jobs/[id]` is not exposed. Add with appropriate RLS (owner/crew_lead only).
- [ ] **Work order updates API** — `PATCH /api/jobs/[id]/work-orders/[workOrderId]` for status updates, progress %, completion.
- [ ] **Bulk job operations** — Select multiple jobs for bulk status change, re-assignment, or archiving on the `/operations` page.
- [ ] **Job cost tracking** — Track actual costs against the bid:
  - Labor hours × hourly rate
  - Fuel consumed × fuel price
  - Equipment hours × equipment cost per hour
  - Consumables (teeth, parts)
  - Compare to bid amount to show profit/loss in real-time
- [ ] **Change orders** — When the scope changes mid-job (more acreage, different method, extra obstacles):
  - Create a change order UI that adjusts the contract amount
  - Track change order history
  - Customer approval workflow (email or in-app signature)
- [ ] **Job handoff notes** — When one crew finishes and another starts (multi-day jobs), allow digital handoff notes: "Left off at the north fence line", "Watch for low-hanging power line near the creek."
- [ ] **Post-job review form** — After completion, crew lead fills in per pasture:
  - Actual hours, equipment used, crew size
  - Weather delays
  - Was it lighter or heavier than expected? (1-5 accuracy rating)
  - Before/after photos
  - This feeds the calibration/feedback loop (section 17)

---

## 7. Fleet & Equipment Management

- [ ] **Equipment cost per hour calculation** — Display the all-in cost per hour for each machine:
  ```
  totalCostPerHour = fuelCostPerHour + maintenanceCostPerHour + depreciationPerHour
  ```
  Show this on the fleet card so crew leads can assign the most cost-effective machine.
- [ ] **Attachment tracking** — Mulcher heads and grapples are expensive consumables. Track:
  - Which attachment is on which machine
  - Total hours on each attachment
  - Teeth change history and intervals
  - Compatible machines list
  - Teeth life correlation with soil series (e.g., Tarrant series = ~80 hrs/set vs Krum = ~200 hrs/set)
- [ ] **Maintenance alerts** — Proactive notifications when service is due:
  - Oil/filter (every 500 hrs)
  - Hydraulic filter (every 500 hrs)
  - Teeth change (every 80-200 hrs depending on soil)
  - Tracks (every 250 hrs)
  - Full service (every 2000 hrs)
  - Show countdown on fleet card: "Oil change due in 47 hours"
- [ ] **Daily inspection log (digital)** — Pre-trip inspection stored in Supabase for compliance and insurance
- [ ] **Equipment telematics integration** — Wire up at least one of:
  - CAT Product Link (ISO 15143-3 AEMP 2.0) for CAT machines
  - Samsara REST API for aftermarket trackers
  - CalAmp/Titan for budget GPS pucks
  - Poll every 60 seconds: GPS, engine hours, idle hours, fuel level, fault codes
  - Auto-calculate cleared area from machine path × cutting width
- [ ] **Equipment photo gallery** — Upload photos of each machine (for insurance records and identification)

---

## 8. Scheduling & Dispatch

- [ ] **Visual calendar view** — `/schedule` page needs a proper calendar UI (week/month view) showing:
  - Job blocks with color coding by status
  - Equipment assignments per day
  - Crew member schedules
  - Drag-to-reschedule (desktop)
  - Tap-to-view-details (mobile)
- [ ] **Conflict detection** — Automatically flag:
  - Equipment double-booked on the same day
  - Crew member assigned to two jobs same day
  - Maintenance due during a scheduled job
  - Back-to-back jobs with no mobilization day between
- [ ] **Weather integration** — Pull 7-day forecast for each job site location:
  - Use OpenWeather or WeatherAPI (free tier)
  - Auto-flag days with >50% rain probability (cedar clearing shuts down when wet)
  - Show weather icons on calendar days
  - Mark workable vs non-workable days
  - Alert crew lead 24 hours before a rain day
- [ ] **Mobilization planning** — Track equipment transport:
  - Lowboy/trailer availability
  - Drive time between jobs
  - Mobilization/demobilization cost tracking
- [ ] **SMS schedule notifications** — Text operators their schedule: "Tomorrow: Cedar clearing at Smith Ranch, Report 7:00 AM, Hwy 16 gate code 4521"

---

## 9. 3D Holographic View (Deferred)

The Three.js-based 3D holographic tree layer was disabled due to WebGL context conflicts
with Mapbox GL. The 2D cedar fill-extrusion overlay is used instead.

### Known Issues

- [ ] **3D trees don't render on Mapbox satellite style** — The `TreeLayer3D` custom layer shares the Mapbox WebGL context. The projection matrix and viewport setup need debugging (camera `matrixAutoUpdate`, `projectionMatrixInverse`, drawingBuffer dimensions). Currently disabled.
- [ ] **3D terrain + hologram conflict** — Mapbox 3D terrain (`map.setTerrain`) and the Three.js custom layer cause rendering issues. They are mutually exclusive. Investigate using terrain elevation queries to position trees without enabling the terrain source.
- [ ] **Species visibility toggles removed** — Per-species (cedar/oak/mixed) toggles and tree marking UI were removed when 3D was disabled. Re-add when 3D rendering is fixed.
- [ ] **Tree marking (save/remove) disabled** — Click-to-mark trees via `findNearestTree()` requires the 3D layer. Reimplement as a 2D feature using cedar analysis grid cells (see section 5).
- [ ] **3D screenshots for bid PDF** — When working, capture a 3D visualization screenshot to include in the bid PDF (huge "wow" factor for customers).

### Files

- `src/components/map/MapContainer.tsx` — Layer toggle logic, hologram mode
- `src/app/operate/[id]/OperatorClient.tsx` — Operator mode (uses 2D cedar overlay)
- Note: `src/lib/tree-layer.ts` was removed; hologram mode uses 2D cedar fill-extrusion overlay

---

## 10. Drone Photogrammetry Integration

Drone imagery is 30-60× more detail than satellite (1-2cm vs 0.6m pixels). This is a
game-changer for bid accuracy and customer presentations.

- [ ] **Drone image upload UI** — Drag-and-drop or mobile file picker for JPG uploads:
  - Extract EXIF GPS from each image automatically
  - Show upload progress bar
  - Display image positions on map as dots
  - Validate: minimum image count, GPS data present, overlap estimation
- [ ] **OpenDroneMap (ODM) integration** — Submit images to NodeODM (self-hosted) or WebODM Lightning (cloud):
  - POST images to ODM endpoint
  - Poll processing status (pending → processing → completed → failed)
  - Show processing progress % and estimated time remaining
  - Download outputs: orthomosaic, DSM, DTM, point cloud
- [ ] **Canopy Height Model (CHM)** — Compute DSM minus DTM to get tree heights:
  - Local maxima detection for individual tree tops
  - Measured (not estimated) tree heights
  - Per-pixel height data for species classification
- [ ] **Orthomosaic map overlay** — Replace satellite tiles with high-res drone orthomosaic:
  - Serve as Mapbox raster source
  - Store in Supabase Storage
  - Toggle on/off in layer controls
- [ ] **AI re-run on drone data** — Run cedar detection on drone orthomosaic for much higher confidence (0.85-0.95 vs 0.5-0.7 from satellite):
  - Ground truth for ML model training
  - Individual tree segmentation at 2cm resolution
- [ ] **Flight planning helper** — Guide for operators:
  - Recommended altitude (150-200 ft AGL)
  - Overlap settings (75% front, 65% side)
  - Flight pattern (grid/lawnmower)
  - Time window (10am-2pm for minimal shadows)
  - Battery estimation (~25-30 acres per battery at 200ft)
- [ ] **Progress flyovers** — Compare baseline CHM to current CHM to calculate clearing progress:
  - `(baseline_veg_pixels - current_veg_pixels) / baseline_veg_pixels × 100`
  - Generate before/after comparison heatmap

---

## 11. AI & Cedar Detection Pipeline

### Phase 1 (Current — Rule-Based NDVI)

- [x] **Streaming cedar detection** — Multi-band spectral analysis working via `/api/cedar-detect`
- [x] **Sentinel-2 + NAIP fusion** — Spectral fusion for consensus classification
- [x] **Seasonal intelligence** — Winter vs summer NDVI comparison via `/api/seasonal`
- [ ] **Improve seasonal accuracy** — Current rule: cedar seasonality persistence > 0.75 + winter NDVI > 0.35 = cedar. Fine-tune thresholds based on completed job ground truth.

### Phase 2 (Month 3-6 — Before/After Training)

- [ ] **Post-clearing satellite comparison** — After a job is completed, automatically fetch new satellite imagery and compare to pre-clearing imagery. This creates free labeled training data.
- [ ] **Satellite calibration factors** — Use drone ground truth to calibrate satellite density estimates: `satellite_density × correction_factor = calibrated_density`

### Phase 3 (Month 6+ — ML Tree Detection)

- [ ] **Python FastAPI microservice** — Deploy on Railway for GPU-accelerated inference:
  - U-Net model for pixel-level classification (cedar small/medium/large, oak, grass, background)
  - Train on drone imagery ground truth from 20+ completed jobs
  - Input: 256×256 NAIP patches
  - Output: per-pixel classification, connected component analysis for tree counting
- [ ] **Model versioning and A/B testing** — Track model versions, compare predictions against actuals
- [ ] **Confidence scoring** — Display confidence level on each analysis (0.0 to 1.0) so bid creators know how much to trust the AI

---

## 12. Customer Portal & CRM

- [ ] **Client detail page improvements** — `/clients/[id]` should show:
  - All properties with map boundaries
  - Bid history (all bids for this client)
  - Job history (all jobs for this client)
  - Total revenue from this client
  - Win rate (bids accepted / bids sent)
  - Preferred clearing method, contact method, payment terms
  - Referral source tracking
- [ ] **Communication/contact log** — Track all interactions:
  - Phone calls, emails, texts, site visits, bid sent, invoice sent, payment received
  - Follow-up reminders ("Call back in 2 weeks")
  - Logged by which team member
- [ ] **Customer-facing portal (separate app or route)** — A simple, no-auth-required view where customers can:
  - View their bid PDF
  - Accept/decline with electronic signature
  - Track active job progress (map with cleared area overlay)
  - View and pay invoices
  - Submit feedback
  - Access is via a unique link sent by email/SMS
- [ ] **Property management** — Use the existing `properties` table:
  - Multiple properties per client
  - Gate codes, access notes, boundary polygons
  - Link bids and jobs to specific properties
  - "Nearest fuel station" and "water source" notes per property

---

## 13. Invoicing & Financial

- [ ] **Invoice generation from job** — When a job is completed, auto-generate an invoice:
  - Pull line items from the original bid
  - Apply any change orders
  - Calculate subtotal, tax, total, deposit paid, amount due
  - Set payment terms and due date
- [ ] **Invoice PDF** — Generate professional invoice PDF (similar to bid PDF):
  - Company logo and contact info
  - Client billing info
  - Line items with per-pasture breakdown
  - Change orders section
  - Payment terms and instructions
  - "Pay by" date
- [ ] **Invoice status tracking** — Track: draft → sent → viewed → partial payment → paid → overdue
- [ ] **Payment recording** — Record payments (check number, date, amount, method)
- [ ] **Overdue alerts** — Auto-flag invoices past due date; send reminder email
- [ ] **QuickBooks integration** (future) — Export invoices to QuickBooks for accounting
- [ ] **Job profitability analysis** — Per job and per pasture:
  - Revenue (bid amount + change orders)
  - Labor cost (hours × rates)
  - Fuel cost (gallons × price)
  - Equipment cost (hours × cost/hr)
  - Consumables (teeth, parts)
  - Gross margin %, revenue/acre, cost/acre, profit/acre, profit/hour
  - Comparison: actual vs bid amounts

---

## 14. Analytics & Reporting

- [ ] **Owner dashboard** — A dedicated `/dashboard` page (currently stub) showing:
  - Active jobs count and status breakdown
  - Revenue MTD/YTD
  - Pipeline value (open bids total)
  - Bid win rate (last 30/90/365 days)
  - Average margin by clearing method
  - Equipment utilization % (active hours / available hours)
  - Upcoming maintenance alerts
  - Bid accuracy trend (predicted vs actual hours over time)
- [ ] **Key reports** (from master plan):
  1. Revenue by month/quarter/year
  2. Profit per acre by clearing method
  3. Profit per acre by soil type
  4. Bid accuracy over time (feedback loop metric)
  5. Equipment cost per hour trends
  6. Crew productivity (acres/hour by operator)
  7. Customer lifetime value
  8. Pipeline forecast (bids × win probability)
  9. Teeth life by soil series (Tarrant vs Krum vs Real)
  10. Seasonal trends (busy months, weather impacts)
- [ ] **Export to CSV** — All report data should be exportable for use in spreadsheets
- [ ] **Monthly email summary** — Auto-send owner a monthly business summary email

---

## 15. Notifications & Communication

- [ ] **In-app notification center** — Replace toast-only notifications with a persistent notification bell icon:
  - Unread count badge
  - Dropdown showing recent notifications
  - Types: job assigned, invite received, maintenance due, schedule change, invoice overdue, weather alert
  - Mark as read, dismiss, or take action
- [ ] **Push notifications (PWA)** — Use Web Push API for operator mobile devices:
  - Job assignment notifications
  - Schedule changes
  - Maintenance alerts
  - Weather warnings for upcoming job days
- [ ] **SMS notifications via Twilio** — Critical alerts for non-app users:
  - Schedule reminders to operators: "Tomorrow: Smith Ranch, 7:00 AM"
  - Customer notifications: "Your clearing job has started" / "50% complete" / "Completed — here's your report"
  - Invoice sent/overdue reminders
- [ ] **Email notifications via Resend** — Transactional emails:
  - Bid sent (with PDF attached)
  - Invoice sent
  - Progress report (with PDF attached)
  - Password reset / magic link (already working)
- [ ] **Notification preferences** — Let users choose which notifications they receive and how (push, SMS, email, in-app)

---

## 16. Progress Tracking & Customer Reports

- [ ] **Progress calculation from three sources:**
  1. **Equipment GPS** — Machine path × cutting width = cleared area (automatic, most reliable)
  2. **Operator marking** — Manual "mark cleared" on phone (immediate)
  3. **Drone flyovers** — Compare current CHM to baseline (most accurate, periodic)
- [ ] **Progress dashboard per job** — Show per-pasture progress bars:
  - Estimated vs actual hours
  - Cleared acres vs total acres
  - Status badges (not started, in progress, completed, rework needed)
- [ ] **Before/after map slider** — Side-by-side or slider overlay showing pre-clearing satellite vs current state
- [ ] **Customer progress report PDF** — Auto-generated, emailed weekly or at milestones:
  - Before/after map comparison
  - Per-pasture progress table
  - Heatmap (green = cleared, red = remaining)
  - Photo gallery
  - Crew notes, weather delays
  - Estimated completion date
- [ ] **Progress timeline** — Show all flyovers and milestones as a timeline view

---

## 17. Self-Improving Feedback Loop

This is what makes the system truly powerful over time — every completed job makes the
next bid more accurate.

- [ ] **Calibration record storage** — After each job, store:
  - Predicted hrs/acre vs actual hrs/acre
  - Error % and direction (over/under estimated)
  - Soil series, density score, terrain, equipment used, crew size
  - Weather delay hours
  - Accuracy rating (1-5 from crew lead)
- [ ] **Auto-trigger model retraining** — After every 5 new completed jobs:
  - Month 0-3 (0-10 jobs): k-nearest-neighbors
  - Month 3-6 (10-25 jobs): Gradient boosting (scikit-learn)
  - Month 6+ (25+ jobs): More sophisticated models, possibly neural network at 100+ records
  - Cross-validation scoring
- [ ] **Accuracy dashboard** — Show bid accuracy improving over time:
  - Scatter plot: predicted vs actual hours
  - Error % trend line
  - Breakdown by method, soil type, density class
- [ ] **Equipment GPS as ground truth** — Machine-verified data (exact hours, fuel, active/idle %) is far more reliable than operator estimates. Prioritize this data source for calibration.
- [ ] **Automatic rate card adjustment suggestions** — When the model detects systematic over/under pricing for certain vegetation types or soil series, suggest rate card adjustments to the owner

---

## 18. Infrastructure & DevOps

- [ ] **Environment variable validation** — Add a startup check that validates all required env vars are set and shows a clear error if not (currently uses non-null assertions that crash at runtime)
- [ ] **Supabase Storage bucket setup** — Create buckets:
  - `bid-pdfs` — Generated bid documents
  - `drone-images` — Raw drone photos
  - `orthomosaics` — Processed drone outputs
  - `job-photos` — Before/after and daily photos
  - `progress-reports` — Customer progress PDFs
  - `equipment-photos` — Fleet machine images
- [ ] **Supabase Edge Functions** — Consider moving heavy processing off Vercel serverless (60s timeout):
  - Cedar detection streaming (can take 2+ minutes for large areas)
  - PDF generation (Puppeteer cold starts are slow)
  - Drone image processing submission
- [ ] **Cron jobs** — Set up scheduled tasks:
  - Invoice overdue checker (daily)
  - Weather forecast fetcher (daily at 6 AM for active job sites)
  - Telematics sync (every 60 seconds for active equipment)
  - Bid expiration checker (daily)
  - Maintenance alert checker (daily)
- [ ] **Error tracking** — Add Sentry or similar for production error monitoring:
  - Client-side React error boundaries
  - Server-side API route error capture
  - Source maps for meaningful stack traces
- [ ] **Database backups** — Supabase Pro includes daily backups, but verify point-in-time recovery is configured for the production database
- [ ] **Staging environment** — Set up a separate Supabase project + Vercel preview for testing changes before production
- [ ] **CI/CD pipeline** — GitHub Actions for:
  - Lint + type check on PR
  - Build verification
  - Supabase migration dry-run
  - Preview deployment on PR

---

## Priority Summary

| Priority | Area | Why |
|----------|------|-----|
| 🔴 **P0** | Bid → Supabase migration (2.1) | No multi-device sync without this; data loss risk |
| 🔴 **P0** | Fleet → Supabase migration (2.2) | Same as above |
| 🔴 **P0** | Mobile operator UX (3.2, 3.4) | Users are on phones in the field — this IS the app for them |
| 🟠 **P1** | Offline PWA (3.6) | Hill Country dead zones make this critical |
| 🟠 **P1** | Role enforcement (2.5) | Operators seeing admin features is confusing |
| 🟠 **P1** | Bottom tab nav for mobile (3.1) | Current sidebar nav is desktop-first |
| 🟡 **P2** | Invoicing (13) | Can't bill customers without this |
| 🟡 **P2** | Scheduling + weather (8) | Manual scheduling is error-prone |
| 🟡 **P2** | Multi-option bids (4) | High close-rate improvement |
| 🟢 **P3** | Drone integration (10) | Game-changer but requires hardware + setup |
| 🟢 **P3** | Telematics (7) | Requires OEM API access or aftermarket hardware |
| 🟢 **P3** | Analytics dashboard (14) | Nice to have; grows in value with more data |
| 🔵 **P4** | Customer portal (12) | Separate app; can use PDF + email in the meantime |
| 🔵 **P4** | ML pipeline (11 Phase 3) | Needs 20+ completed jobs for training data |
| 🔵 **P4** | 3D holographic view (9) | "Wow" factor but 2D overlay works fine |
