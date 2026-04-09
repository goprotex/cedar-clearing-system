# Cactus Creek Clearing — Master Plan

**Platform:** AI-Powered Clearing Company Operating System  
**Client:** Cactus Creek Clearing, Kerrville TX  
**Version:** 3.0 Consolidated  
**Date:** April 2026  

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Platform Architecture](#2-platform-architecture)
3. [System 1 — Map and Drawing Engine](#3-system-1--map-and-drawing-engine)
4. [System 2 — Multi-Source Satellite Imagery](#4-system-2--multi-source-satellite-imagery)
5. [System 3 — AI Cedar Detection Pipeline](#5-system-3--ai-cedar-detection-pipeline)
6. [System 4 — Soil Data Integration](#6-system-4--soil-data-integration)
7. [System 5 — Drone Photogrammetry](#7-system-5--drone-photogrammetry)
8. [System 6 — Equipment Telematics and GPS](#8-system-6--equipment-telematics-and-gps)
9. [System 7 — Bid Engine and Clearing Methods](#9-system-7--bid-engine-and-clearing-methods)
10. [System 8 — 3D Terrain and Tree Visualization](#10-system-8--3d-terrain-and-tree-visualization)
11. [System 9 — Field Operator Mobile App](#11-system-9--field-operator-mobile-app)
12. [System 10 — Equipment Management](#12-system-10--equipment-management)
13. [System 11 — Scheduling and Dispatch](#13-system-11--scheduling-and-dispatch)
14. [System 12 — Self-Improving Feedback Loop](#14-system-12--self-improving-feedback-loop)
15. [System 13 — Progress Tracking and Customer Reports](#15-system-13--progress-tracking-and-customer-reports)
16. [System 14 — Business Management](#16-system-14--business-management)
17. [System 15 — PDF Generation](#17-system-15--pdf-generation)
18. [Complete Data Model](#18-complete-data-model)
19. [Tech Stack and Infrastructure](#19-tech-stack-and-infrastructure)
20. [Development Phases](#20-development-phases)
21. [Open Questions for CCC](#21-open-questions-for-ccc)
22. [Appendices](#22-appendices)

---

## 1. Executive Summary

### What This Is

A full clearing company operating system that manages every step from first customer call to final invoice. The operator draws pasture polygons on a satellite map. The system automatically pulls imagery from 3 to 5 satellite sources, runs AI analysis to detect cedar density, queries USDA and UC Davis soil databases, renders a 3D "god's eye" visualization, calculates a bid using learned historical performance, and generates a professional PDF. After each job, actual performance data feeds back to improve future predictions.

Beyond bidding, the platform manages field operations (mobile app with live map, GPS tracking, time logging), equipment (telematics integration, maintenance schedules, cost tracking), scheduling, invoicing, customer management, and business analytics.

### Why This Is a Competitive Weapon

Most clearing companies bid with a truck drive-by and a gut number. This system provides satellite-verified density analysis, soil-aware pricing, historical calibration, 3D visualization, and equipment-level GPS tracking that calculates cleared area automatically. After 6 to 12 months of feedback data, bid accuracy should reach within 10 to 15% of actual job cost, far beyond what any competitor can match.

### The Data Flywheel

Every action generates data that makes the next action smarter:

```
Draw polygon → AI density analysis → soil difficulty → bid price
                                                         ↓
                                                    Job execution
                                                         ↓
                                        Equipment GPS tracks area cleared
                                        Operator logs hours/conditions
                                        Drone progress flyovers
                                                         ↓
                                        Compare predicted vs actual
                                                         ↓
                                        Retrain prediction model
                                                         ↓
                                        Next bid is more accurate
```

---

## 2. Platform Architecture

### Full System Flow

```
SALES                    OPERATIONS                  BACK OFFICE
─────                    ──────────                  ───────────
Lead comes in            Schedule job                Invoice customer
Draw polygons            Assign crew + equipment     Track payment
AI analyzes density      Operators open phone app    Revenue reporting
Soil data auto-fills     See map: what to clear,     Equipment cost tracking
Generate bid PDF           where, what method        Profit per job analysis
Customer picks option    Equipment GPS auto-tracks   Tax prep exports
Bid accepted → Job       Log hours per pasture
                         Drone progress flyover
                         Customer progress report
                         Mark pasture complete
                         Post-job review → AI learns
```

### Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | Next.js 14+ (App Router) | SSR, React, file routing |
| Map | Mapbox GL JS + @mapbox/mapbox-gl-draw | Satellite view, polygon drawing, 3D terrain |
| 3D Engine | Mapbox GL JS 3D terrain + Three.js (Threebox) | God's eye view with modeled trees |
| Geo Math | Turf.js | Acreage, centroid, bounding box |
| AI Vision | Python FastAPI microservice | NDVI analysis, cedar detection, tree counting |
| Drone Processing | NodeODM (self-hosted) or WebODM Lightning | Photogrammetry: orthomosaics, elevation models |
| Equipment Telematics | AEMP 2.0 / ISO 15143-3 API | Machine GPS, engine hours, fuel, fault codes |
| Soil APIs | UC Davis SoilWeb + USDA SDA REST | Soil series, slope, rock %, drainage |
| Satellite Sources | NAIP (0.6m), Sentinel-2 (10m), Mapbox | Multi-source vegetation analysis |
| Elevation | USGS 3DEP + Mapbox Terrain DEM | Slope analysis, 3D terrain mesh |
| State | Zustand | Lightweight client state |
| Styling | Tailwind CSS + shadcn/ui | Professional UI |
| PDF | Puppeteer (server side) | Full CSS control, map screenshots |
| Database | Supabase (Postgres + Auth + Storage) | Everything: bids, jobs, equipment, feedback |
| Hosting | Vercel (frontend) + Railway (AI + ODM) | Split compute for ML workloads |
| Notifications | Twilio (SMS) + Resend (email) | Customer and crew communication |

### Folder Structure

```
/app
  /api
    /soil           — UC Davis + SDA proxy
    /imagery        — Satellite fetch proxy
    /analyze        — AI analysis trigger
    /telematics     — Equipment GPS/data polling
    /pdf            — PDF generation
    /bids           — Bid CRUD
    /jobs           — Job management
    /time           — Time entry CRUD
    /equipment      — Equipment + maintenance
  /bid/[id]         — Bid editor (map + rate engine)
  /bids             — Bid list dashboard
  /job/[id]         — Job detail + progress
  /jobs             — Job list
  /field            — Operator field view (mobile optimized)
  /equipment        — Equipment fleet management
  /schedule         — Calendar + dispatch
  /customers        — CRM
  /analytics        — Business dashboard
  /settings         — Rate card, company info, integrations
/components
  /map              — MapContainer, DrawControls, SoilOverlay, DensityHeatmap
  /bid              — PastureCard, RateTable, MethodSelector, BidSummary
  /job              — WorkOrder, ProgressBar, TimeEntry
  /equipment        — EquipmentCard, MaintenanceLog, TelematicsMap
  /pdf              — PDFLayout, PDFHeader, PDFMap
  /ui               — Shared shadcn components
/lib
  /soil             — SDA query builder, UC Davis client
  /geo              — Turf wrappers, acreage calc
  /rates            — Rate engine, multiplier logic
  /telematics       — AEMP client, GPS track processing
  /ai               — Analysis request/response types
/types              — TypeScript interfaces
```

---

## 3. System 1 — Map and Drawing Engine

### Mapbox Configuration

```javascript
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/satellite-streets-v12',
  center: [-99.1403, 30.0469], // Kerrville TX
  zoom: 14,
});

// 3D terrain (toggle on/off)
map.addSource('mapbox-dem', {
  type: 'raster-dem',
  url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
  tileSize: 512,
  maxzoom: 14,
});
```

### Polygon Drawing and Acreage

```javascript
import * as turf from '@turf/turf';

function calculateAcreage(polygon) {
  const sqMeters = turf.area(polygon);
  return Math.round((sqMeters / 4046.8564224) * 100) / 100;
}
```

### Map Layer Toggles

The map supports toggleable overlays: Satellite (default), NAIP CIR (false color), NDVI heatmap, AI density overlay, Soil map units, Elevation contours, Equipment GPS positions (live), Cleared area overlay (from GPS tracks), Drone orthomosaic (when uploaded).

### Best Practices

1. Default satellite view. Cedar clearing operators need to see actual vegetation.
2. Color code polygons by vegetation type: green=cedar, brown=oak, orange=mixed, red=full clear.
3. Real-time acreage label updating as user draws.
4. Multiple polygons per bid with independent settings.
5. Offline tile caching for Hill Country dead zones.
6. Pasture names carry through to PDF ("North Pasture", "Creek Bottom").

---

## 4. System 2 — Multi-Source Satellite Imagery

### Why Multiple Sources

No single satellite gives the full picture. Cross-referencing 3 to 5 sources produces a composite analysis far more accurate than any one alone.

### Source Matrix

| Source | Resolution | Bands | Cost | Refresh | Best For |
|--------|-----------|-------|------|---------|----------|
| NAIP | 0.6m | 4 (RGB+NIR) | Free | 2 to 3 years | High-res tree detection, NDVI |
| Sentinel-2 | 10m | 13 | Free | 5 days | Species discrimination, seasonal change |
| Mapbox Satellite | Sub-meter | RGB | Mapbox plan | Varies | Visual reference, base map |
| Google Earth Engine | Various | Various | Free (non-commercial) | Various | Historical change detection |
| Planet Labs | 3m | 4+ | $4k to $10k/yr | Daily | Premium temporal coverage |

### NAIP Access (Highest Priority Free Source)

```
GET https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage
  ?bbox=-99.15,30.04,-99.13,30.06
  &bboxSR=4326&size=2000,2000&imageSR=4326
  &format=png
  &renderingRule={"rasterFunction":"NDVI_Color"}
  &f=image
```

Available rendering templates: NaturalColor (standard aerial), FalseColorComposite (NIR/Red/Green, cedar shows as bright red), NDVI_Color (vegetation density heatmap).

Texas-specific NAIP also at: `imagery.geographic.texas.gov/server/rest/services/NAIP/`

### Sentinel-2 Access (Species Discrimination)

Via Sentinel Hub Process API or free from AWS Open Data (`registry.opendata.aws/sentinel-2`).

Key bands for cedar detection: B04 (Red, 10m) for chlorophyll absorption, B08 (NIR, 10m) for vegetation reflectance, B05/B06/B07 (Red Edge, 20m) for species discrimination, B11 (SWIR, 20m) for moisture content.

### Composite Processing Pipeline

1. Fetch imagery from all sources
2. Align and resample to common 1m grid
3. Compute vegetation indices per source (NDVI, EVI, NDWI, Red Edge)
4. Run species classification (cedar vs oak vs grass)
5. Generate outputs: density heatmap, tree count, confidence score

---

## 5. System 3 — AI Cedar Detection Pipeline

### Three-Phase AI Strategy

**Phase 1 (Ship First): Rule-Based NDVI**

No training data needed. Cedar stays green year-round. Compare winter NDVI to summer NDVI. Anything with a seasonal persistence ratio above 0.75 and winter NDVI above 0.35 is almost certainly cedar. Gets you ~70 to 80% accuracy on day one.

```python
def detect_cedar_by_seasonality(summer_ndvi, winter_ndvi):
    persistence = np.where(summer_ndvi > 0.2, winter_ndvi / summer_ndvi, 0)
    cedar_mask = (persistence > 0.75) & (winter_ndvi > 0.35)
    oak_mask = (persistence > 0.3) & (persistence <= 0.75) & (summer_ndvi > 0.4)
    grass_mask = (persistence <= 0.3) & (summer_ndvi > 0.3)
    return cedar_mask, oak_mask, grass_mask
```

**Phase 2 (Month 3 to 6): Before/After Training Data**

For each completed job, compare pre-clearing satellite imagery with post-clearing imagery. The difference is exactly where the trees were. This is free labeled training data. Use Label Studio (open source) for annotation workflow.

**Phase 3 (Month 6+): ML Tree Detection (Roboflow)**

Once you have 20+ completed jobs with drone imagery, train a U-Net segmentation model via Roboflow for individual tree detection in NAIP imagery. Input: 256x256 NAIP patches (4 channels). Output: per-pixel classification (background, cedar small, cedar medium, cedar large, oak).

Don't start Roboflow until you have the data. Rule-based gets you 80% of the way there for free.

### Tree Count and Size Estimation

At NAIP resolution (0.6m), individual cedar canopies are visible. Connected component analysis counts trees and estimates canopy diameter.

```python
from scipy.ndimage import label

def count_trees(cedar_mask, pixel_size_m=0.6):
    labeled_array, num_features = label(cedar_mask)
    trees = []
    for tree_id in range(1, num_features + 1):
        pixels = np.sum(labeled_array == tree_id)
        area_sqm = pixels * (pixel_size_m ** 2)
        diameter_ft = 2 * np.sqrt(area_sqm / np.pi) * 3.28084
        size = 'small' if diameter_ft < 10 else 'medium' if diameter_ft < 20 else 'large'
        trees.append({'diameter_ft': round(diameter_ft, 1), 'size': size})
    return trees
```

### AI Service Architecture

Python FastAPI microservice on Railway. Frontend sends polygon coordinates, service fetches imagery, runs analysis, returns density score, species breakdown, tree count, heatmap URL, and tree positions for 3D rendering.

---

## 6. System 4 — Soil Data Integration

### Dual Source Strategy

**UC Davis SoilWeb** (quick point queries, pre-aggregated grids):
```
GET https://casoilresource.lawr.ucdavis.edu/soil_web/query.php?lon=-99.14&lat=30.05
```
Also provides Soil Data Explorer per series: `https://casoilresource.lawr.ucdavis.edu/sde/?series=tarrant`

**USDA Soil Data Access** (powerful polygon queries, full SSURGO):
```
POST https://SDMDataAccess.sc.egov.usda.gov/Tabular/post.rest
Body: { "query": "SQL HERE", "format": "JSON" }
```

No API key required for either. Both free.

### Key Properties for Clearing Bids

| Property | Impact | Source |
|----------|--------|--------|
| Slope % | Steeper = slower, more fuel | SDA `slope_r` |
| Rock fragment % | Rocky = equipment wear, slower | SDA `fragvol_r` in chfrags |
| Depth to bedrock | Shallow = can't mulch deep | SDA `resdept_r` in corestrictions |
| Drainage class | Poor = bogging risk | SDA `drainagecl` |
| Flooding frequency | Scheduling constraint | SDA `flodfreqcl` |

### Soil to Difficulty Multiplier

```javascript
function calculateSoilDifficulty(soil) {
  let m = 1.0;
  if (soil.slope_r > 20) m *= 1.5;
  else if (soil.slope_r > 12) m *= 1.25;
  else if (soil.slope_r > 5) m *= 1.1;

  if (soil.fragvol_r > 50) m *= 1.4;
  else if (soil.fragvol_r > 25) m *= 1.2;

  if (soil.drainagecl === 'Poorly drained') m *= 1.3;
  if (soil.resdept_r && soil.resdept_r < 25) m *= 1.3;

  return Math.round(m * 100) / 100;
}
```

### SDA WMS Soil Map Overlay

Display soil unit boundaries as toggleable map layer using the SDA Web Map Service at `SDMDataAccess.sc.egov.usda.gov/Spatial/SDM.wms`.

### Best Practices

Cache aggressively (SSURGO refreshes once per year). Weight by component percentage when polygon overlaps multiple map units. Show the data to the operator and let them override. Fail gracefully when government services are down.

---

## 7. System 5 — Drone Photogrammetry

### Why Drone Data Is a Game Changer

Satellite: 0.6m pixels (NAIP). Drone: 1 to 2cm pixels. That's 30 to 60x more detail. At drone resolution you can distinguish a 6-foot cedar from a 20-foot cedar, measure actual trunk diameter, and count individual trees precisely.

### Upload Pipeline

```
Crew flies drone (grid pattern, 150-200ft AGL, 75%/65% overlap)
  → Upload JPGs to app
  → App extracts EXIF GPS from each image
  → Images sent to OpenDroneMap (NodeODM on Railway)
  → ODM produces:
      ├── Orthomosaic (stitched aerial, georeferenced GeoTIFF)
      ├── Digital Surface Model (terrain + trees)
      ├── Digital Terrain Model (bare earth)
      ├── 3D point cloud
      └── CHM = DSM - DTM = actual tree heights
  → App overlays orthomosaic on map (replaces satellite)
  → AI re-runs on drone imagery (much higher confidence)
```

### Canopy Height Model

DSM minus DTM gives actual height of every object above ground. Local maxima detection finds tree tops. This provides measured tree heights, not estimates.

```python
def compute_chm(dsm_path, dtm_path):
    dsm = rasterio.open(dsm_path).read(1)
    dtm = rasterio.open(dtm_path).read(1)
    chm = np.clip(dsm - dtm, 0, 30)  # meters
    return chm
```

### How Drone Data Refines Everything

1. **Ground truth for AI training:** CHM provides pixel-perfect labeled data for ML model.
2. **Confidence upgrade:** Satellite-only confidence ~0.5 to 0.7. Drone-verified: 0.85 to 0.95.
3. **Satellite calibration:** Learn correction factors between satellite density estimates and actual tree counts.
4. **Current state:** NAIP imagery is from 2022. Drone gives you today's conditions.

### Flight Best Practices (Include as Help Guide in App)

- Altitude: 150 to 200 feet AGL
- Overlap: 75% front, 65% side
- Pattern: Grid (lawnmower) covering polygon + 50ft buffer
- Time: 10am to 2pm (minimize shadows)
- ~10 images per acre at 200ft
- DJI Mini 4 Pro covers ~25 to 30 acres per battery

---

## 8. System 6 — Equipment Telematics and GPS

### The Big Idea

If the machine already has a GPS tracker broadcasting its position every 30 seconds, you can calculate cleared area automatically without the operator touching their phone. The machine's movement path × the mulcher cutting width = area cleared. This feeds directly into progress reports and the feedback loop.

### Integration Options (Pick One)

**Option A: OEM Telematics (CAT Product Link, JD JDLink, etc.)**

Most CAT machines manufactured after 2010 have Product Link hardware built in. It reports GPS location, engine hours, idle time, fuel consumption, and fault codes to CAT's VisionLink cloud. Access this data via the ISO 15143-3 (AEMP 2.0) API, which is an industry standard that works across CAT, John Deere, Komatsu, Kubota, Volvo, Liebherr, and 20+ other OEMs.

```
CAT ISO 15143-3 API:
Base URL: https://services.cat.com/telematics/iso15143/

GET /fleet/{pageNumber}
  → Returns snapshot of all equipment: location, hours, fuel, fault codes

GET /equipment/makeModelSerial/{make}/{model}/{serial}
  → Single machine data

Response includes:
  - Location: { Latitude, Longitude, Altitude, Datetime }
  - CumulativeOperatingHours: { Hour, Datetime }
  - CumulativeIdleHours: { Hour, Datetime }
  - FuelUsed: { FuelUnits, FuelConsumed, Datetime }
  - EngineStatus: { Running: true/false }
  - FaultCodes: [{ ... }]
```

Requires: CAT Digital Marketplace subscription, client ID and secret. Cost: one-time API fee (up to 10,000 calls/day).

**Option B: Aftermarket Trackers (Samsara, CalAmp, Titan GPS)**

If the machines don't have OEM telematics, or CCC has a mixed fleet, aftermarket trackers like Samsara ($15 to $30/month per unit) provide the same data. Samsara has a REST API and also supports the AEMP 2.0 standard.

```
Samsara API:
GET https://api.samsara.com/v1/fleet/locations
  Headers: { Authorization: Bearer {API_TOKEN} }
```

**Option C: Dedicated GPS Pucks (Cheapest)**

Simple GPS trackers like the LandAirSea Overdrive ($20/month) that report position every 30 seconds via cellular. No engine data, just location. Sufficient for area-cleared calculations if OEM telematics is not available.

### Unified Telematics Client

Regardless of source, normalize all telematics data into a common format:

```typescript
interface TelematicsReading {
  equipmentId: string;
  source: 'cat_iso' | 'jd_jdlink' | 'samsara' | 'calamp' | 'gps_puck' | 'manual';
  timestamp: string;

  // Position
  latitude: number;
  longitude: number;
  altitude: number | null;
  heading: number | null;
  speed: number | null; // m/s

  // Engine
  engineRunning: boolean;
  engineHoursTotal: number | null;
  idleHoursTotal: number | null;

  // Fuel
  fuelConsumedTotal: number | null; // liters or gallons
  fuelLevelPct: number | null;

  // Diagnostics
  faultCodes: FaultCode[] | null;
}

interface FaultCode {
  code: string;
  severity: 'info' | 'warning' | 'critical';
  description: string;
  firstOccurrence: string;
  occurrenceCount: number;
}
```

### Auto-Calculating Cleared Area from GPS

This is the killer feature. The machine's GPS breadcrumb trail combined with the mulcher cutting width gives you cleared area with no manual input.

```typescript
interface SwathCalculation {
  equipmentId: string;
  attachmentId: string;
  cuttingWidthFeet: number; // mulcher head width, e.g., 6 feet for FAE UML/SSL

  // GPS track for the work period
  trackPoints: { lat: number; lng: number; timestamp: number; speed: number }[];

  // Calculated
  totalDistanceMeters: number;
  activeDistanceMeters: number; // only where speed > 0.5 m/s
  estimatedAreaClearedAcres: number;
}

function calculateClearedArea(
  trackPoints: TrackPoint[],
  cuttingWidthFeet: number
): number {
  // Filter to active movement only (speed > 0.5 m/s, ~1 mph)
  const active = trackPoints.filter(p => p.speed > 0.5);

  // Calculate total distance traveled while active
  let totalDistanceMeters = 0;
  for (let i = 1; i < active.length; i++) {
    totalDistanceMeters += turf.distance(
      turf.point([active[i-1].lng, active[i-1].lat]),
      turf.point([active[i].lng, active[i].lat]),
      { units: 'meters' }
    );
  }

  // Area = distance × cutting width
  const cuttingWidthMeters = cuttingWidthFeet * 0.3048;
  const areaSqMeters = totalDistanceMeters * cuttingWidthMeters;
  const acres = areaSqMeters / 4046.86;

  // Apply overlap factor (mulchers typically overlap ~15% for full coverage)
  const overlapFactor = 0.85;

  return Math.round(acres * overlapFactor * 100) / 100;
}
```

### Live Equipment Map

The office sees all machines on a real-time map:

```
FLEET MAP — Live

[Satellite map showing job site]

● CAT 299D3 #103 — Henderson Ranch, North Pasture
  Status: Running | 4,287 hrs | Speed: 2.1 mph
  Today: 7.3 acres cleared | 6.2 engine hours
  Fuel: 62%

● CAT 289D3 #105 — Henderson Ranch, Creek Bottom
  Status: Idle (12 min) | 2,103 hrs
  Today: 4.1 acres cleared | 5.8 engine hours
  Fuel: 44%

● F-350 #201 — En route to Henderson Ranch
  Status: Moving | Speed: 55 mph
  ETA: 22 minutes

GPS tracks shown as colored lines on map
Green shading = estimated cleared area
```

### Telematics Polling and Data Flow

```
Every 60 seconds:
  → Poll OEM API (CAT ISO, Samsara, etc.)
  → Normalize to TelematicsReading format
  → Store in telematics_readings table
  → Update equipment record (current location, hours)
  → If machine is on an active job:
      → Append to GPS track for the day
      → Recalculate cleared area estimate
      → Update work order progress
      → Check for maintenance alerts (hours thresholds)
      → Push to frontend via Supabase Realtime
```

### Geofence Alerts

Define geofences around job sites, storage yards, and restricted areas:

- **Job site geofence:** Auto clock-in suggestion when machine enters
- **Storage yard geofence:** Track overnight locations, theft alert if machine leaves after hours
- **Restricted area:** Alert if machine enters a buffer zone (well, septic, protected trees)
- **Property boundary:** Alert if machine exits the job polygon

### Telematics Feeding the Feedback Loop

Equipment GPS data produces the most accurate feedback:

- Actual engine hours per pasture (from telematics, not operator estimate)
- Actual fuel consumption per acre (from fuel burn data)
- Active vs idle time ratio (efficiency metric)
- Ground speed patterns (slow sections = rocky/thick, fast sections = light)
- Teeth wear correlation (hours between changes × soil type × ground speed)

This data is far more reliable than manual operator logs and feeds directly into the prediction model.

---

## 9. System 7 — Bid Engine and Clearing Methods

### Clearing Method Matrix

Seven methods, each with its own rate multiplier, time multiplier, and finish description:

| Method | Rate Mult | Time Mult | Equipment | Result |
|--------|----------|----------|-----------|--------|
| Fine Mulch (Premium) | 1.4x | 1.6x | Forestry mulcher, multi-pass | Park-like finish, stumps flush |
| Rough Mulch (Standard) | 1.0x | 1.0x | Forestry mulcher, single pass | Functional, some stumps |
| Chainsaw + Grapple Pile | 0.75x | 1.3x | Chainsaws, skid steer grapple | Cut and stacked, stumps remain |
| Chainsaw + Haul Off | 1.15x | 1.5x | Chainsaws, grapple, dump trailer | Debris removed, stumps remain |
| Dozer Push and Pile | 0.6x | 0.5x | D6+ dozer | Fastest, disturbs soil |
| Selective Thin | 1.3x | 1.8x | Mulcher + chainsaws | Precision, keep desirable trees |
| Cedar Only, Protect Oaks | 1.15x | 1.3x | Mulcher + chainsaws | Most common Hill Country request |

Plus: Right of Way / Fence Line (1.1x rate, linear corridor).

### Bid Calculation Formula

```
pastureCost =
  acreage
  × baseRate[vegType]
  × densityMultiplier[density]
  × max(terrainMultiplier, soilMultiplier)
  × methodMultiplier[clearingMethod]
  + (acreage × disposalAdder[method])
  + methodSpecificAdders

totalBid = sum(pastureCosts) + mobilization + permits + customItems
```

### Multi-Option Bids

A single bid can present 2 to 3 method options per pasture or for the whole job. This shifts the customer from "should I hire them?" to "which package do I want?"

```
OPTION A: Premium Fine Mulch ........ $64,200 (18-22 days)
OPTION B: Standard Rough Mulch ...... $45,850 (12-16 days) ← RECOMMENDED
OPTION C: Chainsaw and Pile ......... $34,100 (14-18 days)
```

### Multi-Method Per Bid

Different methods per pasture: fine mulch the 5 acres by the house, rough mulch the 30 acres of near pasture, chainsaw/pile the back 100 acres.

### Method-Specific Adders

| Add-on | Per | Cost |
|--------|-----|------|
| Stump grinding (flush) | acre | $75 to $150 |
| Haul off | acre | $100 to $250 |
| Burn pile construction | pile | $50 to $100 |
| Reseeding | acre | $50 to $125 |
| Oak protection buffers | tree | $15 to $30 |
| Fence line corridor | linear foot | $1.50 to $4.00 |

### Rate Card

Fully configurable in settings. Includes base rates per acre by veg type, density multipliers (light 0.75, moderate 1.0, heavy 1.35, extreme 1.65), terrain multipliers, disposal adders, time estimates (hrs/acre by type+density), and minimum bid amount.

---

## 10. System 8 — 3D Terrain and Tree Visualization

### Implementation

Mapbox GL JS 3D terrain (built-in DEM) + Threebox (Three.js plugin that syncs with Mapbox camera).

```javascript
// Enable 3D terrain
map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.3 });

// Add procedural tree models at AI-detected positions via Threebox
// Cedar: green cones (conical shape)
// Oak: dark green domes (rounded canopy)
// Sized proportionally to estimated height and canopy diameter
```

### Performance

Use `THREE.InstancedMesh` for thousands of trees in a single draw call. Level of Detail: full tree models when zoomed in, colored dots when zoomed out. Target 60 FPS.

### Features

Orbit camera with mouse drag, zoom to pasture buttons, tree color coding by species, toggle visibility by species, polygon outlines extruded above terrain, sun position matching actual location, screenshot capture for PDF.

---

## 11. System 9 — Field Operator Mobile App

### The Core Experience

Operator opens app at 7am. Sees: today's job, which pasture, what method, a live satellite map with their GPS dot, what to clear (red=cedar), what to protect (blue=oak), what's done (green=cleared). One tap to clock in.

### Key Screens

1. **Daily Dashboard:** Today's job, equipment assigned, next service due, upcoming jobs
2. **Job Map (the money screen):** Satellite view with polygon boundary, density overlay, protection zones, GPS dot, clearing method instructions
3. **Mark Area Cleared:** Draw shape on map, or use GPS track to shade area
4. **Clock In/Out:** Simple tap, auto-starts GPS tracking
5. **End of Day Log:** Quick tappable selections (acres cleared, equipment issues, ground conditions, weather delays)

### GPS Track Recording

While clocked in, record position every 30 seconds. Creates breadcrumb trail showing where the operator has been. Distance × cutting width = area cleared estimate.

If equipment telematics is available, the machine's GPS is more accurate than the phone's. Use telematics as primary, phone GPS as fallback.

### Offline Mode (Critical)

PWA with service worker + IndexedDB. Works offline for: map viewing (pre-cached tiles), clock in/out, GPS tracking, photos, marking cleared areas, equipment hours logging, maintenance viewing. Syncs when connectivity returns.

### Work Orders

Each pasture generates a work order visible on the operator's phone: clearing method, instructions, protected species, stump treatment, disposal method, special notes, hazards, buffer zones, density heatmap.

### Buffer Zones on Map

- **Red zones:** Do not clear (septic, wells, structures)
- **Blue zones:** Protected trees (oaks, pecans)
- **Orange:** Pasture boundary
- **Yellow:** Fence lines to protect
- **Green:** Already cleared

---

## 12. System 10 — Equipment Management

### Equipment Registry

Every machine gets a profile: name, unit number, type, make, model, year, serial, status (available/assigned/maintenance/down), total engine hours, hours since last service, next service due, current attachment, purchase info, insurance, operating cost per hour (fuel + maintenance + depreciation).

### Attachments (Mulcher Heads, Grapples)

Tracked separately: model, compatible machines, total hours, last teeth change, teeth change interval. Teeth are a major consumable. In rocky Hill Country soil, a set might last 80 to 100 hours instead of 150.

### Maintenance Tracking

Predefined service intervals per equipment type (daily inspection, oil/filter at 500 hrs, hydraulic filter at 500 hrs, teeth change at 150 hrs, track inspection at 250 hrs, full dealer service at 2000 hrs). App alerts when service is due.

### Teeth Change Records

Track teeth life by soil type and terrain. Over time: Tarrant series + 50% rock = ~80 hours per set. Krum series + <5% rock = ~200 hours per set. This feeds into job costing for accurate consumable cost per acre.

### Telematics Auto-Update

When connected to OEM telematics (CAT ISO API, Samsara), engine hours, fuel, and fault codes update automatically. No manual entry needed.

### Equipment Cost Per Hour

```
totalCostPerHour = fuelCostPerHour + maintenanceCostPerHour + depreciationPerHour
```

This number feeds into job profitability analysis. If it costs $18.40/hour to run the CAT 299D3, and a job takes 120 hours, the equipment cost is $2,208. Compare that to the bid amount to know the real margin.

---

## 13. System 11 — Scheduling and Dispatch

### Calendar View

Visual calendar showing job blocks, equipment assignments, and crew schedules. Drag to reschedule.

### Conflict Detection

Flags: equipment double-booked, crew on two jobs same day, maintenance due during scheduled job, jobs back-to-back with no mobilization day.

### Weather Integration

Pull 7-day forecast for job site via OpenWeather or WeatherAPI. Auto-flag days with >50% rain chance. Cedar clearing shuts down when wet.

---

## 14. System 12 — Self-Improving Feedback Loop

### Post-Job Review

After completion, crew logs per pasture: actual hours, equipment used, crew size, weather delays, conditions encountered (lighter/heavier than expected), accuracy rating 1 to 5, before/after photos.

### Calibration Data

Every completed pasture produces a calibration record comparing predicted vs actual: predicted hrs/acre, actual hrs/acre, error %, equipment, soil series, density score, terrain. Stored in `calibration_records` table.

### Model Retraining

Triggers automatically after every 5 new completed jobs. Starts with k-nearest-neighbors, graduates to gradient boosting (scikit-learn) at 20+ records, potentially neural network at 100+.

### Equipment GPS Supercharges This

With telematics integration, the feedback loop gets machine-verified data instead of operator estimates: actual engine hours from ECM (exact), fuel consumed (exact), active vs idle time (exact), ground speed patterns (correlates to terrain difficulty). This is the highest-quality training data possible.

### Accuracy Timeline

| Months | Jobs | Method | Expected Error |
|--------|------|--------|---------------|
| 0 to 3 | 0 to 10 | Manual + NDVI rules | ~40 to 60% |
| 3 to 6 | 10 to 25 | First ML model | ~25 to 35% |
| 6 to 9 | 25 to 50 | Model v2 + tree detection | ~15 to 25% |
| 9 to 12 | 50 to 75 | Mature model | ~10 to 15% |
| 12+ | 75+ | Self-calibrating | <10% |

---

## 15. System 13 — Progress Tracking and Customer Reports

### Three Data Sources for Progress

1. **Equipment GPS:** Machine's path × cutting width = cleared area (automatic, most reliable)
2. **Operator marking:** Manual "mark cleared" on phone app (immediate)
3. **Drone flyovers:** Compare current CHM to baseline (most accurate, periodic)

### Completion Calculation

```
progress_pct = (baseline_vegetation_pixels - current_vegetation_pixels) / baseline_vegetation_pixels * 100
```

### Customer Progress Report PDF

Auto-generated, emailed weekly or at milestones: before/after map comparison, per-pasture progress table, heatmap (green=cleared, red=remaining), photo gallery, crew notes, estimated completion date.

---

## 16. System 14 — Business Management

### Customer CRM

Customer profiles with: contact info, properties (with gate codes and access notes), bid history, job history, total revenue, win rate, preferred clearing method, referral tracking.

### Invoicing

Generate invoices from completed jobs. Line items pulled from bid, with change order support. Status tracking: draft, sent, viewed, paid, overdue. Export to CSV or integrate with QuickBooks (future phase).

### Job Profitability Analysis

After every job: revenue, labor cost (hours × rate), fuel cost (from telematics), equipment cost (hours × cost/hour), teeth/consumables, total direct cost, gross margin. Breakdown by pasture.

### Analytics Dashboard

Owner sees: active jobs, revenue MTD, pipeline value, bid win rate, average margin by clearing method, equipment utilization %, bid accuracy trend, maintenance alerts.

---

## 17. System 15 — PDF Generation

### Approach

Puppeteer renders a dedicated Next.js route to PDF. Full CSS control, custom fonts, embedded map images.

### Bid PDF Layout

1. **Cover:** Logo, "Clearing Proposal", client info, date, bid number
2. **Property Overview:** Satellite map with polygons, total acreage, estimated duration
3. **AI Analysis (if available):** Density heatmap, tree count, species breakdown, 3D screenshot
4. **Pasture Details (per pasture):** Zoomed map, soil data, method, line items, subtotal
5. **Options Comparison:** Multi-option pricing table (if presenting multiple methods)
6. **Summary:** Total, timeline, payment terms, signature lines, validity date

### Progress Report PDF

Cover, before/after map, progress table, heatmap, photos, notes, next steps.

---

## 18. Complete Data Model

### Core Tables

```sql
-- Companies
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL, logo_url TEXT, address TEXT,
  phone TEXT, email TEXT, website TEXT,
  license_number TEXT, insurance_info TEXT,
  terms_and_conditions TEXT,
  rate_card JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Users (linked to Supabase Auth)
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  company_id UUID REFERENCES companies(id),
  full_name TEXT NOT NULL,
  role TEXT DEFAULT 'operator',  -- owner, operator, crew_lead, viewer
  phone TEXT, created_at TIMESTAMPTZ DEFAULT now()
);

-- Clients
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  name TEXT NOT NULL, email TEXT, phone TEXT, address TEXT,
  preferred_clearing_method TEXT,
  preferred_contact TEXT,  -- phone, email, text
  payment_terms TEXT, notes TEXT, tags TEXT[],
  referred_by TEXT, referrals_given TEXT[],
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Properties
CREATE TABLE properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id),
  name TEXT, address TEXT, total_acres REAL,
  gate_code TEXT, access_notes TEXT,
  center JSONB, boundary JSONB,
  soil_summary TEXT, terrain_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Bids
CREATE TABLE bids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  client_id UUID REFERENCES clients(id),
  created_by UUID REFERENCES users(id),
  bid_number TEXT NOT NULL,
  status TEXT DEFAULT 'draft',  -- draft, sent, accepted, declined, expired
  property_name TEXT, property_address TEXT,
  property_center JSONB, map_zoom REAL,
  total_acreage REAL, total_amount NUMERIC(12,2),
  estimated_days_low REAL, estimated_days_high REAL,
  mobilization_fee NUMERIC(10,2) DEFAULT 0,
  burn_permit_fee NUMERIC(10,2) DEFAULT 0,
  custom_line_items JSONB DEFAULT '[]',
  contingency_pct REAL DEFAULT 0, discount_pct REAL DEFAULT 0,
  notes TEXT, valid_until DATE,
  rate_card_snapshot JSONB,
  ai_confidence_score REAL, prediction_model_version INT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Pastures
CREATE TABLE pastures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id UUID REFERENCES bids(id) ON DELETE CASCADE,
  name TEXT NOT NULL, sort_order INT DEFAULT 0,
  polygon JSONB NOT NULL, acreage REAL NOT NULL, centroid JSONB,
  vegetation_type TEXT NOT NULL, density TEXT NOT NULL,
  terrain TEXT NOT NULL, clearing_method TEXT NOT NULL,
  method_options JSONB DEFAULT '{}',
  disposal_method TEXT NOT NULL,
  -- Soil
  soil_data JSONB, soil_multiplier REAL DEFAULT 1.0,
  soil_multiplier_override REAL,
  -- AI
  ai_density_score REAL, ai_cedar_coverage_pct REAL,
  ai_oak_coverage_pct REAL, ai_tree_count JSONB,
  ai_heatmap_url TEXT, ai_tree_positions JSONB,
  -- Drone
  drone_survey_id UUID, drone_verified BOOLEAN DEFAULT false,
  drone_tree_count JSONB, drone_avg_tree_height_ft REAL,
  -- Predictions
  estimated_hrs_per_acre REAL, predicted_hrs_per_acre REAL,
  prediction_confidence REAL,
  -- Financial
  subtotal NUMERIC(10,2), method_multiplier REAL DEFAULT 1.0,
  notes TEXT, created_at TIMESTAMPTZ DEFAULT now()
);

-- Jobs
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id UUID REFERENCES bids(id) UNIQUE,
  company_id UUID REFERENCES companies(id),
  client_id UUID REFERENCES clients(id),
  status TEXT DEFAULT 'scheduled',
  priority TEXT DEFAULT 'normal',
  scheduled_start DATE, actual_start DATE,
  estimated_completion DATE, actual_completion DATE,
  crew_lead_id UUID REFERENCES users(id),
  assigned_operators UUID[], assigned_equipment UUID[],
  contract_amount NUMERIC(12,2),
  overall_progress_pct REAL DEFAULT 0,
  site_access_notes TEXT, mobilization_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Work Orders (per pasture within a job)
CREATE TABLE work_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
  pasture_id UUID REFERENCES pastures(id),
  clearing_method TEXT NOT NULL,
  method_instructions TEXT, protected_species TEXT[],
  stump_treatment TEXT, disposal_method TEXT,
  special_notes TEXT, hazards TEXT[],
  buffer_zones JSONB DEFAULT '[]',
  status TEXT DEFAULT 'not_started',
  progress_pct REAL DEFAULT 0,
  estimated_hours REAL, actual_hours REAL,
  started_date DATE, completed_date DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Time Entries
CREATE TABLE time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES jobs(id),
  work_order_id UUID REFERENCES work_orders(id),
  operator_id UUID REFERENCES users(id),
  equipment_id UUID REFERENCES equipment(id),
  clock_in TIMESTAMPTZ NOT NULL, clock_out TIMESTAMPTZ,
  breaks JSONB DEFAULT '[]',
  total_hours REAL, active_hours REAL,
  work_type TEXT DEFAULT 'clearing',
  gps_track_id UUID, areas_cleared_acres REAL,
  daily_log JSONB,
  approved BOOLEAN DEFAULT false,
  approved_by UUID, approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- GPS Tracks (from phone or telematics)
CREATE TABLE gps_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,  -- 'phone', 'telematics'
  equipment_id UUID REFERENCES equipment(id),
  operator_id UUID REFERENCES users(id),
  job_id UUID REFERENCES jobs(id),
  date DATE NOT NULL,
  points JSONB NOT NULL,
  total_distance_meters REAL,
  active_minutes REAL, idle_minutes REAL,
  estimated_area_cleared_acres REAL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Equipment
CREATE TABLE equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  name TEXT NOT NULL, unit_number TEXT,
  type TEXT NOT NULL, make TEXT, model TEXT,
  year INT, serial_number TEXT,
  status TEXT DEFAULT 'available',
  current_job_id UUID REFERENCES jobs(id),
  current_location JSONB,
  -- Hours
  total_engine_hours REAL DEFAULT 0,
  hours_since_last_service REAL DEFAULT 0,
  next_service_due_hours REAL, next_service_type TEXT,
  -- Telematics
  telematics_provider TEXT,  -- 'cat_iso', 'samsara', 'calamp', 'gps_puck', 'none'
  telematics_device_id TEXT,
  telematics_serial TEXT,
  last_telematics_sync TIMESTAMPTZ,
  -- Attachment
  current_attachment TEXT,
  cutting_width_feet REAL,  -- for area-cleared calculations
  -- Financial
  purchase_date DATE, purchase_price NUMERIC(12,2),
  monthly_payment NUMERIC(10,2),
  fuel_cost_per_hour NUMERIC(6,2),
  maintenance_cost_per_hour NUMERIC(6,2),
  depreciation_per_hour NUMERIC(6,2),
  insurance_policy TEXT, insurance_expiry DATE,
  registration_expiry DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Telematics Readings (raw data from OEM/aftermarket)
CREATE TABLE telematics_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id UUID REFERENCES equipment(id),
  source TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  latitude REAL, longitude REAL,
  altitude REAL, heading REAL, speed REAL,
  engine_running BOOLEAN,
  engine_hours_total REAL, idle_hours_total REAL,
  fuel_consumed_total REAL, fuel_level_pct REAL,
  fault_codes JSONB,
  raw_data JSONB,  -- full API response for debugging
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Attachments (mulcher heads, grapples)
CREATE TABLE attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  name TEXT NOT NULL, type TEXT NOT NULL,
  make TEXT, model TEXT,
  compatible_equipment UUID[],
  total_hours REAL DEFAULT 0,
  status TEXT DEFAULT 'available',
  installed_on UUID REFERENCES equipment(id),
  last_teeth_change_hours REAL,
  teeth_change_interval REAL DEFAULT 150,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Maintenance Records
CREATE TABLE maintenance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id UUID REFERENCES equipment(id),
  attachment_id UUID REFERENCES attachments(id),
  type TEXT NOT NULL, category TEXT NOT NULL,
  description TEXT,
  engine_hours_at_service REAL, date DATE NOT NULL,
  performed_by TEXT, location TEXT,
  parts_cost NUMERIC(10,2) DEFAULT 0,
  labor_cost NUMERIC(10,2) DEFAULT 0,
  total_cost NUMERIC(10,2) DEFAULT 0,
  parts_used JSONB DEFAULT '[]',
  downtime_hours REAL DEFAULT 0,
  job_impacted UUID REFERENCES jobs(id),
  next_service_due_hours REAL, next_service_type TEXT,
  notes TEXT, photos TEXT[], receipt_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Teeth Change Records
CREATE TABLE teeth_change_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id UUID REFERENCES equipment(id),
  attachment_id UUID REFERENCES attachments(id),
  hours_since_last_change REAL,
  job_id UUID REFERENCES jobs(id),
  soil_series TEXT, rock_fragment_pct REAL, terrain_class TEXT,
  teeth_count INT, cost_per_tooth NUMERIC(6,2), total_cost NUMERIC(8,2),
  brand TEXT, wear_level TEXT, notes TEXT, photo TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Calibration Records (feedback loop)
CREATE TABLE calibration_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  bid_id UUID REFERENCES bids(id),
  pasture_id UUID REFERENCES pastures(id),
  vegetation_type TEXT, density_class TEXT, terrain_class TEXT,
  acreage REAL, clearing_method TEXT,
  soil_series TEXT, slope_r REAL, rock_fragment_pct REAL,
  soil_multiplier REAL, ai_density_score REAL,
  predicted_hrs_per_acre REAL, actual_hrs_per_acre REAL,
  error_pct REAL, error_direction TEXT,
  equipment_used TEXT[], crew_size INT,
  weather_delay_hours REAL,
  density_accuracy INT, soil_accuracy INT, overall_accuracy INT,
  before_photos TEXT[], after_photos TEXT[],
  -- Telematics verified (highest quality data)
  telematics_engine_hours REAL,
  telematics_fuel_consumed REAL,
  telematics_active_pct REAL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Drone Surveys
CREATE TABLE drone_surveys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id UUID REFERENCES bids(id),
  job_id UUID REFERENCES jobs(id),
  pasture_id UUID REFERENCES pastures(id),
  survey_type TEXT NOT NULL,  -- pre_clearing, progress, post_clearing
  survey_date TIMESTAMPTZ NOT NULL,
  image_count INT, coverage_polygon JSONB,
  flight_altitude_ft REAL, drone_model TEXT,
  odm_task_id TEXT,
  processing_status TEXT DEFAULT 'pending',
  orthomosaic_url TEXT, dsm_url TEXT, dtm_url TEXT,
  chm_url TEXT, point_cloud_url TEXT,
  gsd_cm REAL, total_area_acres REAL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Progress Snapshots
CREATE TABLE progress_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL,
  pasture_id UUID REFERENCES pastures(id),
  snapshot_date TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL,  -- 'telematics', 'drone', 'operator_manual'
  progress_pct REAL NOT NULL,
  cleared_acres REAL, remaining_acres REAL,
  comparison_heatmap_url TEXT, notes TEXT,
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
  subtotal NUMERIC(12,2), tax_rate REAL DEFAULT 0,
  tax_amount NUMERIC(10,2) DEFAULT 0,
  total NUMERIC(12,2), deposit_paid NUMERIC(10,2) DEFAULT 0,
  amount_due NUMERIC(12,2),
  payment_terms TEXT, due_date DATE,
  status TEXT DEFAULT 'draft',
  sent_at TIMESTAMPTZ, paid_at TIMESTAMPTZ,
  paid_amount NUMERIC(12,2) DEFAULT 0,
  pdf_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Model Performance Log
CREATE TABLE model_performance_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  model_version INT, training_records INT,
  mae_hrs_per_acre REAL, feature_importances JSONB,
  retrained_at TIMESTAMPTZ DEFAULT now()
);

-- Caches
CREATE TABLE soil_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  polygon_hash TEXT UNIQUE NOT NULL,
  soil_data JSONB NOT NULL,
  queried_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE imagery_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  polygon_hash TEXT NOT NULL, source TEXT NOT NULL,
  imagery_date DATE, analysis_result JSONB,
  image_url TEXT, fetched_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(polygon_hash, source)
);

-- Contact Log (CRM)
CREATE TABLE contact_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id),
  type TEXT NOT NULL, date TIMESTAMPTZ NOT NULL,
  summary TEXT, follow_up_date DATE, follow_up_action TEXT,
  logged_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Notifications
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  type TEXT NOT NULL, title TEXT NOT NULL, body TEXT,
  data JSONB, read BOOLEAN DEFAULT false,
  sent_at TIMESTAMPTZ DEFAULT now()
);

-- PDF Versions
CREATE TABLE pdf_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id UUID REFERENCES bids(id),
  job_id UUID,
  type TEXT NOT NULL,  -- 'bid', 'progress_report', 'invoice'
  version INT NOT NULL, file_url TEXT NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT now()
);
```

### Key Indexes

```sql
CREATE INDEX idx_bids_company ON bids(company_id);
CREATE INDEX idx_bids_status ON bids(status);
CREATE INDEX idx_pastures_bid ON pastures(bid_id);
CREATE INDEX idx_jobs_company ON jobs(company_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_work_orders_job ON work_orders(job_id);
CREATE INDEX idx_time_entries_job ON time_entries(job_id);
CREATE INDEX idx_time_entries_operator ON time_entries(operator_id);
CREATE INDEX idx_gps_tracks_job ON gps_tracks(job_id);
CREATE INDEX idx_equipment_company ON equipment(company_id);
CREATE INDEX idx_equipment_status ON equipment(status);
CREATE INDEX idx_telematics_equipment ON telematics_readings(equipment_id);
CREATE INDEX idx_telematics_timestamp ON telematics_readings(timestamp);
CREATE INDEX idx_maintenance_equipment ON maintenance_records(equipment_id);
CREATE INDEX idx_calibration_company ON calibration_records(company_id);
CREATE INDEX idx_invoices_job ON invoices(job_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_soil_hash ON soil_cache(polygon_hash);
CREATE INDEX idx_imagery_hash ON imagery_cache(polygon_hash);
```

---

## 19. Tech Stack and Infrastructure

### Hosting Architecture

| Service | Host | Monthly Cost |
|---------|------|-------------|
| Next.js frontend + API | Vercel Pro | $20 |
| Database + Auth + Storage | Supabase Pro | $25 |
| AI Python service | Railway | $20 to $50 |
| NodeODM (drone processing) | Railway (or WebODM Lightning $30) | $20 to $50 |
| Mapbox (under 50k loads) | Free tier | $0 |
| Sentinel Hub (free tier) | Free | $0 |
| NAIP / SDA / UC Davis | Free (government) | $0 |
| Telematics (if aftermarket) | Samsara/CalAmp per unit | $15 to $30/unit |
| Custom domain | ~$12/year | |
| **Total (without aftermarket GPS)** | | **~$85 to $145/month** |

### PWA for Mobile

Progressive Web App, not native. Single codebase, no App Store, instant updates, offline support via service worker, GPS and camera access. If native becomes necessary later (background GPS, Bluetooth for equipment), build with React Native.

---

## 20. Development Phases

| Phase | Feature | Weeks | Notes |
|-------|---------|-------|-------|
| 1 | Map + polygons + basic bid calc | 2 to 3 | Foundation, usable immediately |
| 2 | Soil integration (UC Davis + SDA) | 1 to 2 | Free data, auto difficulty |
| 3 | Clearing method matrix + multi-option bids | 1 to 2 | Pure business logic, closes more bids |
| 4 | PDF generation (bid + options) | 1 to 2 | Sellable product, hand to customers |
| 5 | Customer CRM + properties | 1 to 2 | Store client data, access notes |
| 6 | Job creation + work orders | 1 to 2 | Bid to job conversion |
| 7 | Operator field app (mobile PWA) | 2 to 3 | Map view, work orders, clock in/out |
| 8 | Time tracking + phone GPS | 1 to 2 | Hours logging, breadcrumb trail |
| 9 | Equipment registry + maintenance | 2 to 3 | Fleet management, service alerts |
| 10 | Equipment telematics integration | 2 to 3 | AEMP/ISO API, live GPS, auto hours |
| 11 | Satellite AI density analysis | 3 to 4 | NDVI rules first, no ML needed |
| 12 | Scheduling + dispatch calendar | 2 to 3 | Visual schedule, conflicts |
| 13 | Drone upload + photogrammetry | 3 to 4 | Biggest accuracy jump |
| 14 | 3D visualization | 2 to 3 | Wow factor, goes in PDFs |
| 15 | Feedback loop + self-improvement | 2 to 3 | System starts learning |
| 16 | Invoicing + job profitability | 2 to 3 | Close the financial loop |
| 17 | Progress tracking + customer reports | 2 to 3 | Telematics + drone = auto progress |
| 18 | Reporting + analytics dashboard | 2 to 3 | Owner visibility |
| 19 | ML model (Roboflow) | 4 to 8 | After 15 to 20 jobs for training data |
| 20 | Notifications + customer comms | 1 to 2 | SMS/email automation |
| 21 | Polish, QB export, integrations | Ongoing | Continuous refinement |

### Milestones

**Week 6 to 8:** MVP ships (Phases 1 to 4). CCC sends first bids.  
**Week 16 to 20:** Operations core (Phases 5 to 10). Daily use tool.  
**Week 28 to 34:** Intelligence layer (Phases 11 to 15). AI + feedback loop active.  
**Week 40 to 48:** Full platform (Phases 16 to 21). Complete business OS.

---

## 21. Open Questions for CCC

1. **Rate card:** Exact $/acre by vegetation type and density
2. **Equipment list:** What machines? Make, model, year. Do they have OEM telematics (CAT Product Link)?
3. **Disposal methods:** Primary preference hierarchy
4. **Burn permits:** County process, cost, who handles it
5. **Logo and brand:** SVG or high-res PNG, brand colors
6. **Terms and conditions:** Existing T&C language or need new
7. **Insurance info:** What to show on bids
8. **Job size range:** Smallest they'll take, largest done
9. **Multi-user:** Just owner, or crew leads too?
10. **Website/domain:** Existing site, subdomain plan
11. **Competitors:** Who bids against them, what do competitor bids look like
12. **Payment terms:** Net 30, deposit %, progress payments
13. **Historical data:** Records from past jobs (acreage, type, time, cost)? Seeds the feedback model.
14. **Drone:** Own one? Which model? Need Part 107?
15. **Seasonal variation:** Rate changes by season? Winter vs summer preferences?
16. **GPS tracking:** Already using Samsara, CAT VisionLink, or other telematics? If so, which provider and do they have API access?
17. **Equipment GPS coverage:** Do all machines have trackers, or just some? Aftermarket or OEM?
18. **Most common clearing method:** What % of jobs are mulch vs chainsaw/pile vs dozer?
19. **Burn pile management:** CCC burns or customer handles?
20. **Customer communication:** Email, text, or portal preference?
21. **Reseeding:** Offer native grass reseeding after clearing?
22. **Cedar post salvage:** Cut larger cedars for fence posts?

---

## 22. Appendices

### Appendix A: API Reference

| API | Endpoint | Auth |
|-----|----------|------|
| USDA SDA REST | `POST https://SDMDataAccess.sc.egov.usda.gov/Tabular/post.rest` | None |
| USDA SDA WMS | `https://SDMDataAccess.sc.egov.usda.gov/Spatial/SDM.wms` | None |
| UC Davis SoilWeb | `https://casoilresource.lawr.ucdavis.edu/gmap/` | None |
| UC Davis SDE | `https://casoilresource.lawr.ucdavis.edu/sde/?series={name}` | None |
| NAIP ImageServer | `https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer` | None |
| NAIP Texas | `https://imagery.geographic.texas.gov/server/rest/services/NAIP/` | None |
| Sentinel Hub | `https://services.sentinel-hub.com/api/v1/process` | OAuth2 |
| USGS 3DEP | `https://epqs.nationalmap.gov/v1/json` | None |
| CAT ISO 15143-3 | `https://services.cat.com/telematics/iso15143/` | Client ID + Secret |
| Samsara | `https://api.samsara.com/v1/` | Bearer token |
| NodeODM | `http://{host}:3000/task/new` | None (self-hosted) |

### Appendix B: Kerrville Soil Series Reference

| Series | Slope | Depth | Rock | Clearing Notes |
|--------|-------|-------|------|---------------|
| Tarrant | 1 to 8% | Very shallow (6 to 20 in) | Very high | Limestone at surface. Hard on teeth. Premium pricing. |
| Brackett | 5 to 40% | Shallow (10 to 20 in) | High | Steep slopes. Erosion concern. |
| Eckrant | 1 to 8% | Very shallow (6 to 14 in) | Very high | Worst case. Stony clay over limestone. |
| Real | 1 to 8% | Shallow (14 to 20 in) | High | Moderately difficult. |
| Comfort | 0 to 5% | Shallow (14 to 20 in) | Moderate | Average Hill Country. |
| Doss | 1 to 5% | Shallow (10 to 20 in) | Moderate | Soft limestone. Moderate. |
| Krum | 0 to 3% | Deep (60+ in) | Low | Easiest. Watch for mud. |
| Purves | 1 to 5% | Very shallow (6 to 18 in) | High | Similar to Tarrant. |

### Appendix C: NDVI Reference for Hill Country

| Cover Type | Summer NDVI | Winter NDVI | Seasonal Ratio |
|-----------|------------|------------|----------------|
| Dense cedar | 0.55 to 0.75 | 0.50 to 0.70 | 0.85 to 0.95 |
| Live oak | 0.50 to 0.70 | 0.25 to 0.45 | 0.45 to 0.65 |
| Post oak | 0.55 to 0.70 | 0.15 to 0.30 | 0.25 to 0.45 |
| Native grass | 0.40 to 0.65 | 0.10 to 0.25 | 0.20 to 0.35 |
| Bare ground | 0.05 to 0.15 | 0.05 to 0.15 | ~1.0 |

### Appendix D: What This Replaces

| Current Tool | Replaced By | Value |
|-------------|-------------|-------|
| Paper bids / Word templates | Bid engine + PDF | Time savings |
| Google Maps for planning | Satellite AI + soil data | Accuracy |
| Handwritten time sheets | Mobile app + GPS + telematics | Automatic, verified |
| Text messages for scheduling | Scheduling + dispatch | Never miss a job |
| Spreadsheet for equipment hours | Equipment management + telematics | Automatic sync |
| QuickBooks alone | Integrated invoicing | Time + accuracy |
| Memory for customer info | CRM | Never forget a follow-up |
| Gut feel for pricing | AI + feedback loop | 20 to 40% accuracy improvement |
| Nothing for progress | Auto progress from GPS + drone | Customer satisfaction |

---

*End of master plan. Phase 1 through 4 puts a working bid tool in front of customers in 6 to 8 weeks. Everything after that is compounding intelligence on a foundation that already works. The equipment telematics integration (Phase 10) is the piece that makes the feedback loop run on machine-verified data instead of manual estimates, which is the difference between a good prediction model and a great one.*
