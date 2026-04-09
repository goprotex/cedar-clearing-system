# Cactus Creek Clearing — Bid Application Technical Plan

**Client:** Cactus Creek Clearing, Kerrville TX  
**Purpose:** Map based cedar/brush clearing bid tool with soil data integration and professional PDF output  
**Last Updated:** April 2026  

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Application Architecture](#2-application-architecture)
3. [Map and Drawing Engine](#3-map-and-drawing-engine)
4. [Soil Data API Integration](#4-soil-data-api-integration)
5. [Bid Rate Engine and Business Logic](#5-bid-rate-engine-and-business-logic)
6. [PDF Generation](#6-pdf-generation)
7. [Data Model and Database](#7-data-model-and-database)
8. [Authentication and Multi User](#8-authentication-and-multi-user)
9. [Deployment and Infrastructure](#9-deployment-and-infrastructure)
10. [UI/UX Best Practices](#10-uiux-best-practices)
11. [Development Phases](#11-development-phases)
12. [Open Questions for Cactus Creek](#12-open-questions-for-cactus-creek)

---

## 1. Executive Summary

This application lets a clearing operator draw pasture polygons on a satellite map, automatically calculate acreage, pull in USDA soil data for the area, set vegetation type and density per polygon, apply rate multipliers for terrain and soil difficulty, and generate a branded PDF bid document. The goal is a tool that takes 10 minutes instead of 2 hours to produce a quote and looks more professional than anything competitors are handing over.

### Core User Flow

1. Open new bid, enter client/property info
2. Navigate satellite map to the property (search by address, GPS coords, or parcel)
3. Draw one or more pasture polygons
4. For each polygon: select vegetation type, density, terrain, haul off method
5. App auto queries USDA Soil Data Access for soil type, slope %, rock fragment %, and drainage class
6. Soil data feeds difficulty multiplier (rocky shallow soil = slower, deeper loam = faster)
7. Rate engine calculates cost per polygon, sums to total bid
8. User can adjust rates, add line items (mobilization, burn permits, fencing protection, etc.)
9. Generate PDF with satellite map screenshots, polygon overlays, line item breakdown, soil notes, and terms
10. Save bid, email PDF, or print

---

## 2. Application Architecture

### Recommended Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | Next.js 14+ (App Router) | SSR for speed, React ecosystem, file based routing |
| Map | Mapbox GL JS + @mapbox/mapbox-gl-draw | Best satellite imagery, polygon drawing, area calc |
| Geo Math | Turf.js | Acreage from polygons, centroid calc, buffer zones |
| Soil API | USDA NRCS Soil Data Access (SDA) REST | Free, authoritative, polygon query support |
| State | Zustand or React Context | Lightweight, no boilerplate |
| Styling | Tailwind CSS + shadcn/ui | Fast iteration, consistent look |
| PDF | Server side: Puppeteer or Playwright rendering a Next.js route | Full CSS control, map screenshots |
| Database | Supabase (Postgres + Auth + Storage) | Hosted Postgres, row level security, file storage for PDFs |
| Hosting | Vercel | Zero config Next.js, edge functions, auto SSL |
| Domain | cactuscreekclearing.com or similar | Professional appearance |

### Why Not a Mobile App?

A responsive web app is the right call here. The user is typically in a truck or at a desk. PWA (Progressive Web App) support gives offline map caching and home screen install without the App Store overhead. If native mobile becomes needed later, the same API backend supports it.

### Folder Structure

```
/app
  /api
    /soil           — SDA proxy endpoint
    /pdf            — PDF generation endpoint
    /bids           — CRUD for bids
  /bid
    /[id]           — Single bid editor (map + rate engine)
    /new            — New bid creation
  /bids             — Bid list/dashboard
  /settings         — Rate card config, company info
/components
  /map              — MapContainer, DrawControls, SoilOverlay
  /bid              — PastureCard, RateTable, LineItems, BidSummary
  /pdf              — PDFLayout, PDFHeader, PDFMap, PDFLineItems
  /ui               — Shared shadcn components
/lib
  /soil             — SDA query builder, response parser
  /geo              — Turf wrappers, acreage calc, centroid
  /rates            — Rate engine, multiplier logic
  /pdf              — Puppeteer render, screenshot capture
/types              — TypeScript interfaces
```

---

## 3. Map and Drawing Engine

### Mapbox Setup

Mapbox GL JS is the best option for this use case because of high resolution satellite imagery (critical for visually assessing brush density), polygon drawing tools built in, and the ability to style layers for soil and polygon overlays.

**Key Configuration:**

```javascript
// Map initialization
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/satellite-streets-v12',
  center: [-99.1403, 30.0469], // Kerrville TX default center
  zoom: 14,
  pitch: 0,
  bearing: 0,
});

// Drawing controls
const draw = new MapboxDraw({
  displayControlsDefault: false,
  controls: {
    polygon: true,
    trash: true,
  },
  defaultMode: 'simple_select',
  styles: [
    // Custom polygon styling — semi transparent fill with solid border
    {
      id: 'gl-draw-polygon-fill',
      type: 'fill',
      filter: ['all', ['==', '$type', 'Polygon']],
      paint: {
        'fill-color': '#FF6B35',
        'fill-opacity': 0.25,
      },
    },
    {
      id: 'gl-draw-polygon-stroke',
      type: 'line',
      filter: ['all', ['==', '$type', 'Polygon']],
      paint: {
        'line-color': '#FF6B35',
        'line-width': 2,
      },
    },
  ],
});
```

### Acreage Calculation

Use Turf.js `area()` to calculate square meters from the GeoJSON polygon, then convert to acres. This is accurate to within ~0.5% for parcels under 1000 acres, which is more than sufficient for bidding.

```javascript
import * as turf from '@turf/turf';

function calculateAcreage(polygon: GeoJSON.Feature<GeoJSON.Polygon>): number {
  const sqMeters = turf.area(polygon);
  const acres = sqMeters / 4046.8564224;
  return Math.round(acres * 100) / 100; // round to 2 decimals
}
```

### Best Practices for Map UX

1. **Default to satellite view** with street label overlay. Cedar clearing operators need to see the actual vegetation, not a road map.
2. **Snap to property lines** if parcel data is available. Texas county appraisal districts publish parcel GeoJSON. Consider integrating Kerr County CAD data if available.
3. **Label each polygon** with a user assigned pasture name (e.g., "North Pasture", "Creek Bottom") that carries through to the PDF.
4. **Color code polygons** by vegetation type (green for cedar, brown for oak, red for full clear) so the map is instantly readable.
5. **Show acreage in real time** as the user draws. Update the label dynamically on each vertex add.
6. **Allow polygon editing** after creation. Users will want to adjust boundaries.
7. **Support multiple polygons** per bid. A typical ranch job might have 3 to 8 distinct pastures with different clearing specs.
8. **Offline map tiles**: Use Mapbox's offline tile packs for field visits where cell service is spotty. Hill Country has a lot of dead zones.

### Map Screenshot for PDF

Capture the map state (with polygon overlays rendered) as a PNG for embedding in the PDF. Two approaches:

**Option A: Mapbox Static Images API** (recommended for production)
```
https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/
  geojson({GeoJSON_HERE})/
  auto/800x600@2x
  ?access_token=TOKEN
```
This renders server side with no browser needed. Supports GeoJSON overlay. Resolution up to 1280x1280 @2x.

**Option B: Canvas export from the live map**
```javascript
const canvas = map.getCanvas();
const dataUrl = canvas.toDataURL('image/png');
```
This captures exactly what the user sees but requires a browser context (fine for client triggered PDF, not great for server side batch generation).

---

## 4. Soil Data API Integration

### USDA NRCS Soil Data Access (SDA) REST API

This is the primary soil data source. It is free, requires no API key, and covers all of the US at the SSURGO detail level (typically 1:24,000 scale mapping). The Hill Country around Kerrville has complete SSURGO coverage.

**Base Endpoint:**
```
POST https://SDMDataAccess.sc.egov.usda.gov/Tabular/post.rest
```

**How It Works:**

You send a SQL query in the POST body. The query runs against the SSURGO/STATSGO database and returns JSON. You can query by polygon geometry (WKT format), which means we can send the exact drawn polygon and get back soil data for that area.

### Key Soil Properties for Clearing Bids

| Property | Why It Matters | SDA Column |
|----------|---------------|------------|
| Soil series name | Client recognition, bid documentation | `compname` |
| Slope % | Steeper = slower equipment, more fuel | `slope_r` (representative) |
| Rock fragment % | Rocky = harder on equipment, slower | `fragvol_r` in `chfrags` |
| Drainage class | Poorly drained = bogging risk, seasonal limits | `drainagecl` |
| Depth to bedrock | Shallow = can't mulch as deep, roots hit rock | `resdept_r` in `corestrictions` |
| Flooding frequency | Affects scheduling and equipment access | `flodfreqcl` |
| Hydrologic group | Indicates water behavior after rain | `hydgrp` |
| Land capability class | General terrain difficulty indicator | `irrcapcl` or `nirrcapcl` |

### SDA Query: Get Soil Data for a Drawn Polygon

```sql
-- Replace the WKT polygon with the actual drawn polygon coordinates
-- Coordinates must be in WGS84 (EPSG:4326), which Mapbox uses natively

DECLARE @aoi GEOMETRY;
SET @aoi = geometry::STGeomFromText(
  'POLYGON((-99.15 30.05, -99.14 30.05, -99.14 30.04, -99.15 30.04, -99.15 30.05))',
  4326
);

SELECT
  mu.mukey,
  mu.muname,
  mu.mukind,
  co.cokey,
  co.compname,
  co.comppct_r,
  co.slope_r,
  co.slope_l,
  co.slope_h,
  co.drainagecl,
  co.hydgrp,
  co.nirrcapcl,
  co.flodfreqcl,
  co.taxorder,
  co.taxsuborder,
  co.taxsubgrp
FROM
  SDA_Get_Mukey_from_intersection_with_WktWgs84(@aoi) AS mk
  INNER JOIN mapunit AS mu ON mk.mukey = mu.mukey
  INNER JOIN component AS co ON mu.mukey = co.mukey
WHERE
  co.majcompflag = 'Yes'
ORDER BY
  co.comppct_r DESC;
```

### Rock Fragment Query (separate query, joins on cokey)

```sql
SELECT
  ch.cokey,
  ch.hzname,
  ch.hzdept_r,
  ch.hzdepb_r,
  cf.fragvol_r,
  cf.fragsize_r,
  cf.fragkind
FROM
  chorizon AS ch
  LEFT JOIN chfrags AS cf ON ch.chkey = cf.chkey
WHERE
  ch.cokey IN (/* cokeys from first query */)
  AND ch.hzdept_r = 0  -- surface horizon
ORDER BY
  ch.cokey, ch.hzdept_r;
```

### Depth to Bedrock / Restrictive Layer

```sql
SELECT
  co.cokey,
  co.compname,
  cr.resdept_r,
  cr.reskind
FROM
  component AS co
  INNER JOIN corestrictions AS cr ON co.cokey = cr.cokey
WHERE
  co.cokey IN (/* cokeys from first query */)
  AND cr.reskind IN ('Lithic bedrock', 'Paralithic bedrock', 'Densic bedrock')
ORDER BY
  cr.resdept_r;
```

### Next.js API Route: Soil Data Proxy

```typescript
// /app/api/soil/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { polygon } = await req.json();

  // Convert GeoJSON polygon to WKT
  const wkt = geoJsonToWkt(polygon);

  const query = `
    DECLARE @aoi GEOMETRY;
    SET @aoi = geometry::STGeomFromText('${wkt}', 4326);

    SELECT
      mu.mukey, mu.muname,
      co.compname, co.comppct_r, co.slope_r,
      co.drainagecl, co.hydgrp, co.nirrcapcl,
      co.flodfreqcl
    FROM
      SDA_Get_Mukey_from_intersection_with_WktWgs84(@aoi) AS mk
      INNER JOIN mapunit AS mu ON mk.mukey = mu.mukey
      INNER JOIN component AS co ON mu.mukey = co.mukey
    WHERE co.majcompflag = 'Yes'
    ORDER BY co.comppct_r DESC;
  `;

  const sdaResponse = await fetch(
    'https://SDMDataAccess.sc.egov.usda.gov/Tabular/post.rest',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, format: 'JSON' }),
    }
  );

  const data = await sdaResponse.json();
  return NextResponse.json(parseSdaResponse(data));
}

function geoJsonToWkt(geojson: GeoJSON.Polygon): string {
  const coords = geojson.coordinates[0]
    .map(([lng, lat]) => `${lng} ${lat}`)
    .join(', ');
  return `POLYGON((${coords}))`;
}

function parseSdaResponse(data: any) {
  // SDA returns { Table: [ [col1, col2, ...], [val1, val2, ...], ... ] }
  if (!data?.Table || data.Table.length < 2) return [];

  const headers = data.Table[0];
  return data.Table.slice(1).map((row: any[]) => {
    const obj: Record<string, any> = {};
    headers.forEach((h: string, i: number) => {
      obj[h] = row[i];
    });
    return obj;
  });
}
```

### UC Davis SoilWeb API (Alternative/Supplement)

The UC Davis California Soil Resource Lab also provides a SoilWeb interface that wraps SSURGO data with a cleaner API for point queries. Useful as a backup or for quick lookups:

```
GET https://casoilresource.lawr.ucdavis.edu/soil_web/query.php?lon=-99.14&lat=30.05
```

This returns soil series info for a single point. Less powerful than SDA polygon queries but simpler to integrate for quick spot checks.

### Soil Data to Difficulty Multiplier Mapping

This is the logic that translates raw soil data into a bid adjustment factor. These multipliers should be configurable in the settings panel.

```typescript
interface SoilDifficultyFactors {
  slopeMultiplier: number;
  rockMultiplier: number;
  drainageMultiplier: number;
  bedrockMultiplier: number;
}

function calculateSoilDifficulty(soilData: SoilRecord): SoilDifficultyFactors {
  // Slope factor
  let slopeMultiplier = 1.0;
  if (soilData.slope_r > 20) slopeMultiplier = 1.5;       // steep
  else if (soilData.slope_r > 12) slopeMultiplier = 1.25;  // moderate slope
  else if (soilData.slope_r > 5) slopeMultiplier = 1.1;    // gentle slope

  // Rock fragment factor (surface horizon)
  let rockMultiplier = 1.0;
  if (soilData.fragvol_r > 50) rockMultiplier = 1.4;       // extremely rocky
  else if (soilData.fragvol_r > 25) rockMultiplier = 1.2;  // rocky
  else if (soilData.fragvol_r > 10) rockMultiplier = 1.1;  // somewhat rocky

  // Drainage factor
  let drainageMultiplier = 1.0;
  if (soilData.drainagecl === 'Poorly drained') drainageMultiplier = 1.3;
  else if (soilData.drainagecl === 'Somewhat poorly drained') drainageMultiplier = 1.15;

  // Bedrock depth factor
  let bedrockMultiplier = 1.0;
  if (soilData.resdept_r && soilData.resdept_r < 25) bedrockMultiplier = 1.3;     // very shallow
  else if (soilData.resdept_r && soilData.resdept_r < 50) bedrockMultiplier = 1.15; // shallow

  return { slopeMultiplier, rockMultiplier, drainageMultiplier, bedrockMultiplier };
}

function combinedSoilMultiplier(factors: SoilDifficultyFactors): number {
  // Use geometric mean to prevent extreme stacking
  const product =
    factors.slopeMultiplier *
    factors.rockMultiplier *
    factors.drainageMultiplier *
    factors.bedrockMultiplier;
  return Math.round(product * 100) / 100;
}
```

### Soil Data Best Practices

1. **Cache aggressively.** SSURGO data changes at most once per year (annual refresh, typically September/October). Cache soil results by polygon hash in your database. No reason to hit SDA more than once per location.
2. **Handle mixed soil polygons.** A drawn pasture often overlaps multiple SSURGO map units. Weight the difficulty multiplier by `comppct_r` (component percentage) to get a blended factor.
3. **Show soil data to the user** as informational, not black box. The operator knows the land better than the database. Let them override the soil difficulty multiplier manually.
4. **Display soil map units on the map** as a toggleable layer. Use the SDA WMS endpoint to overlay soil boundaries:
   ```
   https://SDMDataAccess.sc.egov.usda.gov/Spatial/SDM.wms
     ?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap
     &LAYERS=mapunitpoly
     &BBOX={west},{south},{east},{north}
     &SRS=EPSG:4326
     &WIDTH=800&HEIGHT=600
     &FORMAT=image/png
     &TRANSPARENT=true
   ```
5. **Handle API failures gracefully.** SDA is a government service and occasionally goes down. The app should work without soil data (just skip the auto multiplier and let the user set difficulty manually).
6. **Hill Country specific note:** The Kerrville area is predominantly Tarrant, Brackett, Real, Eckrant, and Comfort soil series. These are generally shallow, rocky, calcareous soils over limestone. Default terrain difficulty in the Hill Country should lean toward "moderate to difficult" unless the soil data says otherwise. This is not flat blackland prairie.

---

## 5. Bid Rate Engine and Business Logic

### Rate Card Structure

The rate card is the heart of the app. It needs to be fully configurable per user/company in the settings panel. Default values should be set during onboarding.

```typescript
interface RateCard {
  // Base rates per acre by vegetation type
  baseRates: {
    cedarOnly: number;       // e.g., $350/acre
    oakOnly: number;         // e.g., $450/acre
    mixedBrush: number;      // e.g., $400/acre
    fullClear: number;       // e.g., $500/acre
    selectiveThin: number;   // e.g., $275/acre
    mesquiteOnly: number;    // e.g., $325/acre
  };

  // Density multipliers
  densityMultipliers: {
    light: number;           // e.g., 0.75
    moderate: number;        // e.g., 1.0
    heavy: number;           // e.g., 1.35
    extreme: number;         // e.g., 1.65
  };

  // Terrain multipliers (manual override available)
  terrainMultipliers: {
    flat: number;            // e.g., 1.0
    moderateSlope: number;   // e.g., 1.15
    steep: number;           // e.g., 1.35
    steepRocky: number;      // e.g., 1.55
  };

  // Disposal method adjustments (added per acre)
  disposalAdders: {
    stackAndBurn: number;    // e.g., $50/acre
    mulchInPlace: number;    // e.g., $0
    haulOff: number;         // e.g., $150/acre
    chipAndSpread: number;   // e.g., $75/acre
  };

  // Fixed line items
  fixedItems: {
    mobilization: number;          // e.g., $500 to $2500
    burnPermit: number;            // e.g., $0 (depends on county)
    fenceProtectionPerFoot: number; // e.g., $1.50/ft
    waterBarPerUnit: number;        // e.g., $200
    erosionControlPerFoot: number;  // e.g., $3.00/ft
  };

  // Time estimates (hours per acre, used for scheduling not pricing)
  timeEstimates: {
    cedarLightHrsPerAcre: number;    // e.g., 1.5
    cedarModerateHrsPerAcre: number; // e.g., 2.5
    cedarHeavyHrsPerAcre: number;    // e.g., 4.0
    // ... etc per type
  };

  // Minimum job size
  minimumBidAmount: number;  // e.g., $2500
}
```

### Bid Calculation Formula

For each pasture polygon:

```
pastureCost =
  acreage
  × baseRate[vegetationType]
  × densityMultiplier[density]
  × max(terrainMultiplier[terrain], soilDifficultyMultiplier)
  + (acreage × disposalAdder[disposalMethod])
```

**Why max() on terrain vs soil:** The operator's visual terrain assessment and the USDA soil data might disagree. Use whichever produces the higher (more conservative) multiplier. The operator can always override.

Total bid:

```
totalBid =
  sum(allPastureCosts)
  + mobilization
  + burnPermit (if applicable)
  + fenceProtection (linear feet × rate)
  + customLineItems
  + contingency (optional %)
```

### Time Estimate Calculation

Separate from pricing but shown on the bid for scheduling purposes:

```
estimatedDays =
  sum(acreage × hrsPerAcre[type][density] × terrainMultiplier)
  / workHoursPerDay (typically 8 to 10)
```

Show this as a range (best case / worst case) on the bid document.

### Best Practices for the Rate Engine

1. **Never hardcode rates.** Everything comes from the rate card in settings. The operator needs to adjust rates seasonally and per market.
2. **Show the math.** The PDF should break down each multiplier applied so the client can see how the number was derived. Transparency builds trust.
3. **Round to sensible numbers.** Nobody bids $12,347.63 for a clearing job. Round to nearest $50 or $100 and make the rounding direction configurable (up, down, nearest).
4. **Minimum bid floor.** Small pastures (under 5 acres) often aren't worth mobilizing for. The rate card should enforce a minimum.
5. **Discount for volume.** Consider a slider or auto discount for jobs over 50, 100, 200 acres. Common in the clearing business.
6. **Validity period.** Default 30 day bid validity. Fuel prices and equipment costs change.

---

## 6. PDF Generation

### Approach: Puppeteer Rendering a Hidden Next.js Route

The cleanest way to produce a professional PDF is to build the bid document as a dedicated Next.js page (not publicly routed) and render it to PDF with Puppeteer on the server. This gives full CSS control, custom fonts, map images, and pixel perfect layout.

**Why not react-pdf?** react-pdf uses its own layout engine (Yoga) which doesn't support full CSS. For a professional document with map images, tables, and brand styling, Puppeteer HTML to PDF is far more flexible.

### PDF Layout Specification

**Page 1: Cover**
- Company logo (top left)
- "Clearing Proposal" title
- Client name and property address
- Date and bid number
- Prepared by (operator name, phone, email)

**Page 2: Property Overview**
- Satellite map screenshot with all pasture polygons overlaid and labeled
- Property summary table: total acreage, total pasture count, estimated duration
- Soil summary: dominant soil series, average slope, terrain difficulty rating

**Page 3+: Pasture Detail (one section per pasture, can span pages)**
- Pasture name and zoomed map screenshot
- Acreage, vegetation type, density, terrain
- Soil data callout (series name, slope range, rock fragment %, drainage)
- Line item breakdown for that pasture
- Subtotal

**Final Page: Bid Summary**
- Pasture subtotals table
- Additional line items (mobilization, permits, etc.)
- Total bid amount (prominent, large font)
- Estimated start/completion timeline
- Payment terms and conditions
- Signature lines (client and contractor)
- Validity date
- Insurance and license info

### PDF Generation Endpoint

```typescript
// /app/api/pdf/route.ts
import puppeteer from 'puppeteer';

export async function POST(req: NextRequest) {
  const { bidId } = await req.json();

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox'],
  });

  const page = await browser.newPage();

  // Navigate to the internal PDF layout route
  await page.goto(
    `${process.env.APP_URL}/pdf-render/${bidId}`,
    { waitUntil: 'networkidle0' }
  );

  const pdfBuffer = await page.pdf({
    format: 'Letter',
    printBackground: true,
    margin: { top: '0.5in', bottom: '0.75in', left: '0.5in', right: '0.5in' },
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: `
      <div style="font-size:9px; width:100%; text-align:center; color:#888;">
        Cactus Creek Clearing — Bid #<span class="title"></span> — Page <span class="pageNumber"></span> of <span class="totalPages"></span>
      </div>
    `,
  });

  await browser.close();

  return new NextResponse(pdfBuffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="CCC-Bid-${bidId}.pdf"`,
    },
  });
}
```

### PDF Best Practices

1. **Use print CSS** (`@media print`) for the PDF render route. Disable hover effects, navigation, and interactive elements.
2. **Embed map images as base64** in the HTML rather than external URLs. Puppeteer sometimes fails to load external images in time.
3. **Fixed page breaks.** Use `page-break-before: always` between major sections. Never let a pasture detail section split awkwardly across pages.
4. **Font embedding.** Use web fonts loaded via `<link>` in the PDF route. Google Fonts work fine in Puppeteer. A clean sans serif like Inter or Plus Jakarta Sans looks professional.
5. **Terms and conditions** should be stored as a configurable text block in settings, not hardcoded.
6. **Version the PDF.** Store the generated PDF in Supabase Storage with the bid ID and timestamp. If the bid is modified and regenerated, keep the old version.
7. **Watermark for drafts.** If the bid is marked "draft," overlay a diagonal watermark. Easy with CSS `transform: rotate(-45deg)` on a fixed position element.

### Alternative: Edge Hosted PDF with @react-pdf/renderer

If Puppeteer's server requirements are too heavy (it needs a Chromium binary), consider `@react-pdf/renderer` as a lighter weight option. The layout engine is more limited but sufficient for simpler designs. Can run on Vercel Edge Functions without a headless browser.

---

## 7. Data Model and Database

### Supabase Postgres Schema

```sql
-- Companies
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  logo_url TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  license_number TEXT,
  insurance_info TEXT,
  terms_and_conditions TEXT,
  rate_card JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Users (linked to Supabase Auth)
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  company_id UUID REFERENCES companies(id),
  full_name TEXT NOT NULL,
  role TEXT DEFAULT 'operator',  -- 'owner', 'operator', 'viewer'
  phone TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Clients (property owners they bid for)
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Bids
CREATE TABLE bids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  client_id UUID REFERENCES clients(id),
  created_by UUID REFERENCES users(id),
  bid_number TEXT NOT NULL,  -- auto generated, e.g., "CCC-2026-0042"
  status TEXT DEFAULT 'draft',  -- 'draft', 'sent', 'accepted', 'declined', 'expired'
  property_name TEXT,
  property_address TEXT,
  property_center JSONB,  -- { lng, lat }
  map_zoom REAL,
  total_acreage REAL,
  total_amount NUMERIC(12,2),
  estimated_days_low REAL,
  estimated_days_high REAL,
  mobilization_fee NUMERIC(10,2) DEFAULT 0,
  burn_permit_fee NUMERIC(10,2) DEFAULT 0,
  custom_line_items JSONB DEFAULT '[]',
  contingency_pct REAL DEFAULT 0,
  discount_pct REAL DEFAULT 0,
  notes TEXT,
  valid_until DATE,
  rate_card_snapshot JSONB,  -- snapshot of rate card at time of bid
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Pastures (polygons within a bid)
CREATE TABLE pastures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id UUID REFERENCES bids(id) ON DELETE CASCADE,
  name TEXT NOT NULL,  -- "North Pasture"
  sort_order INT DEFAULT 0,
  polygon JSONB NOT NULL,  -- GeoJSON Feature
  acreage REAL NOT NULL,
  centroid JSONB,  -- { lng, lat }
  vegetation_type TEXT NOT NULL,  -- 'cedar', 'oak', 'mixed', 'full_clear', etc.
  density TEXT NOT NULL,  -- 'light', 'moderate', 'heavy', 'extreme'
  terrain TEXT NOT NULL,  -- 'flat', 'moderate_slope', 'steep', 'steep_rocky'
  disposal_method TEXT NOT NULL,  -- 'stack_burn', 'mulch', 'haul_off', 'chip_spread'
  soil_data JSONB,  -- cached SDA response
  soil_multiplier REAL DEFAULT 1.0,
  soil_multiplier_override REAL,  -- user override
  subtotal NUMERIC(10,2),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- PDF versions
CREATE TABLE pdf_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id UUID REFERENCES bids(id) ON DELETE CASCADE,
  version INT NOT NULL,
  file_url TEXT NOT NULL,  -- Supabase Storage URL
  generated_at TIMESTAMPTZ DEFAULT now()
);

-- Soil cache (avoid repeat SDA queries)
CREATE TABLE soil_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  polygon_hash TEXT UNIQUE NOT NULL,  -- MD5 of WKT polygon
  soil_data JSONB NOT NULL,
  queried_at TIMESTAMPTZ DEFAULT now()
);

-- Row Level Security
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE pastures ENABLE ROW LEVEL SECURITY;
-- Policies: users can only see/edit their own company's data
```

### Indexing

```sql
CREATE INDEX idx_bids_company ON bids(company_id);
CREATE INDEX idx_bids_client ON bids(client_id);
CREATE INDEX idx_bids_status ON bids(status);
CREATE INDEX idx_pastures_bid ON pastures(bid_id);
CREATE INDEX idx_soil_cache_hash ON soil_cache(polygon_hash);
```

---

## 8. Authentication and Multi User

### Supabase Auth

Use Supabase Auth with email/password signup. Magic link (passwordless) is a nice upgrade for operators who hate remembering passwords.

**Role structure:**
- **Owner:** Full access. Can edit rate card, company settings, manage users, view all bids.
- **Operator:** Can create and edit bids, generate PDFs. Cannot change rate card or company settings.
- **Viewer:** Read only. Good for bookkeepers or partners who need to see bids but not modify.

### Row Level Security (RLS)

Every table should have RLS policies that restrict access to the user's company. This is non negotiable for a multi tenant setup where you might eventually onboard other clearing companies.

```sql
CREATE POLICY "Users can view their company's bids"
  ON bids FOR SELECT
  USING (company_id = (SELECT company_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can insert bids for their company"
  ON bids FOR INSERT
  WITH CHECK (company_id = (SELECT company_id FROM users WHERE id = auth.uid()));
```

---

## 9. Deployment and Infrastructure

### Vercel Configuration

- **Framework:** Next.js (auto detected)
- **Node version:** 20.x
- **Environment variables:** Mapbox token, Supabase URL/anon key, app URL
- **Functions:** Default region `iad1` (US East). Consider `dfw1` (Dallas) for lower latency to Kerrville.
- **Serverless function timeout:** Increase to 60s for PDF generation (Puppeteer is slow on cold start)

### Puppeteer on Vercel

Vercel's serverless functions have a 50MB limit and don't include Chromium by default. Options:

1. **@sparticuz/chromium** — Chromium binary optimized for AWS Lambda / Vercel. Works but adds ~45MB to the function.
2. **External PDF service** — Use a dedicated service like Browserless.io or run your own Puppeteer container on Railway/Render. Cleaner separation, no cold start issues.
3. **Vercel OG Image generation** — Not suitable for multi page PDFs but worth noting for social share images.

**Recommendation:** Start with `@sparticuz/chromium` on Vercel for simplicity. If cold starts become a problem (they will for the first PDF of the day), move PDF generation to a dedicated Railway container with persistent Chromium.

### Domain and SSL

- Custom domain via Vercel (automatic SSL)
- Consider `bid.cactuscreekclearing.com` as subdomain if they already have a main site

### Costs Estimate

| Service | Monthly Cost |
|---------|-------------|
| Vercel Pro | $20 |
| Supabase Pro | $25 |
| Mapbox (under 50k loads) | Free tier |
| Domain | ~$12/year |
| Browserless.io (if needed) | $0 to $50 |
| **Total** | **~$50 to $100/month** |

---

## 10. UI/UX Best Practices

### Design Principles for Field Use

1. **Large touch targets.** The operator might be using this on a tablet in a truck. Buttons should be at least 44px tall.
2. **High contrast.** Satellite map backgrounds make overlays hard to read. Use solid colored panels with slight opacity, not transparent overlays.
3. **Minimal typing.** Use dropdowns, toggles, and sliders wherever possible. The vegetation type, density, and terrain selectors should be single tap selections, not text fields.
4. **Auto save.** Save bid state to Supabase on every change. Nobody should lose work because they closed a browser tab.
5. **Responsive but desktop first.** The primary use case is a laptop or desktop with a large screen for the map. Mobile should work but doesn't need to be the primary target.
6. **Loading states.** Soil API calls take 2 to 5 seconds. Show a skeleton loader on the soil data panel, not a blank space.
7. **Undo support.** Allow undoing polygon edits and rate changes. Store a simple state history stack.

### Color Palette Suggestion

For Cactus Creek Clearing, use earth tones that evoke the Hill Country landscape:

| Use | Color | Hex |
|-----|-------|-----|
| Primary (buttons, accents) | Deep sage green | #4A6741 |
| Secondary | Warm tan / caliche | #C4A76C |
| Danger / alert | Burnt orange | #CC5500 |
| Background | Off white | #F5F2EB |
| Text | Charcoal | #2D2D2D |
| Map polygon fill | Orange (semi transparent) | #FF6B35 @ 25% |
| Map polygon stroke | Orange solid | #FF6B35 |

These should be confirmed with the client. If they have existing brand colors, use those.

---

## 11. Development Phases

### Phase 1: Core MVP (2 to 3 weeks)

- Next.js project scaffold with Tailwind and shadcn/ui
- Mapbox integration with satellite view and polygon drawing
- Acreage calculation with Turf.js
- Pasture form: vegetation type, density, terrain, disposal method
- Basic rate engine with hardcoded default rates
- Simple bid summary (no PDF yet, just on screen total)
- Supabase: bids and pastures tables, basic auth

**Deliverable:** Working bid calculator with map. User can draw polygons, set parameters, and see a total.

### Phase 2: Soil Integration + Rate Card (1 to 2 weeks)

- USDA SDA API integration (proxy route, query builder, response parser)
- Soil data display per pasture (series name, slope, rock %, drainage)
- Auto soil difficulty multiplier with manual override
- Soil data caching in Postgres
- Configurable rate card in settings
- Soil map unit overlay toggle on the map

**Deliverable:** Soil data automatically populates and adjusts bid pricing. Rate card is fully editable.

### Phase 3: PDF Generation (1 to 2 weeks)

- PDF render route with cover, map, pasture details, and summary
- Puppeteer or Browserless integration
- Map screenshot capture (Mapbox Static Images API)
- Branded header/footer with company info
- Version tracking in database
- Email PDF option (integrate SendGrid or Resend)

**Deliverable:** Professional PDF bids that can be generated, downloaded, and emailed.

### Phase 4: Polish and Launch (1 week)

- Client management (create/edit clients, associate with bids)
- Bid status tracking (draft, sent, accepted, declined, expired)
- Dashboard with bid list, filters, and search
- Auto bid numbering (CCC-2026-XXXX)
- Duplicate bid feature (common for repeat clients or similar properties)
- PWA manifest for home screen install
- Performance optimization and error handling

**Deliverable:** Production ready application.

### Phase 5: Future Enhancements (ongoing)

- Photo upload per pasture (before photos, attach to bid)
- GPS track recording (walk the property, auto create polygon from track)
- Client portal (client logs in, views their bids, signs electronically)
- QuickBooks or accounting integration
- Equipment tracking (which machine assigned to which job)
- Progress tracking post award (% complete per pasture)
- Historical bid analytics (win rate, average $/acre by area)
- NAIP (National Agriculture Imagery Program) aerial imagery layers as alternative to Mapbox satellite
- Elevation profile along a polygon edge using USGS 3DEP API
- Integration with Texas county appraisal district parcel data for auto property boundary loading

---

## 12. Open Questions for Cactus Creek

These need answers before development starts:

1. **Rate card:** What are the actual $/acre rates by vegetation type and density? Get the full rate sheet.
2. **Equipment list:** What machines do they run? (Forestry mulcher on skid steer, dozer, excavator with mulcher head?) This affects time estimates.
3. **Disposal methods:** Do they primarily mulch in place, stack and burn, or haul off? What's the preference hierarchy?
4. **Burn permit process:** Is this a county level permit in Kerr County? Is there a cost? Do they handle it or does the client?
5. **Logo and brand:** Get the logo in SVG or high res PNG. Get any brand guidelines or existing marketing materials.
6. **Terms and conditions:** Do they have existing bid T&C language, or do they need it written?
7. **Insurance info:** What insurance details should appear on the bid? (General liability, workers comp policy numbers?)
8. **Typical job range:** What's the smallest job they'll take? Largest they've done? This sizes the rate card bounds.
9. **Multi user:** Is it just the owner using this, or does a crew lead also need access?
10. **Existing website/domain:** Do they have a website? Should this live on a subdomain?
11. **Competitors:** Who else bids against them? What do competitor bids look like? (Helps design a PDF that stands out.)
12. **Payment terms:** Net 30? 50% deposit? Progress payments on larger jobs?

---

## Appendix A: USDA SDA API Reference Quick Sheet

| Endpoint | URL |
|----------|-----|
| REST Query | `POST https://SDMDataAccess.sc.egov.usda.gov/Tabular/post.rest` |
| SOAP Service | `https://SDMDataAccess.sc.egov.usda.gov/Tabular/SDMTabularService.asmx` |
| WMS Map Tiles | `https://SDMDataAccess.sc.egov.usda.gov/Spatial/SDM.wms` |
| WFS Features | `https://SDMDataAccess.sc.egov.usda.gov/Spatial/SDMWGS84Geographic.wfs` |
| Help / Docs | `https://sdmdataaccess.nrcs.usda.gov/WebServiceHelp.aspx` |
| Query Examples | `https://sdmdataaccess.nrcs.usda.gov/QueryHelp.aspx` |

**POST body format for REST:**
```json
{
  "query": "SELECT ... FROM ...",
  "format": "JSON"
}
```

**No API key required.** Rate limiting is informal but don't hammer it. Cache everything.

## Appendix B: Kerrville Area Soil Series Quick Reference

Common soil series in the Kerrville/Kerr County area and their clearing implications:

| Soil Series | Typical Slope | Depth | Rock | Clearing Notes |
|------------|---------------|-------|------|----------------|
| Tarrant | 1 to 8% | Very shallow (6 to 20 in) | Very high | Limestone at surface. Hard on equipment. Premium pricing. |
| Brackett | 5 to 40% | Shallow (10 to 20 in) | High | Steep slopes common. Erosion concern post clear. |
| Eckrant | 1 to 8% | Very shallow (6 to 14 in) | Very high | Stony clay over limestone. Mulcher heads take a beating. |
| Real | 1 to 8% | Shallow (14 to 20 in) | High | Gravelly clay loam. Moderately difficult. |
| Comfort | 0 to 5% | Shallow (14 to 20 in) | Moderate | Better than Tarrant/Eckrant. Moderately stony. |
| Doss | 1 to 5% | Shallow (10 to 20 in) | Moderate | Silty clay over soft limestone. Moderate difficulty. |
| Krum | 0 to 3% | Deep (60+ in) | Low | Deep clay. Easiest to clear. Watch for mud when wet. |
| Purves | 1 to 5% | Very shallow (6 to 18 in) | High | Similar to Tarrant. Premium terrain multiplier. |

This reference can be shown in the app as a tooltip when soil data is returned, giving the operator instant context on what that soil series means for their job.

---

*End of planning document. Ready to begin Phase 1 development on confirmation of rate card and brand assets.*
