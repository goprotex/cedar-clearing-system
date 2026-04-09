# Cactus Creek Clearing — Operations Platform Addendum

**Addendum to:** v2 Plan + Drone/Methods Addendum  
**Date:** April 2026  
**Scope Change:** This addendum expands the bid tool into a full operations platform that manages the entire clearing business lifecycle from bid to invoice.

---

## Table of Contents

1. [Platform Vision](#1-platform-vision)
2. [Field Operator Mobile App](#2-field-operator-mobile-app)
3. [Job Execution and Work Orders](#3-job-execution-and-work-orders)
4. [Time Tracking and Daily Logs](#4-time-tracking-and-daily-logs)
5. [Equipment Management](#5-equipment-management)
6. [Scheduling and Dispatch](#6-scheduling-and-dispatch)
7. [Customer Management and CRM](#7-customer-management-and-crm)
8. [Invoicing and Financials](#8-invoicing-and-financials)
9. [Reporting and Analytics Dashboard](#9-reporting-and-analytics-dashboard)
10. [Notifications and Communication](#10-notifications-and-communication)
11. [Technical Architecture for Mobile](#11-technical-architecture-for-mobile)
12. [Data Model Expansion](#12-data-model-expansion)
13. [Revised Build Phases](#13-revised-build-phases)
14. [What This Replaces](#14-what-this-replaces)

---

## 1. Platform Vision

### Before: Bid Calculator
Draw polygons, calculate price, generate PDF.

### After: Clearing Company Operating System

```
SALES                    OPERATIONS                  BACK OFFICE
─────                    ──────────                  ───────────
Lead comes in            Schedule job                Invoice customer
↓                        ↓                           ↓
Draw polygons            Assign crew + equipment     Track payment
↓                        ↓                           ↓
AI analyzes density      Operators open phone app    Revenue reporting
↓                        ↓                           ↓
Generate bid PDF         See map: what to clear,     Equipment cost tracking
↓                        where, what method          ↓
Customer picks option    ↓                           Profit per job analysis
↓                        Log hours per pasture       ↓
Bid accepted → Job       ↓                           Tax prep exports
                         Log equipment hours         
                         ↓                           
                         Drone progress flyover      
                         ↓                           
                         Customer progress report    
                         ↓                           
                         Mark pasture complete       
                         ↓                           
                         Post-job review             
                         ↓                           
                         Data feeds back into AI     
```

Every step generates data. Every data point makes the next bid more accurate.

### Why This Matters Commercially

A bid tool is a feature. A business operating system is a platform. The difference:

- Bid tool: $50 to $100/month, easy to cancel, easy to replace with a spreadsheet
- Operations platform: $200 to $500/month, deeply embedded in daily operations, switching cost is enormous
- If this works for CCC, it works for every clearing company in Texas. Then the southeast. Then nationwide. That's a real SaaS business.

---

## 2. Field Operator Mobile App

### The Core Experience

The operator opens the app on their phone at 7am on a job site. They see:

1. **Today's assignment:** Which job, which pasture, what method
2. **The map:** Satellite/drone view of the pasture with polygon boundary highlighted
3. **What to clear:** Color coded overlay showing cedar (remove), oak (protect), and cleared areas (done)
4. **How to clear:** Method card showing "Rough Mulch, single pass, stumps cut low"
5. **Clock in button:** Starts logging hours for this pasture
6. **Their location:** GPS dot on the map so they can see where they are relative to the pasture boundary

### Mobile App Screens

**Screen 1: Daily Dashboard**
```
┌─────────────────────────────┐
│  Good morning, Jake         │
│  Tuesday, April 8, 2026    │
│                             │
│  TODAY'S JOB                │
│  ┌───────────────────────┐  │
│  │ Henderson Ranch        │  │
│  │ North Pasture          │  │
│  │ 45.2 acres | Day 3/7   │  │
│  │ Rough Mulch - Cedar    │  │
│  │ ▓▓▓▓▓▓▓▓░░░░ 62%      │  │
│  └───────────────────────┘  │
│                             │
│  [Clock In]  [View Map]     │
│                             │
│  EQUIPMENT                  │
│  ┌───────────────────────┐  │
│  │ CAT 299D3 (#103)      │  │
│  │ Hours today: --        │  │
│  │ Mulcher head: FAE UML  │  │
│  │ Last service: 3/28     │  │
│  │ Next service: 142 hrs  │  │
│  └───────────────────────┘  │
│                             │
│  UPCOMING                   │
│  • Apr 14: Williams Ranch   │
│  • Apr 21: TX DOT ROW       │
│                             │
└─────────────────────────────┘
```

**Screen 2: Job Map (the money screen)**
```
┌─────────────────────────────┐
│  Henderson Ranch - North    │
│  ┌───────────────────────┐  │
│  │                       │  │
│  │   [Satellite map]     │  │
│  │                       │  │
│  │   Polygon boundary    │  │
│  │   shown in orange     │  │
│  │                       │  │
│  │   Cedar = red overlay │  │
│  │   Oak = blue (protect)│  │
│  │   Cleared = green     │  │
│  │                       │  │
│  │   ● Your location     │  │
│  │                       │  │
│  └───────────────────────┘  │
│                             │
│  LAYERS                     │
│  [Satellite] [Density]      │
│  [Soil] [Cleared Areas]     │
│                             │
│  METHOD: Rough Mulch        │
│  • Single pass              │
│  • Stumps cut low           │
│  • Mulch in place           │
│  • PROTECT all oaks         │
│                             │
│  [Mark Area Cleared]        │
│  [Report Issue]  [Photos]   │
│                             │
│  ⏱ Clocked in: 2h 34m      │
│  [Clock Out / Break]        │
│                             │
└─────────────────────────────┘
```

**Screen 3: Mark Area Cleared**

The operator taps "Mark Area Cleared" and either:
- Draws a rough shape on the map of what they just cleared
- Taps "Clear to my GPS track" which uses their location history to shade the area they've been working (the phone tracks their path while clocked in)
- Takes a photo and the app timestamps and geolocates it

This real-time progress data is even better than drone flyovers for day-to-day tracking.

### GPS Track Recording

While clocked in, the app records the operator's GPS position every 30 seconds. This creates a breadcrumb trail that shows exactly where the machine has been, which directly maps to cleared area.

```typescript
interface GPSTrack {
  jobId: string;
  pastureId: string;
  operatorId: string;
  date: string;
  points: {
    lat: number;
    lng: number;
    timestamp: number;
    accuracy: number;  // meters
    speed: number;     // m/s (useful: moving = working, stopped = break/issue)
  }[];
  totalDistanceMeters: number;
  activeMinutes: number;  // time where speed > 0.5 m/s
  idleMinutes: number;    // time where speed < 0.5 m/s
}

// Calculate area covered from GPS track
// A mulcher with a 6-foot cutting head moving at 2 mph covers
// roughly 1.5 acres per hour. GPS track distance × swath width = area cleared.
function estimateAreaFromTrack(
  track: GPSTrack,
  swathWidthFeet: number = 6
): number {
  const swathWidthMeters = swathWidthFeet * 0.3048;
  const areaSqMeters = track.totalDistanceMeters * swathWidthMeters;
  const acres = areaSqMeters / 4046.86;
  return Math.round(acres * 100) / 100;
}
```

### Offline Mode (Critical for Hill Country)

Cell service in the Hill Country is spotty at best. The app must work offline.

**What works offline:**
- View the job map (map tiles pre-cached when on WiFi)
- Clock in/out and log hours (stored locally, syncs later)
- GPS tracking (runs natively, no network needed)
- Take and geotag photos (stored locally)
- View method instructions and job details
- Mark areas cleared on the map
- Log equipment hours
- View maintenance schedules

**What requires connectivity:**
- Syncing data to server (queues and syncs when signal returns)
- Drone image upload
- AI analysis
- PDF generation
- Real-time notifications

**Implementation:** Use a service worker with IndexedDB for local storage. When connectivity returns, a sync queue pushes all buffered data to Supabase. Conflict resolution: last write wins with timestamp, server data takes priority for financial records.

```typescript
// Offline sync queue
interface SyncQueueItem {
  id: string;
  action: 'create' | 'update';
  table: string;
  data: Record<string, any>;
  timestamp: number;
  retryCount: number;
  synced: boolean;
}

// On reconnect, flush the queue
async function syncOfflineData() {
  const queue = await localDB.getAll('sync_queue');
  const pending = queue.filter(item => !item.synced);
  
  for (const item of pending.sort((a, b) => a.timestamp - b.timestamp)) {
    try {
      await supabase.from(item.table).upsert(item.data);
      await localDB.put('sync_queue', { ...item, synced: true });
    } catch (err) {
      item.retryCount++;
      if (item.retryCount < 5) {
        await localDB.put('sync_queue', item);
      }
    }
  }
}
```

---

## 3. Job Execution and Work Orders

### Bid to Job Conversion

When a bid is accepted, it converts to a job with a single button press. All pasture data, clearing methods, and estimates carry over.

```typescript
interface Job {
  id: string;
  bidId: string;
  companyId: string;
  clientId: string;
  
  // Status lifecycle
  status: 'scheduled' | 'mobilizing' | 'in_progress' | 'paused' | 'punch_list' | 'completed' | 'invoiced';
  
  // Scheduling
  scheduledStartDate: string;
  actualStartDate: string | null;
  estimatedCompletionDate: string;
  actualCompletionDate: string | null;
  
  // Assignment
  crewLeadId: string;
  assignedOperators: string[];
  assignedEquipment: string[];  // equipment IDs
  
  // Financials
  contractAmount: number;
  changeOrders: ChangeOrder[];
  totalInvoiced: number;
  totalPaid: number;
  
  // Progress
  overallProgressPct: number;
  pastureProgress: PastureProgress[];
  
  // Logistics
  siteAccessNotes: string;  // gate codes, directions, restrictions
  clientContactOnSite: string;
  nearestFuelStation: string;
  waterSource: string;  // for dust/fire control
  mobilizationNotes: string;
}

interface PastureProgress {
  pastureId: string;
  pastureName: string;
  acreage: number;
  clearingMethod: string;
  status: 'not_started' | 'in_progress' | 'completed' | 'rework';
  progressPct: number;
  hoursLogged: number;
  estimatedHoursRemaining: number;
  startedDate: string | null;
  completedDate: string | null;
  operatorNotes: string;
}
```

### Work Order Per Pasture

Each pasture in a job generates a work order that the operator sees on their phone:

```typescript
interface WorkOrder {
  id: string;
  jobId: string;
  pastureId: string;
  pastureName: string;
  
  // What to do
  clearingMethod: string;
  methodInstructions: string;  // human readable
  vegetationType: string;
  protectedSpecies: string[];  // "Leave all live oaks, post oaks, and pecans"
  
  // Specifications
  stumpHeight: string;       // "Ground flush" or "6 inches max"
  mulchFineness: string;     // "Fine - multiple passes" or "Single pass rough"
  disposalMethod: string;    // "Mulch in place" or "Pile for burning at locations marked on map"
  burnPileLocations: GeoJSON.Point[];  // if applicable, marked on map
  
  // Boundaries
  polygon: GeoJSON.Polygon;
  bufferZones: BufferZone[];   // areas to avoid (septic, well, structures)
  fenceLinesToProtect: GeoJSON.LineString[];
  
  // Special instructions
  specialNotes: string;      // "Client says the big oak by the creek is a memorial tree, do not touch"
  hazards: string[];         // "Old barbed wire in NE corner", "Bee hive in large cedar cluster at south end"
  
  // AI data
  densityHeatmapUrl: string;
  estimatedTreeCount: number;
  dominantSoilSeries: string;
  terrainDifficulty: string;
  
  // Target
  estimatedHours: number;
  targetCompletionDate: string;
}
```

### Buffer Zones and Protection Areas

The map on the operator's phone should clearly show:

- **Red zones:** Do not clear. Septic fields, water wells, structures, memorial trees, endangered species habitat.
- **Blue zones:** Protected trees. Oaks, pecans, or whatever the customer specified.
- **Orange boundary:** Pasture edge. Stay inside this line.
- **Yellow lines:** Fence lines to protect. Don't drop trees on the fence.
- **Green shading:** Already cleared areas (from GPS tracks and manual marking).

```typescript
interface BufferZone {
  id: string;
  type: 'no_clear' | 'protected_trees' | 'fence_buffer' | 'structure_buffer' | 'utility_line';
  geometry: GeoJSON.Polygon | GeoJSON.LineString;
  bufferDistanceFeet: number;  // automatic buffer around the geometry
  label: string;  // "Water well - 50ft buffer"
  notes: string;
  markedBy: string;  // who set this zone
}
```

---

## 4. Time Tracking and Daily Logs

### Clock In/Out System

Simple as possible. The operator should not be fighting with the app while running heavy equipment.

```
[Clock In] → confirms job + pasture → starts timer and GPS tracking
[Break] → pauses timer, logs break start
[Resume] → resumes timer
[Clock Out] → stops timer, prompts for end-of-day log
```

### Time Entry Data

```typescript
interface TimeEntry {
  id: string;
  jobId: string;
  pastureId: string;
  operatorId: string;
  equipmentId: string;  // which machine they were running
  
  // Time
  clockIn: string;   // ISO timestamp
  clockOut: string;
  breaks: { start: string; end: string; reason: string }[];
  totalHours: number;
  activeHours: number;  // total minus breaks
  
  // GPS
  gpsTrackId: string;
  areasClearedAcres: number;  // from GPS track estimate
  
  // Categorization
  workType: 'clearing' | 'mobilization' | 'setup' | 'maintenance' | 'weather_delay' | 'rework' | 'other';
  
  // End of day log
  dailyLog: {
    acresCleared: number;      // operator estimate (cross check with GPS)
    conditionsNotes: string;   // "Hit a lot of rock in the NE section"
    equipmentIssues: string;   // "Mulcher teeth getting dull, need change tomorrow"
    weatherImpact: string;     // "Lost 2 hours to rain"
    photosCount: number;
    safetyIncidents: string;   // hopefully always empty
  };
  
  // Status
  approved: boolean;
  approvedBy: string;
  approvedAt: string;
}
```

### Daily Log Prompt

When the operator clocks out, the app asks 4 quick questions. These should be tappable selections, not text fields, because nobody wants to type paragraphs after running a mulcher for 10 hours.

```
End of Day Log — April 8, 2026

Acres cleared today?
[<5]  [5-10]  [10-15]  [15-20]  [20+]  [Custom: ___]

Any equipment issues?
[None]  [Minor]  [Needs attention tomorrow]  [Machine down]
Notes: ________________________________

Ground conditions?
[Normal]  [Rocky]  [Muddy]  [Steep sections]  [Very thick cedar]

Weather delays?
[None]  [<1 hour]  [1-2 hours]  [Half day]  [Full day lost]

[Add Photos]  [Submit Log]
```

### Crew Lead Approval

The owner or crew lead reviews and approves time entries daily. The approval screen shows:

- Who worked, how many hours
- GPS track overlay (did they actually cover ground or sit in one spot?)
- Acres cleared estimate vs GPS calculated estimate
- Equipment hours logged
- Any issues flagged

```
Daily Approval — Henderson Ranch — April 8

Jake Martinez    9.2 hrs    ~12 acres    CAT 299D3
  GPS track: ✓ consistent movement
  Notes: "Hit rock ledge NE corner, had to skip 2 acres"
  [Approve] [Edit] [Flag]

Carlos Ruiz      8.5 hrs    ~8 acres     Chainsaw crew
  Notes: "Cutting large cedars ahead of mulcher"
  Photos: 4 uploaded
  [Approve] [Edit] [Flag]

Equipment Summary:
  CAT 299D3: 9.2 engine hours (matches operator time ✓)
  Stihl MS 462: 8.5 hrs use logged

[Approve All]
```

---

## 5. Equipment Management

### Equipment Registry

Every piece of equipment gets a profile in the system.

```typescript
interface Equipment {
  id: string;
  companyId: string;
  
  // Identity
  name: string;           // "Big Red"
  unitNumber: string;     // "103"
  type: EquipmentType;
  make: string;           // "Caterpillar"
  model: string;          // "299D3"
  year: number;           // 2022
  serialNumber: string;
  vinOrPin: string;
  
  // Status
  status: 'available' | 'assigned' | 'maintenance' | 'down' | 'sold';
  currentJobId: string | null;
  currentLocation: { lat: number; lng: number } | null;
  
  // Hours
  totalEngineHours: number;
  hoursSinceLastService: number;
  nextServiceDueHours: number;
  nextServiceType: string;
  
  // Attachments (mulcher heads, grapples, etc.)
  currentAttachment: string | null;
  availableAttachments: Attachment[];
  
  // Financial
  purchaseDate: string;
  purchasePrice: number;
  estimatedValue: number;
  monthlyPayment: number | null;  // if financed
  insurancePolicyNumber: string;
  
  // Documents
  registrationExpiry: string;
  insuranceExpiry: string;
  lastInspectionDate: string;
  manualUrl: string;
  
  // Operating costs (for job costing)
  fuelCostPerHour: number;      // estimated
  maintenanceCostPerHour: number; // running average
  depreciationPerHour: number;
  totalCostPerHour: number;      // sum of above = true operating cost
}

type EquipmentType = 
  | 'skid_steer'
  | 'compact_track_loader'
  | 'excavator'
  | 'dozer'
  | 'forestry_mulcher_head'
  | 'grapple_attachment'
  | 'chainsaw'
  | 'truck'
  | 'trailer'
  | 'dump_trailer'
  | 'fuel_trailer'
  | 'drone'
  | 'other';

interface Attachment {
  id: string;
  name: string;        // "FAE UML/SSL 150"
  type: string;        // "forestry_mulcher_head"
  make: string;
  model: string;
  compatibleEquipment: string[];  // equipment IDs it fits on
  totalHours: number;
  lastTeethChange: number;  // hours
  teethChangeInterval: number;
  status: 'available' | 'installed' | 'maintenance';
}
```

### Maintenance Tracking

```typescript
interface MaintenanceRecord {
  id: string;
  equipmentId: string;
  
  // Type
  type: 'scheduled' | 'unscheduled' | 'repair' | 'inspection' | 'teeth_change';
  category: string;  // 'oil_change', 'hydraulic_filter', 'teeth', 'tracks', 'engine', 'electrical', etc.
  
  // Details
  description: string;
  engineHoursAtService: number;
  date: string;
  performedBy: string;  // operator name or shop name
  location: string;     // 'field' or 'shop' or shop name
  
  // Costs
  partsCost: number;
  laborCost: number;
  totalCost: number;
  partsUsed: { name: string; partNumber: string; quantity: number; cost: number }[];
  
  // Downtime
  downtimeHours: number;
  jobImpacted: string | null;  // was a job delayed because of this?
  
  // Follow up
  nextServiceDue: number;  // engine hours
  nextServiceType: string;
  notes: string;
  photos: string[];  // before/after of repair
  receiptUrl: string;
}
```

### Maintenance Schedule Engine

Predefined service intervals per equipment type. The app automatically alerts when service is due.

```typescript
interface MaintenanceSchedule {
  equipmentType: EquipmentType;
  intervals: {
    name: string;
    category: string;
    intervalHours: number;
    estimatedCost: number;
    estimatedDowntimeHours: number;
    parts: string[];
    canDoInField: boolean;
  }[];
}

// Example for a CAT compact track loader
const CTL_SCHEDULE: MaintenanceSchedule = {
  equipmentType: 'compact_track_loader',
  intervals: [
    {
      name: 'Daily inspection',
      category: 'inspection',
      intervalHours: 10,  // every day
      estimatedCost: 0,
      estimatedDowntimeHours: 0.25,
      parts: [],
      canDoInField: true,
    },
    {
      name: 'Engine oil and filter',
      category: 'oil_change',
      intervalHours: 500,
      estimatedCost: 120,
      estimatedDowntimeHours: 1,
      parts: ['Oil filter', '10W-30 oil (2.5 gal)'],
      canDoInField: true,
    },
    {
      name: 'Hydraulic oil filter',
      category: 'hydraulic_filter',
      intervalHours: 500,
      estimatedCost: 85,
      estimatedDowntimeHours: 0.5,
      parts: ['Hydraulic filter'],
      canDoInField: true,
    },
    {
      name: 'Mulcher teeth change',
      category: 'teeth',
      intervalHours: 150,  // varies wildly by terrain. Rocky Hill Country = 80-100 hrs
      estimatedCost: 450,
      estimatedDowntimeHours: 2,
      parts: ['Mulcher teeth set (24-32 teeth)'],
      canDoInField: true,
    },
    {
      name: 'Track tension and inspection',
      category: 'tracks',
      intervalHours: 250,
      estimatedCost: 0,
      estimatedDowntimeHours: 0.5,
      parts: [],
      canDoInField: true,
    },
    {
      name: 'Full service (dealer)',
      category: 'full_service',
      intervalHours: 2000,
      estimatedCost: 2500,
      estimatedDowntimeHours: 16,
      parts: ['Various'],
      canDoInField: false,
    },
  ],
};
```

### Mulcher Teeth Tracking (Industry Specific)

Mulcher teeth are a major consumable cost for clearing companies. In rocky Hill Country soil, a set of teeth might last 80 to 100 hours instead of the rated 150. Tracking teeth life by soil type and terrain is valuable data.

```typescript
interface TeethChangeRecord {
  id: string;
  equipmentId: string;
  attachmentId: string;  // mulcher head
  
  changedAt: string;
  engineHoursAtChange: number;
  hoursSinceLastChange: number;
  
  // Context (for predicting teeth life by terrain)
  jobId: string;
  dominantSoilSeries: string;  // from soil data
  rockFragmentPct: number;
  terrainClass: string;
  vegetationType: string;
  
  // Costs
  teethCount: number;
  costPerTooth: number;
  totalCost: number;
  brand: string;
  partNumber: string;
  
  // Condition assessment
  wearLevel: 'normal' | 'excessive' | 'broken_teeth' | 'rock_damage';
  notes: string;
  photo: string;
}

// Over time, build a model: teeth life = f(soil type, rock %)
// Tarrant series with 50%+ rock: ~80 hours per set
// Krum series with <5% rock: ~200 hours per set
// This feeds into job costing for accurate consumable cost per acre
```

### Equipment Dashboard

```
EQUIPMENT FLEET

Unit #103 — CAT 299D3 XE
  Status: In use — Henderson Ranch
  Hours: 4,287 total | 312 since last service
  Next service: Oil/filter in 188 hours
  Attachment: FAE UML/SSL 150 (teeth changed 62 hrs ago)
  Monthly cost: $2,847 (payment $1,800 + maintenance $647 + fuel $400)
  $/hour all-in: $18.40

Unit #105 — CAT 289D3
  Status: Available
  Hours: 2,103 total | 87 since last service
  Next service: Teeth change in ~40 hours ⚠️
  Attachment: Bradco MM60
  Monthly cost: $1,950

Unit #201 — Ford F-350 + gooseneck
  Status: Assigned — Henderson Ranch
  Miles: 87,400
  Next service: Oil change in 1,200 miles
  Registration expires: June 2026
  Insurance expires: Sep 2026

ALERTS
  ⚠️ Unit #105: Teeth change due soon (~40 hrs remaining)
  ⚠️ Unit #201: Registration renewal due in 2 months
  ✓ All insurance current
```

---

## 6. Scheduling and Dispatch

### Calendar View

A visual calendar showing job blocks, equipment assignments, and crew schedules.

```typescript
interface ScheduleBlock {
  id: string;
  jobId: string;
  clientName: string;
  propertyName: string;
  
  startDate: string;
  endDate: string;
  estimatedDays: number;
  
  assignedCrew: string[];
  assignedEquipment: string[];
  
  status: 'scheduled' | 'in_progress' | 'completed';
  priority: 'normal' | 'rush' | 'flexible';
  
  // Constraints
  accessRestrictions: string;  // "No work on Sundays", "Gate locked before 7am"
  weatherSensitive: boolean;   // pause if rain
  burnPermitWindow: string;    // if burning, when is the permit valid
  seasonalNote: string;        // "Nesting season, no clearing near creek April-June"
}
```

### Scheduling UI

```
APRIL 2026
Mo Tu We Th Fr Sa Su
       1  2  3  4  5
 6  7  8  9 10 11 12
13 14 15 16 17 18 19
20 21 22 23 24 25 26
27 28 29 30

Jobs:
████████████████░░░░  Henderson Ranch (Apr 1-18, 67%)
        ░░░░░░░░░░░░  Williams Ranch (Apr 8-22, scheduled)
                ░░░░░  TX DOT ROW (Apr 21-25, scheduled)

Equipment:
#103 CAT 299D3:   Henderson ───────────> Williams ──────>
#105 CAT 289D3:   Available ──> Henderson (Apr 8) ──────>
#201 F-350:       Henderson ───────────> Williams ──────>

Crew:
Jake M:           Henderson ───────────> Williams ──────>
Carlos R:         Henderson ───────────> TX DOT ────────>
New hire:         Training ──> Henderson (Apr 14) ──────>
```

### Conflict Detection

The scheduler should flag:
- Equipment double booked
- Crew member assigned to two jobs on same day
- Job scheduled during burn ban period
- Equipment maintenance due during scheduled job (will it last?)
- Jobs scheduled back to back with no mobilization day between them

### Weather Integration

Pull weather forecast for the job site and auto-flag days with >50% rain chance. Cedar clearing in the Hill Country shuts down when it's wet because equipment bogs in clay soil and steep slopes become dangerous.

```typescript
// Simple weather check (use OpenWeather or WeatherAPI)
async function checkWeatherForJob(job: Job): Promise<WeatherForecast[]> {
  const center = job.propertyCenter;
  const forecast = await fetch(
    `https://api.weatherapi.com/v1/forecast.json?key=${KEY}&q=${center.lat},${center.lng}&days=7`
  );
  const data = await forecast.json();
  
  return data.forecast.forecastday.map(day => ({
    date: day.date,
    rainChancePct: day.day.daily_chance_of_rain,
    maxWindMph: day.day.maxwind_mph,
    condition: day.day.condition.text,
    workable: day.day.daily_chance_of_rain < 50 && day.day.maxwind_mph < 25,
  }));
}
```

---

## 7. Customer Management and CRM

### Customer Profiles

```typescript
interface Customer {
  id: string;
  companyId: string;
  
  // Contact
  name: string;
  email: string;
  phone: string;
  address: string;
  
  // Properties (a customer can have multiple ranches)
  properties: Property[];
  
  // History
  totalBids: number;
  totalJobs: number;
  totalRevenue: number;
  averageJobSize: number;
  winRate: number;  // bids accepted / bids sent
  lastContactDate: string;
  
  // Preferences
  preferredClearingMethod: string;
  preferredContactMethod: 'phone' | 'email' | 'text';
  paymentTerms: string;  // 'net_30', 'deposit_50', 'on_completion'
  notes: string;
  
  // Referral tracking
  referredBy: string;
  referralsGiven: string[];
  
  // Tags
  tags: string[];  // 'repeat_customer', 'slow_payer', 'large_ranch', 'hunting_lease'
}

interface Property {
  id: string;
  customerId: string;
  name: string;        // "Henderson Ranch"
  address: string;
  totalAcres: number;
  gateCode: string;
  accessNotes: string;  // "Enter from FM 1340, second gate on left past the cattle guard"
  center: { lat: number; lng: number };
  boundary: GeoJSON.Polygon | null;  // property boundary if known
  soilSummary: string;
  terrainNotes: string;
  previousJobs: string[];  // job IDs
}
```

### Customer Communication Log

Every interaction gets logged: calls, emails, texts, site visits. This builds a timeline the owner can reference before calling a customer back.

```typescript
interface ContactLog {
  id: string;
  customerId: string;
  type: 'phone_call' | 'email' | 'text' | 'site_visit' | 'bid_sent' | 'invoice_sent' | 'payment_received';
  date: string;
  summary: string;
  followUpDate: string | null;
  followUpAction: string | null;
  loggedBy: string;
}
```

---

## 8. Invoicing and Financials

### Invoice Generation

When a job is completed (or at progress milestones for large jobs), generate an invoice from the job data.

```typescript
interface Invoice {
  id: string;
  invoiceNumber: string;  // "CCC-INV-2026-0087"
  jobId: string;
  customerId: string;
  
  // Line items (pulled from job/bid, can be modified)
  lineItems: InvoiceLineItem[];
  
  // Change orders (work added/removed during the job)
  changeOrders: ChangeOrder[];
  
  // Financials
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  depositPaid: number;
  amountDue: number;
  
  // Terms
  paymentTerms: string;  // "Net 30"
  dueDate: string;
  
  // Status
  status: 'draft' | 'sent' | 'viewed' | 'partial_payment' | 'paid' | 'overdue';
  sentAt: string | null;
  paidAt: string | null;
  paidAmount: number;
  paymentMethod: string;
  
  // PDF
  pdfUrl: string;
}

interface ChangeOrder {
  id: string;
  jobId: string;
  description: string;  // "Customer requested additional 12 acres on south side"
  amount: number;        // positive = addition, negative = credit
  approvedByCustomer: boolean;
  approvedDate: string;
  signatureUrl: string;  // customer signature on phone
}
```

### Job Profitability Analysis

This is where the data really shines. After every job, the system can calculate true profitability:

```typescript
interface JobProfitability {
  jobId: string;
  
  // Revenue
  contractAmount: number;
  changeOrders: number;
  totalRevenue: number;
  
  // Direct costs
  laborCost: number;          // hours × crew rate
  fuelCost: number;           // estimated from equipment hours
  equipmentCost: number;      // hours × equipment cost/hour
  teethAndConsumables: number;
  subcontractorCost: number;
  mobilizationCost: number;
  permitCost: number;
  totalDirectCost: number;
  
  // Metrics
  grossProfit: number;
  grossMarginPct: number;
  revenuePerAcre: number;
  costPerAcre: number;
  profitPerAcre: number;
  profitPerHour: number;
  
  // Comparison to bid
  bidAmount: number;
  actualVsBidPct: number;  // >100% = over budget, <100% = under budget
  
  // Breakdown by pasture
  pastureBreakdowns: {
    pastureName: string;
    acreage: number;
    revenue: number;
    cost: number;
    profit: number;
    hoursEstimated: number;
    hoursActual: number;
    accuracyPct: number;
  }[];
}
```

### QuickBooks / Accounting Integration (Phase 2)

Eventually export invoices and expenses to QuickBooks Online. Use the QuickBooks API:

- Push invoices as QB invoices
- Push equipment expenses as QB expenses
- Pull payment status back to the app
- Sync customer records

This is a Phase 12+ feature. For now, export to CSV or PDF is sufficient.

---

## 9. Reporting and Analytics Dashboard

### Owner Dashboard

The owner opens the app on their iPad and sees the business at a glance:

```
CACTUS CREEK CLEARING — DASHBOARD
April 2026

ACTIVE JOBS: 2          BIDS PENDING: 4
Revenue MTD: $47,200    Pipeline: $128,500
Hours MTD: 312          Bid Win Rate: 62%

JOB PERFORMANCE (last 30 days)
  Avg profit margin: 38.2%
  Avg bid accuracy: 84% (predicted vs actual hours)
  Best performing method: Rough Mulch (42% margin)
  Worst performing: Fine Mulch (28% margin, takes longer than estimated)

EQUIPMENT UTILIZATION
  #103 CAT 299D3:  87% utilized this month
  #105 CAT 289D3:  62% utilized
  #201 F-350:      91% utilized

ALERTS
  ⚠️ Williams Ranch bid expires in 3 days
  ⚠️ Unit #105 teeth change overdue by 12 hours
  ✓ Henderson Ranch on schedule (67% complete, day 8 of 12)
  ✓ All invoices current, no overdue
```

### Key Reports

1. **Revenue by month/quarter/year** with trend line
2. **Profit per acre by clearing method** (which methods are most profitable?)
3. **Profit per acre by soil type** (are rocky jobs priced correctly?)
4. **Bid accuracy over time** (is the AI getting better?)
5. **Equipment cost per hour** (is it cheaper to rent or own a second mulcher?)
6. **Crew productivity** (acres per hour per operator, not for punishment but for calibration)
7. **Customer lifetime value** (who are the best repeat customers?)
8. **Pipeline forecast** (pending bids × win rate = expected revenue)
9. **Teeth life by soil series** (when to budget for teeth changes per job)
10. **Seasonal trends** (which months are busiest? when to hire seasonal help?)

---

## 10. Notifications and Communication

### Push Notifications (Mobile)

| Event | Who Gets Notified | Priority |
|-------|-------------------|----------|
| New bid request | Owner | High |
| Bid accepted by customer | Owner, crew lead | High |
| Job starts tomorrow | Assigned crew | Medium |
| Equipment maintenance due | Operator, owner | Medium |
| Weather alert for active job | Crew on site | High |
| Customer viewed bid PDF | Owner | Low |
| Invoice overdue | Owner | High |
| Daily time entries need approval | Owner/crew lead | Medium |
| Pasture marked complete | Owner | Low |
| AI analysis complete | Bid creator | Medium |
| Drone processing complete | Uploader | Medium |

### Customer Notifications

Keep the customer in the loop without the owner having to remember to call:

- **Bid sent:** "Your clearing proposal for [property] is ready. [View PDF]"
- **Job scheduled:** "Your clearing project is scheduled to begin [date]. [View details]"
- **Work started:** "Crews are on site at [property] today."
- **Progress update:** "Your project is [X]% complete. [View progress report]" (weekly auto-send)
- **Job completed:** "Your clearing project is complete! [View final report + photos]"
- **Invoice sent:** "Invoice #[number] for [amount] is ready. [View/Pay]"

These can be SMS (via Twilio), email (via Resend), or both based on customer preference.

---

## 11. Technical Architecture for Mobile

### PWA vs Native App

**Recommendation: PWA (Progressive Web App) first, native later if needed.**

PWA advantages for this use case:
- Single codebase (same Next.js app, responsive)
- No App Store review process or fees
- Instant updates (no waiting for users to update)
- Offline support via service workers
- GPS, camera, and push notification access
- Home screen install on iOS and Android

Where PWA falls short:
- Background GPS tracking is less reliable than native (but workable)
- Push notifications on iOS require iOS 16.4+ (not an issue in 2026)
- No access to Bluetooth (for equipment OBD sensors, future feature)

If native becomes necessary (for better background GPS or Bluetooth equipment monitoring), build with React Native or Expo. The same component library and state management patterns transfer directly.

### PWA Configuration

```javascript
// next.config.js — PWA setup with next-pwa
const withPWA = require('next-pwa')({
  dest: 'public',
  register: true,
  skipWaiting: true,
  runtimeCaching: [
    {
      // Cache map tiles for offline use
      urlPattern: /^https:\/\/api\.mapbox\.com\/.*$/,
      handler: 'CacheFirst',
      options: {
        cacheName: 'mapbox-tiles',
        expiration: { maxEntries: 500, maxAgeSeconds: 7 * 24 * 60 * 60 },
      },
    },
    {
      // Cache API responses
      urlPattern: /^\/api\/.*$/,
      handler: 'NetworkFirst',
      options: {
        cacheName: 'api-responses',
        expiration: { maxEntries: 100, maxAgeSeconds: 24 * 60 * 60 },
      },
    },
  ],
});
```

### Responsive Layout Strategy

| Screen | Desktop | Tablet | Phone |
|--------|---------|--------|-------|
| Bid editor | Full map + side panel | Map top, panel bottom | Map full screen, swipe up for panel |
| Operator field view | N/A | Map with overlay controls | Map full screen, floating controls |
| Dashboard | Multi-column grid | 2-column grid | Single column stack |
| Schedule | Full calendar | Week view | Day view with swipe |
| Equipment list | Table view | Card grid | Card stack |

---

## 12. Data Model Expansion

### New Tables for Operations

```sql
-- Jobs (bid conversion)
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id UUID REFERENCES bids(id) UNIQUE,
  company_id UUID REFERENCES companies(id),
  client_id UUID REFERENCES clients(id),
  status TEXT DEFAULT 'scheduled',
  priority TEXT DEFAULT 'normal',
  scheduled_start DATE,
  actual_start DATE,
  estimated_completion DATE,
  actual_completion DATE,
  crew_lead_id UUID REFERENCES users(id),
  assigned_operators UUID[],
  assigned_equipment UUID[],
  contract_amount NUMERIC(12,2),
  overall_progress_pct REAL DEFAULT 0,
  site_access_notes TEXT,
  client_contact_onsite TEXT,
  mobilization_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Work orders (per pasture within a job)
CREATE TABLE work_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
  pasture_id UUID REFERENCES pastures(id),
  clearing_method TEXT NOT NULL,
  method_instructions TEXT,
  protected_species TEXT[],
  stump_treatment TEXT,
  disposal_method TEXT,
  special_notes TEXT,
  hazards TEXT[],
  buffer_zones JSONB DEFAULT '[]',
  status TEXT DEFAULT 'not_started',
  progress_pct REAL DEFAULT 0,
  started_date DATE,
  completed_date DATE,
  estimated_hours REAL,
  actual_hours REAL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Time entries
CREATE TABLE time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES jobs(id),
  work_order_id UUID REFERENCES work_orders(id),
  operator_id UUID REFERENCES users(id),
  equipment_id UUID REFERENCES equipment(id),
  clock_in TIMESTAMPTZ NOT NULL,
  clock_out TIMESTAMPTZ,
  breaks JSONB DEFAULT '[]',
  total_hours REAL,
  active_hours REAL,
  work_type TEXT DEFAULT 'clearing',
  gps_track_id UUID,
  areas_cleared_acres REAL,
  daily_log JSONB,
  approved BOOLEAN DEFAULT false,
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  synced_from_offline BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- GPS tracks
CREATE TABLE gps_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  time_entry_id UUID REFERENCES time_entries(id),
  operator_id UUID REFERENCES users(id),
  job_id UUID REFERENCES jobs(id),
  date DATE NOT NULL,
  points JSONB NOT NULL,  -- array of {lat, lng, timestamp, speed, accuracy}
  total_distance_meters REAL,
  active_minutes REAL,
  idle_minutes REAL,
  estimated_area_cleared_acres REAL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Equipment
CREATE TABLE equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  name TEXT NOT NULL,
  unit_number TEXT,
  type TEXT NOT NULL,
  make TEXT,
  model TEXT,
  year INT,
  serial_number TEXT,
  status TEXT DEFAULT 'available',
  current_job_id UUID REFERENCES jobs(id),
  total_engine_hours REAL DEFAULT 0,
  hours_since_last_service REAL DEFAULT 0,
  next_service_due_hours REAL,
  next_service_type TEXT,
  current_attachment TEXT,
  purchase_date DATE,
  purchase_price NUMERIC(12,2),
  monthly_payment NUMERIC(10,2),
  fuel_cost_per_hour NUMERIC(6,2),
  maintenance_cost_per_hour NUMERIC(6,2),
  insurance_policy TEXT,
  insurance_expiry DATE,
  registration_expiry DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Attachments (mulcher heads, grapples, etc.)
CREATE TABLE attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  make TEXT,
  model TEXT,
  compatible_equipment UUID[],
  total_hours REAL DEFAULT 0,
  status TEXT DEFAULT 'available',
  installed_on UUID REFERENCES equipment(id),
  last_teeth_change_hours REAL,
  teeth_change_interval REAL DEFAULT 150,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Maintenance records
CREATE TABLE maintenance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id UUID REFERENCES equipment(id),
  attachment_id UUID REFERENCES attachments(id),
  type TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  engine_hours_at_service REAL,
  date DATE NOT NULL,
  performed_by TEXT,
  location TEXT,
  parts_cost NUMERIC(10,2) DEFAULT 0,
  labor_cost NUMERIC(10,2) DEFAULT 0,
  total_cost NUMERIC(10,2) DEFAULT 0,
  parts_used JSONB DEFAULT '[]',
  downtime_hours REAL DEFAULT 0,
  job_impacted UUID REFERENCES jobs(id),
  next_service_due_hours REAL,
  next_service_type TEXT,
  notes TEXT,
  photos TEXT[],
  receipt_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Teeth change records (specialized tracking)
CREATE TABLE teeth_change_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  maintenance_record_id UUID REFERENCES maintenance_records(id),
  equipment_id UUID REFERENCES equipment(id),
  attachment_id UUID REFERENCES attachments(id),
  hours_since_last_change REAL,
  job_id UUID REFERENCES jobs(id),
  soil_series TEXT,
  rock_fragment_pct REAL,
  terrain_class TEXT,
  teeth_count INT,
  cost_per_tooth NUMERIC(6,2),
  total_cost NUMERIC(8,2),
  brand TEXT,
  wear_level TEXT,
  notes TEXT,
  photo TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Invoices
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  job_id UUID REFERENCES jobs(id),
  client_id UUID REFERENCES clients(id),
  invoice_number TEXT NOT NULL,
  line_items JSONB NOT NULL,
  change_orders JSONB DEFAULT '[]',
  subtotal NUMERIC(12,2),
  tax_rate REAL DEFAULT 0,
  tax_amount NUMERIC(10,2) DEFAULT 0,
  total NUMERIC(12,2),
  deposit_paid NUMERIC(10,2) DEFAULT 0,
  amount_due NUMERIC(12,2),
  payment_terms TEXT,
  due_date DATE,
  status TEXT DEFAULT 'draft',
  sent_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  paid_amount NUMERIC(12,2) DEFAULT 0,
  payment_method TEXT,
  pdf_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Change orders
CREATE TABLE change_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES jobs(id),
  description TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  approved_by_customer BOOLEAN DEFAULT false,
  approved_date DATE,
  signature_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Customer properties
CREATE TABLE properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id),
  name TEXT NOT NULL,
  address TEXT,
  total_acres REAL,
  gate_code TEXT,
  access_notes TEXT,
  center JSONB,
  boundary JSONB,
  soil_summary TEXT,
  terrain_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Contact log (CRM)
CREATE TABLE contact_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id),
  type TEXT NOT NULL,
  date TIMESTAMPTZ NOT NULL,
  summary TEXT,
  follow_up_date DATE,
  follow_up_action TEXT,
  logged_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Notifications
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  data JSONB,
  read BOOLEAN DEFAULT false,
  sent_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_jobs_company ON jobs(company_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_work_orders_job ON work_orders(job_id);
CREATE INDEX idx_time_entries_job ON time_entries(job_id);
CREATE INDEX idx_time_entries_operator ON time_entries(operator_id);
CREATE INDEX idx_time_entries_date ON time_entries(clock_in);
CREATE INDEX idx_gps_tracks_job ON gps_tracks(job_id);
CREATE INDEX idx_equipment_company ON equipment(company_id);
CREATE INDEX idx_equipment_status ON equipment(status);
CREATE INDEX idx_maintenance_equipment ON maintenance_records(equipment_id);
CREATE INDEX idx_invoices_job ON invoices(job_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_contact_log_client ON contact_log(client_id);
CREATE INDEX idx_notifications_user ON notifications(user_id, read);
```

---

## 13. Revised Build Phases

### Updated Phase Map

The operations features thread into the existing phases rather than being a separate block at the end. The operator needs the field app as soon as jobs start.

| Phase | Feature | Weeks | Notes |
|-------|---------|-------|-------|
| 1 | Map + polygons + basic bid calc | 2 to 3 | Foundation |
| 2 | Soil integration (UC Davis + SDA) | 1 to 2 | Free data |
| 3 | Clearing method matrix + multi-option bids | 1 to 2 | Business logic, no tech risk |
| 4 | PDF generation (bid + multi-option) | 1 to 2 | Sellable product |
| 5 | **Customer CRM + properties** | 1 to 2 | Store customer data, property access notes |
| 6 | **Job creation + work orders** | 1 to 2 | Bid to job conversion |
| 7 | **Operator field app (mobile)** | 2 to 3 | Map view, work orders, clock in/out |
| 8 | **Time tracking + GPS** | 1 to 2 | Hours logging, GPS breadcrumb |
| 9 | **Equipment registry + maintenance** | 2 to 3 | Fleet management, service alerts |
| 10 | Satellite AI density analysis | 3 to 4 | NDVI rules first |
| 11 | **Scheduling + dispatch calendar** | 2 to 3 | Visual schedule, conflict detection |
| 12 | Drone upload + photogrammetry | 3 to 4 | Biggest accuracy jump |
| 13 | 3D visualization | 2 to 3 | Wow factor |
| 14 | Feedback loop + self-improvement | 2 to 3 | System starts learning |
| 15 | **Invoicing + job profitability** | 2 to 3 | Close the financial loop |
| 16 | Progress tracking + customer reports | 2 to 3 | Retention engine |
| 17 | **Reporting + analytics dashboard** | 2 to 3 | Owner visibility |
| 18 | ML model (Roboflow) | 4 to 8 | After enough training data |
| 19 | **Notifications + customer comms** | 1 to 2 | SMS/email automation |
| 20 | Polish, integrations, QB export | Ongoing | Ongoing refinement |

### Realistic Timeline

**MVP (Phases 1 to 4): 6 to 8 weeks**
Working bid tool with soil data, clearing methods, and professional PDFs. CCC can start using this immediately.

**Operations Core (Phases 5 to 9): 8 to 12 weeks**
Adds the field app, time tracking, and equipment management. This is when it becomes a daily-use tool instead of a bid-day tool.

**Intelligence Layer (Phases 10 to 14): 10 to 14 weeks**
Satellite AI, drone integration, 3D viz, and the feedback loop. This is the competitive moat.

**Business Management (Phases 15 to 20): 8 to 12 weeks**
Invoicing, reporting, customer comms. This is what makes it a full business platform.

**Total to feature complete: 8 to 12 months** with continuous delivery. CCC is using the tool from week 6 forward and providing feedback that shapes every subsequent phase.

---

## 14. What This Replaces

If CCC is like most small clearing companies, they're currently using some combination of:

| Current Tool | Replaced By | Annual Cost Saved |
|-------------|-------------|-------------------|
| Paper bids or Word templates | Bid engine + PDF | Time savings |
| Google Maps for site planning | Mapbox satellite + AI | Time + accuracy |
| Handwritten time sheets | Mobile time tracking + GPS | $0 direct, huge accuracy gain |
| Text messages for scheduling | Scheduling + dispatch | Missed job reduction |
| Spreadsheet for equipment hours | Equipment management | Maintenance cost reduction |
| QuickBooks alone for invoicing | Integrated invoicing | Time + accuracy |
| Memory/notebook for customer info | CRM | Never forget a follow up |
| Gut feel for pricing | AI + feedback loop | 20 to 40% bid accuracy improvement |
| Nothing for progress tracking | Drone progress reports | Customer satisfaction + referrals |

The pitch to CCC: "This replaces your paper bids, your time sheets, your equipment spreadsheet, your scheduling texts, and your gut-feel pricing. Everything your company does lives in one place, and it gets smarter every month."

---

*End of operations addendum. The field operator mobile app (Phase 7) is the piece that makes this a daily-use tool instead of a bid-day tool. Once operators are clocking in and out through the app every day, the data flywheel spins on its own.*
