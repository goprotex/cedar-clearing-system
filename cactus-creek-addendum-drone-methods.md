# Cactus Creek Clearing — Plan Addendum: Drone, Progress Tracking, and Clearing Methods

**Addendum to:** v2 Plan  
**Date:** April 2026  

---

## Table of Contents

1. [Drone Image Upload and Photogrammetry](#1-drone-image-upload-and-photogrammetry)
2. [Progress Tracking with Drone Flyovers](#2-progress-tracking-with-drone-flyovers)
3. [Clearing Method Matrix and Bid Customization](#3-clearing-method-matrix-and-bid-customization)
4. [Updated Database Schema](#4-updated-database-schema)
5. [Updated Development Phases](#5-updated-development-phases)

---

## 1. Drone Image Upload and Photogrammetry

### Why Drone Data Changes Everything

Satellite imagery maxes out at 0.3 to 0.6m resolution (NAIP). A consumer drone like a DJI Mini 4 Pro shoots at 1 to 2cm per pixel, which is 30 to 60 times more detail. At drone resolution you can see individual branches, estimate trunk diameter, and distinguish a 6 foot cedar from a 20 foot cedar with high confidence. This is the difference between "there's vegetation here" and "there are 47 cedar trees in this section, 12 of them over 15 feet tall."

Drone imagery also solves the satellite data freshness problem. NAIP for Texas was last flown in 2022. A drone flight gives you imagery from this morning.

### How It Works: The Upload Pipeline

```
Crew flies drone over property (grid pattern, 200ft AGL)
       |
       v
Upload JPGs to the app (drag and drop or mobile upload)
       |
       v
App extracts EXIF GPS data from each image
       |
       v
Images sent to processing service (OpenDroneMap)
       |
       v
ODM produces:
  ├── Orthomosaic (stitched aerial photo, georeferenced GeoTIFF)
  ├── Digital Elevation Model (DEM, height map)
  ├── Digital Surface Model (DSM, includes trees and structures)
  ├── 3D point cloud (LAS/LAZ format)
  └── 3D textured mesh (OBJ format)
       |
       v
App overlays orthomosaic on the map (replaces satellite tiles)
       |
       v
AI analysis runs on drone imagery instead of satellite
  ├── Tree detection at 2cm resolution (individual tree level)
  ├── Canopy diameter measured precisely
  ├── DSM minus DEM = Canopy Height Model (actual tree heights)
  ├── Species classification from texture/color at high res
  └── Density heatmap at sub-meter accuracy
       |
       v
Results feed into bid engine with much higher confidence score
```

### EXIF GPS Extraction

Every drone photo embeds GPS coordinates, altitude, camera angle, and timestamp in the EXIF metadata. The app extracts this to geolocate each image on the map before processing.

```typescript
// Client-side EXIF extraction using exifr library
import exifr from 'exifr';

interface DroneImageMeta {
  filename: string;
  latitude: number;
  longitude: number;
  altitude: number;  // meters above sea level
  relativeAltitude: number;  // meters above takeoff point
  heading: number;  // compass direction camera faced
  pitch: number;  // camera tilt angle
  timestamp: Date;
  cameraModel: string;
  imageWidth: number;
  imageHeight: number;
  focalLength: number;
}

async function extractDroneExif(file: File): Promise<DroneImageMeta> {
  const exif = await exifr.parse(file, {
    gps: true,
    xmp: true,  // DJI stores flight data in XMP
    ifd0: true,
  });

  return {
    filename: file.name,
    latitude: exif.latitude,
    longitude: exif.longitude,
    altitude: exif.GPSAltitude,
    relativeAltitude: exif.RelativeAltitude || exif.GPSAltitude,
    heading: exif.GimbalYawDegree || exif.GPSImgDirection || 0,
    pitch: exif.GimbalPitchDegree || -90,
    timestamp: exif.DateTimeOriginal || exif.CreateDate,
    cameraModel: `${exif.Make} ${exif.Model}`,
    imageWidth: exif.ImageWidth || exif.ExifImageWidth,
    imageHeight: exif.ImageHeight || exif.ExifImageHeight,
    focalLength: exif.FocalLength,
  };
}

// Process batch of uploaded drone images
async function processUploadedImages(files: File[]): Promise<{
  images: DroneImageMeta[];
  boundingBox: [number, number, number, number];
  coverage: GeoJSON.Polygon;
}> {
  const images = await Promise.all(files.map(extractDroneExif));
  
  // Calculate bounding box of all image locations
  const lats = images.map(i => i.latitude);
  const lngs = images.map(i => i.longitude);
  const bbox: [number, number, number, number] = [
    Math.min(...lngs), Math.min(...lats),
    Math.max(...lngs), Math.max(...lats),
  ];
  
  // Create convex hull polygon of flight coverage area
  const points = turf.featureCollection(
    images.map(i => turf.point([i.longitude, i.latitude]))
  );
  const coverage = turf.convex(points);
  
  return { images, boundingBox: bbox, coverage: coverage.geometry };
}
```

### OpenDroneMap Integration

OpenDroneMap (ODM) is the open source standard for drone photogrammetry. It takes overlapping drone photos and produces georeferenced orthomosaics, elevation models, and 3D point clouds.

**Two integration options:**

**Option A: Self-hosted NodeODM (Recommended for Volume)**

Run a NodeODM instance on Railway or a dedicated server. It exposes a REST API for submitting processing tasks.

```typescript
// Submit drone images to NodeODM for processing
async function submitToODM(
  imageUrls: string[],
  options: Record<string, any> = {}
): Promise<string> {
  const formData = new FormData();
  
  // ODM processing options
  const odmOptions = JSON.stringify([
    { name: 'dsm', value: true },           // Digital Surface Model
    { name: 'dtm', value: true },           // Digital Terrain Model
    { name: 'orthophoto-resolution', value: 2 },  // 2 cm/pixel
    { name: 'dem-resolution', value: 5 },    // 5 cm/pixel for DEM
    { name: 'pc-quality', value: 'high' },   // Point cloud quality
    { name: 'feature-quality', value: 'high' },
    { name: 'min-num-features', value: 10000 },
    { name: 'auto-boundary', value: true },
    ...Object.entries(options).map(([name, value]) => ({ name, value })),
  ]);
  
  formData.append('options', odmOptions);
  
  // Attach images
  for (const url of imageUrls) {
    const response = await fetch(url);
    const blob = await response.blob();
    formData.append('images', blob);
  }
  
  // Submit task
  const result = await fetch(`${NODEODM_URL}/task/new`, {
    method: 'POST',
    body: formData,
  });
  
  const task = await result.json();
  return task.uuid; // Use this to poll for completion
}

// Poll task status
async function checkODMTaskStatus(taskId: string): Promise<{
  status: string;
  progress: number;
  outputs?: {
    orthophotoUrl: string;
    dsmUrl: string;
    dtmUrl: string;
    pointCloudUrl: string;
  };
}> {
  const result = await fetch(`${NODEODM_URL}/task/${taskId}/info`);
  const info = await result.json();
  
  if (info.status.code === 40) { // COMPLETED
    return {
      status: 'completed',
      progress: 100,
      outputs: {
        orthophotoUrl: `${NODEODM_URL}/task/${taskId}/download/orthophoto.tif`,
        dsmUrl: `${NODEODM_URL}/task/${taskId}/download/dsm.tif`,
        dtmUrl: `${NODEODM_URL}/task/${taskId}/download/dtm.tif`,
        pointCloudUrl: `${NODEODM_URL}/task/${taskId}/download/georeferenced_model.laz`,
      },
    };
  }
  
  return {
    status: info.status.code === 20 ? 'processing' : 'queued',
    progress: info.progress || 0,
  };
}
```

**Option B: WebODM Lightning (Cloud Service, Easier)**

For lower volume or to avoid self-hosting, use WebODM Lightning. They handle all the compute for ~$30/month plus per-task credits. Submit via their API and get results back.

**Processing time estimates:**
- 50 to 100 images: 15 to 30 minutes
- 200 to 500 images: 45 to 90 minutes  
- 500+ images: 2 to 4 hours

A typical pasture survey (50 to 100 acres) with a DJI drone at 200 foot altitude produces about 200 to 400 images.

### Canopy Height Model: Actual Tree Heights from Drone Data

This is the magic of having both a DSM (Digital Surface Model, includes trees) and a DTM (Digital Terrain Model, bare earth). Subtract one from the other and you get the actual height of everything above ground.

```python
import rasterio
import numpy as np

def compute_canopy_height_model(dsm_path: str, dtm_path: str) -> np.ndarray:
    """
    CHM = DSM - DTM
    DSM includes trees, buildings, etc.
    DTM is bare earth.
    Difference = height of objects above ground.
    """
    with rasterio.open(dsm_path) as dsm_src:
        dsm = dsm_src.read(1)
        transform = dsm_src.transform
        crs = dsm_src.crs
    
    with rasterio.open(dtm_path) as dtm_src:
        dtm = dtm_src.read(1)
    
    # Canopy Height Model
    chm = dsm - dtm
    
    # Clean up: anything below 1m is ground noise, anything above 30m is error
    chm = np.clip(chm, 0, 30)
    
    return chm, transform, crs


def extract_tree_heights_from_chm(chm: np.ndarray, pixel_size_m: float = 0.05) -> list[dict]:
    """
    Find individual tree peaks in the CHM.
    Uses local maxima detection to find tree tops.
    """
    from scipy.ndimage import maximum_filter, label
    from skimage.feature import peak_local_max
    
    # Smooth to reduce noise (5x5 window at 5cm resolution = 25cm smooth)
    from scipy.ndimage import gaussian_filter
    chm_smooth = gaussian_filter(chm, sigma=3)
    
    # Find local maxima (tree tops)
    # Minimum height threshold: 1.5m (about 5 feet)
    # Minimum distance between trees: 1m
    min_distance_pixels = int(1.0 / pixel_size_m)
    
    coordinates = peak_local_max(
        chm_smooth,
        min_distance=min_distance_pixels,
        threshold_abs=1.5,  # meters, minimum tree height
    )
    
    trees = []
    for row, col in coordinates:
        height_m = chm[row, col]
        height_ft = height_m * 3.28084
        
        # Estimate canopy radius by finding extent of connected canopy
        # around this peak (where CHM > 50% of peak height)
        threshold = height_m * 0.5
        neighborhood = chm[
            max(0, row-50):min(chm.shape[0], row+50),
            max(0, col-50):min(chm.shape[1], col+50)
        ]
        canopy_pixels = np.sum(neighborhood > threshold)
        canopy_area_sqm = canopy_pixels * (pixel_size_m ** 2)
        canopy_diameter_ft = 2 * np.sqrt(canopy_area_sqm / np.pi) * 3.28084
        
        # Size classification
        if height_ft < 8:
            size = 'small'
        elif height_ft < 15:
            size = 'medium'
        else:
            size = 'large'
        
        trees.append({
            'pixel_row': int(row),
            'pixel_col': int(col),
            'height_m': round(height_m, 2),
            'height_ft': round(height_ft, 1),
            'canopy_diameter_ft': round(canopy_diameter_ft, 1),
            'size_class': size,
        })
    
    return trees
```

### How Drone Data Refines Satellite Analysis

The drone data doesn't replace the satellite pipeline, it calibrates it:

1. **Ground truth for AI training:** Drone orthomosaics with the Canopy Height Model provide pixel-perfect labeled data. You know exactly where every tree is, how tall it is, and how wide the canopy is. Feed this into the ML model to dramatically improve satellite-only predictions.

2. **Confidence upgrade:** When the app has both satellite and drone data for a polygon, the confidence score jumps from typical 0.5 to 0.7 (satellite only) to 0.85 to 0.95 (drone verified). The PDF bid can state: "Verified by drone survey on [date]."

3. **Satellite calibration factors:** Compare satellite NDVI density estimates to actual tree counts from drones. Over time, learn a correction factor like "satellite says 65% density, drone confirms 72%, so multiply satellite estimates by 1.1 in this soil/terrain combo."

4. **Fill seasonal gaps:** If satellite imagery is from winter and the bid is in summer (or vice versa), drone data from the current season provides the most accurate current state.

### Drone Flight Best Practices for CCC

Include this as a help guide in the app:

1. **Altitude:** Fly at 150 to 200 feet AGL. Lower = better resolution but more images and longer processing. Higher = faster but less detail.
2. **Overlap:** Set 75% front overlap and 65% side overlap. ODM needs heavy overlap for good stitching.
3. **Pattern:** Fly a grid pattern (lawnmower) covering the entire polygon plus 50 feet of buffer on each side.
4. **Time of day:** Midday (10am to 2pm) minimizes shadows. Shadows confuse tree detection.
5. **Weather:** No wind over 15 mph. Overcast is actually fine (eliminates harsh shadows).
6. **Camera settings:** Auto exposure is fine. Shoot JPG (RAW is unnecessary for this purpose and makes files 3 to 4 times larger).
7. **Image count rule of thumb:** ~10 images per acre at 200 foot altitude with 75/65 overlap.
8. **Battery planning:** A DJI Mini 4 Pro covers about 25 to 30 acres per battery. Plan accordingly.

### UI for Drone Upload

```
[Bid Editor] → [Pasture Panel] → "Upload Drone Photos" button

→ Drag and drop zone (accepts JPG/JPEG)
→ App immediately shows image count and GPS coverage on map
→ "Process Imagery" button
→ Progress bar: "Uploading... Stitching... Generating elevation model..."
→ On completion:
  ├── Orthomosaic overlay appears on map (replaces satellite for this area)
  ├── "Drone verified" badge appears on the pasture card
  ├── AI re-runs analysis on drone data
  ├── Tree count, heights, and canopy sizes update
  ├── 3D view updates with accurate tree heights from CHM
  └── Confidence score jumps to 0.85+
```

---

## 2. Progress Tracking with Drone Flyovers

### Concept

After the bid is accepted and work begins, the crew periodically flies the drone over the property (weekly or at milestones). The app compares the current drone imagery to the pre-clearing baseline to calculate completion percentage per pasture. This generates automatic progress reports for the customer.

### How It Calculates Completion

```python
def calculate_clearing_progress(
    baseline_chm: np.ndarray,    # Pre-clearing Canopy Height Model
    current_chm: np.ndarray,     # Current flyover CHM
    pasture_mask: np.ndarray,    # Boolean mask of pasture polygon
    clearing_method: str,        # Affects what "done" means
) -> dict:
    """
    Compare baseline vegetation to current state.
    Progress = (vegetation removed) / (total vegetation that needs removing)
    """
    # Apply pasture boundary mask
    baseline_veg = baseline_chm * pasture_mask
    current_veg = current_chm * pasture_mask
    
    # Define "vegetation" threshold based on clearing method
    if clearing_method in ['full_clear', 'fine_mulch', 'rough_mulch']:
        # Everything above 1 foot needs to go
        veg_threshold_m = 0.3
    elif clearing_method == 'selective_cedar':
        # Only cedar above 3 feet (use species mask if available)
        veg_threshold_m = 0.9
    elif clearing_method == 'chainsaw_grapple_pile':
        # Trees above 4 feet get cut, stumps can remain
        veg_threshold_m = 1.2
    else:
        veg_threshold_m = 0.3
    
    # Count vegetation pixels at baseline
    baseline_veg_pixels = np.sum(baseline_veg > veg_threshold_m)
    
    # Count vegetation pixels now
    current_veg_pixels = np.sum(current_veg > veg_threshold_m)
    
    # Removed = baseline minus current
    removed_pixels = max(0, baseline_veg_pixels - current_veg_pixels)
    
    # Progress percentage
    if baseline_veg_pixels == 0:
        progress_pct = 100.0
    else:
        progress_pct = (removed_pixels / baseline_veg_pixels) * 100
    
    # Estimate remaining work
    remaining_veg_pixels = max(0, current_veg_pixels)
    remaining_acres = remaining_veg_pixels * (pixel_size_m ** 2) / 4046.86
    
    return {
        'progress_pct': round(min(progress_pct, 100), 1),
        'baseline_veg_acres': round(baseline_veg_pixels * (pixel_size_m ** 2) / 4046.86, 2),
        'cleared_acres': round(removed_pixels * (pixel_size_m ** 2) / 4046.86, 2),
        'remaining_acres': round(remaining_acres, 2),
        'status': classify_progress(progress_pct),
    }

def classify_progress(pct: float) -> str:
    if pct >= 95: return 'complete'
    if pct >= 75: return 'nearly_complete'
    if pct >= 50: return 'halfway'
    if pct >= 25: return 'in_progress'
    return 'just_started'
```

### NDVI Based Progress (Without Full Photogrammetry)

If the crew doesn't want to do a full photogrammetry run every flyover, they can just take a few dozen photos and the app can do a simpler NDVI comparison:

```python
def quick_progress_from_photos(
    baseline_ndvi: np.ndarray,
    current_photos: list[dict],  # [{lat, lng, image_data}]
    pasture_polygon: dict,
) -> dict:
    """
    Quick and dirty progress estimate from a handful of drone photos.
    Not as accurate as full photogrammetry but takes 2 minutes instead of 45.
    """
    # Sample NDVI at photo locations
    samples = []
    for photo in current_photos:
        # Extract green channel ratio from photo as rough NDVI proxy
        rough_ndvi = estimate_ndvi_from_rgb(photo['image_data'])
        baseline_val = sample_ndvi_at_point(baseline_ndvi, photo['lat'], photo['lng'])
        
        if baseline_val > 0.3:  # Was vegetation here
            if rough_ndvi < 0.15:
                samples.append('cleared')
            else:
                samples.append('remaining')
    
    cleared = samples.count('cleared')
    total = len(samples)
    
    if total == 0:
        return {'progress_pct': 0, 'confidence': 'low', 'note': 'Need more photos'}
    
    return {
        'progress_pct': round(cleared / total * 100, 1),
        'sample_count': total,
        'confidence': 'medium' if total >= 10 else 'low',
        'note': f'Based on {total} sample points. Full drone survey recommended for precise tracking.',
    }
```

### Customer Progress Report PDF

Auto-generate a professional progress report that gets emailed to the customer:

**Progress Report Contents:**

1. **Header:** Company logo, project name, report date, report number
2. **Before/After Map:** Side by side or slider comparison of baseline vs current drone orthomosaic
3. **Progress Summary Table:**

```
| Pasture       | Acreage | % Complete | Remaining | Est. Completion |
|---------------|---------|------------|-----------|-----------------|
| North Pasture | 45.2    | 82%        | 8.1 acres | Apr 18          |
| Creek Bottom  | 23.7    | 100%       | 0 acres   | Done            |
| South Hill    | 67.3    | 45%        | 37.0 acres| May 2           |
| TOTAL         | 136.2   | 67%        | 45.1 acres|                 |
```

4. **Heatmap:** Color coded map showing cleared (green) vs remaining (red) areas
5. **Photo Gallery:** Before/after photo pairs at key locations
6. **Notes:** Crew notes, weather delays, equipment issues
7. **Next Steps:** Planned work for next period

### Progress Tracking UI

```
[Job Dashboard] → [Active Job] → "Progress" tab

Map view:
  ├── Baseline orthomosaic (toggle)
  ├── Latest drone orthomosaic (toggle)  
  ├── Before/after slider overlay
  ├── Color coded progress overlay (green=cleared, red=remaining)
  └── Per-pasture progress badges

Timeline view:
  ├── Flyover 1: Mar 28 — 0% (baseline)
  ├── Flyover 2: Apr 5 — 35% complete
  ├── Flyover 3: Apr 12 — 67% complete
  └── [Upload New Flyover] button

Actions:
  ├── "Generate Progress Report" → PDF
  ├── "Email Report to Customer" → sends PDF
  └── "Mark Pasture Complete" → manual override
```

---

## 3. Clearing Method Matrix and Bid Customization

### The Problem

Not all clearing is the same. The cost difference between methods is massive:

- **Fine mulch** (forestry mulcher, multiple passes, ground smooth): Most expensive, premium product
- **Rough mulch** (single pass, chips left, some stumps): Middle tier
- **Chainsaw + grapple pile** (cut by hand, pile with skid steer): Labor intensive but less equipment cost
- **Dozer push and pile** (cheapest for large tracts, messy result): Lowest cost, disturbs soil
- **Selective thin** (leave certain trees, precision work): Slow but specific

Some customers want every cedar gone and the ground looking like a golf course. Others want 200 acres cleared as fast and cheap as possible with brush piles they'll burn later. The bid tool needs to handle both extremes and everything in between.

### Clearing Method Definitions

```typescript
interface ClearingMethod {
  id: string;
  name: string;
  description: string;
  // Pricing factors
  baseRateMultiplier: number;  // relative to standard rate
  timeMultiplier: number;      // how much longer vs standard
  // Equipment requirements
  primaryEquipment: string[];
  crewSize: { min: number; max: number };
  // Output description
  resultDescription: string;
  disposalMethod: string;
  stumpTreatment: string;
  // Customer profile
  typicalCustomer: string;
}

const CLEARING_METHODS: ClearingMethod[] = [
  {
    id: 'fine_mulch',
    name: 'Fine Mulch (Premium)',
    description: 'Forestry mulcher makes multiple passes. Ground is smooth, mulch is finely processed, stumps ground to soil level. Premium finished product.',
    baseRateMultiplier: 1.4,
    timeMultiplier: 1.6,
    primaryEquipment: ['forestry_mulcher_high_flow', 'skid_steer_mulcher'],
    crewSize: { min: 1, max: 2 },
    resultDescription: 'Ground appears park-like. Fine mulch spread evenly. No visible stumps or debris.',
    disposalMethod: 'Mulched in place, spread evenly',
    stumpTreatment: 'Ground flush with soil',
    typicalCustomer: 'Homeowners, ranch estates, hunting leases wanting clean look',
  },
  {
    id: 'rough_mulch',
    name: 'Rough Mulch (Standard)',
    description: 'Single pass with forestry mulcher. Chips and mulch left in place. Some stump remnants may remain at or near ground level.',
    baseRateMultiplier: 1.0,
    timeMultiplier: 1.0,
    primaryEquipment: ['forestry_mulcher', 'skid_steer_mulcher'],
    crewSize: { min: 1, max: 2 },
    resultDescription: 'Trees cleared, rough mulch on ground. Some stumps at low level. Functional but not manicured.',
    disposalMethod: 'Mulched in place',
    stumpTreatment: 'Cut at or near ground level, not ground flush',
    typicalCustomer: 'Ranchers wanting pasture reclamation, fence line clearing',
  },
  {
    id: 'chainsaw_grapple_pile',
    name: 'Chainsaw Cut and Pile',
    description: 'Chainsaw crew fells trees, skid steer with grapple stacks brush into piles for burning. Stumps cut at knee height or lower.',
    baseRateMultiplier: 0.75,
    timeMultiplier: 1.3,
    primaryEquipment: ['chainsaws', 'skid_steer_grapple'],
    crewSize: { min: 3, max: 6 },
    resultDescription: 'Trees cut and stacked in burn piles. Stumps remain. Ground not smooth.',
    disposalMethod: 'Stacked in burn piles (customer or CCC burns later)',
    stumpTreatment: 'Stumps remain, cut 6 to 18 inches above ground',
    typicalCustomer: 'Budget conscious ranchers, large acreage, areas where mulching is impractical (very rocky, steep)',
  },
  {
    id: 'chainsaw_haul_off',
    name: 'Chainsaw Cut and Haul Off',
    description: 'Same as chainsaw pile but debris is loaded and hauled off property. Higher cost but leaves clean site.',
    baseRateMultiplier: 1.15,
    timeMultiplier: 1.5,
    primaryEquipment: ['chainsaws', 'skid_steer_grapple', 'dump_trailer'],
    crewSize: { min: 3, max: 6 },
    resultDescription: 'Trees cut, all debris removed from property. Stumps remain.',
    disposalMethod: 'Hauled off site',
    stumpTreatment: 'Stumps remain, cut 6 to 18 inches above ground',
    typicalCustomer: 'Properties where burning is not allowed or not desired, urban adjacent',
  },
  {
    id: 'dozer_push_pile',
    name: 'Dozer Push and Pile',
    description: 'Dozer pushes trees over, roots and all, and piles them. Fastest method for large open areas. Disturbs topsoil.',
    baseRateMultiplier: 0.6,
    timeMultiplier: 0.5,
    primaryEquipment: ['dozer_d6_or_larger'],
    crewSize: { min: 1, max: 2 },
    resultDescription: 'Trees pushed over with root balls, piled. Significant soil disturbance. Requires reseeding.',
    disposalMethod: 'Burn piles with root balls',
    stumpTreatment: 'Entire tree removed including roots',
    typicalCustomer: 'Large ranch tracts (100+ acres), land development, budget clearing',
  },
  {
    id: 'selective_thin',
    name: 'Selective Thinning',
    description: 'Remove specified species or size classes only. Leave desirable trees. Requires tree by tree decision making. Slowest method.',
    baseRateMultiplier: 1.3,
    timeMultiplier: 1.8,
    primaryEquipment: ['forestry_mulcher', 'chainsaws'],
    crewSize: { min: 2, max: 4 },
    resultDescription: 'Specified trees removed, desirable trees untouched. Selective, precision work.',
    disposalMethod: 'Mulched in place or stacked',
    stumpTreatment: 'Varies per tree',
    typicalCustomer: 'Landowners wanting to keep oaks but remove cedar, wildlife management plans',
  },
  {
    id: 'cedar_only_leave_oak',
    name: 'Cedar Removal, Protect Oaks',
    description: 'Remove all cedar/juniper. Protect and leave all oaks and other hardwoods. Most common request in the Hill Country.',
    baseRateMultiplier: 1.15,
    timeMultiplier: 1.3,
    primaryEquipment: ['forestry_mulcher', 'chainsaws'],
    crewSize: { min: 2, max: 4 },
    resultDescription: 'All cedar removed. Oaks and native hardwoods left standing and undamaged.',
    disposalMethod: 'Mulched in place',
    stumpTreatment: 'Cedar stumps ground or cut low. Oak root zones protected.',
    typicalCustomer: 'Most Hill Country ranchers. Cedar competes with oaks for water.',
  },
  {
    id: 'right_of_way',
    name: 'Right of Way / Fence Line',
    description: 'Clear a linear corridor (fence line, pipeline, road, utility right of way). Width specified by customer.',
    baseRateMultiplier: 1.1,
    timeMultiplier: 1.2,
    primaryEquipment: ['forestry_mulcher', 'skid_steer'],
    crewSize: { min: 1, max: 3 },
    resultDescription: 'Linear corridor cleared to specified width. Edges may be feathered.',
    disposalMethod: 'Mulched in place',
    stumpTreatment: 'Ground flush for fence line access',
    typicalCustomer: 'Fence builders, pipeline companies, utility right of way maintenance',
  },
];
```

### Bid Customization by Customer Need

The bid UI should present clearing methods as a customer facing choice, not an internal setting. The customer's priorities drive the method selection:

```typescript
interface CustomerPriority {
  id: string;
  label: string;
  description: string;
  recommendedMethods: string[];
  icon: string;
}

const CUSTOMER_PRIORITIES: CustomerPriority[] = [
  {
    id: 'premium_finish',
    label: 'Premium Finished Look',
    description: 'Want it to look like a park when we are done. Fine mulch, smooth ground, no visible debris.',
    recommendedMethods: ['fine_mulch'],
    icon: 'sparkles',
  },
  {
    id: 'best_value',
    label: 'Best Value',
    description: 'Good clearing at a fair price. Standard mulch, functional result.',
    recommendedMethods: ['rough_mulch', 'cedar_only_leave_oak'],
    icon: 'scale',
  },
  {
    id: 'lowest_cost',
    label: 'Lowest Cost',
    description: 'Clear as much as possible for the budget. Piles and stumps are fine.',
    recommendedMethods: ['chainsaw_grapple_pile', 'dozer_push_pile'],
    icon: 'dollar',
  },
  {
    id: 'wildlife_habitat',
    label: 'Wildlife / Habitat Management',
    description: 'Selective clearing per a management plan. Keep oaks, manage cedar density.',
    recommendedMethods: ['selective_thin', 'cedar_only_leave_oak'],
    icon: 'tree',
  },
  {
    id: 'fence_line',
    label: 'Fence Line or Right of Way',
    description: 'Linear corridor clearing. Specific width and finish requirements.',
    recommendedMethods: ['right_of_way'],
    icon: 'ruler',
  },
];
```

### Multi-Method Bids

A single bid can use different methods per pasture. Common example: fine mulch the 5 acres around the house, rough mulch the 30 acres of near pasture, and chainsaw/pile the back 100 acres.

```typescript
// Each pasture can have its own clearing method
interface PastureConfig {
  id: string;
  name: string;
  acreage: number;
  vegetationType: string;
  density: string;
  terrain: string;
  clearingMethod: string;  // One of CLEARING_METHODS[].id
  // Method specific options
  methodOptions: {
    mulchFineness?: 'fine' | 'standard' | 'rough';
    stumpTreatment?: 'ground_flush' | 'cut_low' | 'leave';
    protectedSpecies?: string[];  // ['live_oak', 'post_oak', 'pecan']
    corridorWidth?: number;  // feet, for right of way
    burnPilesIncluded?: boolean;
    haulOffIncluded?: boolean;
    reseedingIncluded?: boolean;
  };
}
```

### Pricing Impact by Method

The rate engine applies the method's `baseRateMultiplier` and `timeMultiplier`:

```
pastureCost =
  acreage
  × baseRate[vegType]
  × densityMultiplier[density]
  × max(terrainMultiplier, soilMultiplier)
  × methodMultiplier[clearingMethod]       // NEW
  + (acreage × disposalAdder[method])
  + methodSpecificAdders                    // NEW
```

**Method specific adders:**

| Add-on | Per | Est. Cost |
|--------|-----|-----------|
| Stump grinding (flush) | per acre | $75 to $150 |
| Haul off | per acre | $100 to $250 |
| Burn pile construction | per pile | $50 to $100 |
| Burn management (CCC burns) | per acre | $30 to $75 |
| Reseeding | per acre | $50 to $125 |
| Oak protection buffers | per tree | $15 to $30 |
| Fence line corridor | per linear foot | $1.50 to $4.00 |

### Bid Comparison View

When the customer is deciding between methods, generate a side by side comparison:

```
┌─────────────────────────────────────────────────────────┐
│ North Pasture — 45.2 acres — Heavy Cedar               │
├──────────────┬──────────────┬──────────────┬────────────┤
│              │ Fine Mulch   │ Rough Mulch  │ Cut & Pile │
├──────────────┼──────────────┼──────────────┼────────────┤
│ Cost         │ $28,350      │ $20,250      │ $15,190    │
│ $/Acre       │ $627         │ $448         │ $336       │
│ Est. Days    │ 8 to 10      │ 5 to 7       │ 7 to 9     │
│ Finish       │ Park like    │ Functional   │ Piles+stmp │
│ Equipment    │ Mulcher x2   │ Mulcher x1   │ Saws+Grpl  │
│ Disposal     │ Mulch spread │ Mulch in plc │ Burn piles │
│ Stumps       │ Ground flush │ Cut low      │ 12"+ stump │
│ Soil Disturb │ Minimal      │ Minimal      │ Moderate   │
└──────────────┴──────────────┴──────────────┴────────────┘

"We recommend Rough Mulch for this pasture based on terrain 
 difficulty and cedar density. Fine Mulch would be appropriate
 if this area is visible from the main house."
```

### The PDF Should Present Options

The generated bid PDF can include two or three method options if the customer hasn't decided yet. This is a powerful sales technique: instead of one number that the customer accepts or rejects, they choose from a menu. Psychologically this shifts the question from "should I hire them?" to "which option do I want?"

```
OPTION A: Premium Fine Mulch
  Total: $64,200
  Timeline: 18 to 22 working days
  Result: Manicured, park-like finish

OPTION B: Standard Rough Mulch (RECOMMENDED)
  Total: $45,850
  Timeline: 12 to 16 working days
  Result: Clean, functional pasture ready for livestock

OPTION C: Chainsaw and Pile
  Total: $34,100
  Timeline: 14 to 18 working days
  Result: Trees removed, burn piles ready, stumps remain
```

---

## 4. Updated Database Schema

### New/Modified Tables

```sql
-- Drone surveys
CREATE TABLE drone_surveys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id UUID REFERENCES bids(id),
  job_id UUID,  -- for progress tracking after bid acceptance
  pasture_id UUID REFERENCES pastures(id),
  survey_type TEXT NOT NULL,  -- 'pre_clearing', 'progress', 'post_clearing'
  survey_date TIMESTAMPTZ NOT NULL,
  image_count INT,
  coverage_polygon JSONB,  -- GeoJSON of flight coverage area
  flight_altitude_ft REAL,
  drone_model TEXT,
  -- ODM processing
  odm_task_id TEXT,
  processing_status TEXT DEFAULT 'pending',  -- 'pending', 'processing', 'completed', 'failed'
  processing_pct REAL DEFAULT 0,
  -- Output URLs (stored in Supabase Storage)
  orthomosaic_url TEXT,
  dsm_url TEXT,
  dtm_url TEXT,
  point_cloud_url TEXT,
  chm_url TEXT,  -- Canopy Height Model (computed: DSM minus DTM)
  -- Metadata
  gsd_cm REAL,  -- Ground Sample Distance (resolution)
  total_area_acres REAL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Drone images (individual photos before stitching)
CREATE TABLE drone_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id UUID REFERENCES drone_surveys(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  storage_url TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  altitude_m REAL,
  heading REAL,
  pitch REAL,
  captured_at TIMESTAMPTZ,
  camera_model TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Progress snapshots (computed from drone survey comparisons)
CREATE TABLE progress_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL,
  pasture_id UUID REFERENCES pastures(id),
  baseline_survey_id UUID REFERENCES drone_surveys(id),
  current_survey_id UUID REFERENCES drone_surveys(id),
  snapshot_date TIMESTAMPTZ NOT NULL,
  progress_pct REAL NOT NULL,
  cleared_acres REAL,
  remaining_acres REAL,
  status TEXT,  -- 'just_started', 'in_progress', 'halfway', 'nearly_complete', 'complete'
  -- Before/after comparison data
  comparison_heatmap_url TEXT,
  before_after_slider_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Progress reports (PDFs sent to customers)
CREATE TABLE progress_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL,
  report_number INT NOT NULL,
  report_date DATE NOT NULL,
  snapshot_ids UUID[],  -- references to progress_snapshots
  overall_progress_pct REAL,
  pdf_url TEXT,
  emailed_to TEXT[],
  emailed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Modify pastures table: add clearing method fields
ALTER TABLE pastures ADD COLUMN clearing_method TEXT DEFAULT 'rough_mulch';
ALTER TABLE pastures ADD COLUMN method_options JSONB DEFAULT '{}';
ALTER TABLE pastures ADD COLUMN method_multiplier REAL DEFAULT 1.0;
ALTER TABLE pastures ADD COLUMN method_adders JSONB DEFAULT '[]';
-- Drone data references
ALTER TABLE pastures ADD COLUMN drone_survey_id UUID REFERENCES drone_surveys(id);
ALTER TABLE pastures ADD COLUMN drone_verified BOOLEAN DEFAULT false;
ALTER TABLE pastures ADD COLUMN drone_tree_count JSONB;
ALTER TABLE pastures ADD COLUMN drone_avg_tree_height_ft REAL;
ALTER TABLE pastures ADD COLUMN drone_canopy_coverage_pct REAL;

-- Jobs (after a bid is accepted, it becomes a job)
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id UUID REFERENCES bids(id) UNIQUE,
  company_id UUID REFERENCES companies(id),
  client_id UUID REFERENCES clients(id),
  status TEXT DEFAULT 'scheduled',  -- 'scheduled', 'in_progress', 'paused', 'completed'
  start_date DATE,
  estimated_completion DATE,
  actual_completion DATE,
  overall_progress_pct REAL DEFAULT 0,
  total_contract_amount NUMERIC(12,2),
  -- Tracking
  crew_assigned TEXT[],
  equipment_assigned TEXT[],
  weather_delay_days REAL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_drone_surveys_bid ON drone_surveys(bid_id);
CREATE INDEX idx_drone_surveys_job ON drone_surveys(job_id);
CREATE INDEX idx_drone_surveys_pasture ON drone_surveys(pasture_id);
CREATE INDEX idx_drone_images_survey ON drone_images(survey_id);
CREATE INDEX idx_progress_snapshots_job ON progress_snapshots(job_id);
CREATE INDEX idx_progress_reports_job ON progress_reports(job_id);
CREATE INDEX idx_jobs_bid ON jobs(bid_id);
CREATE INDEX idx_jobs_status ON jobs(status);
```

---

## 5. Updated Development Phases

### Revised Phase List

| Phase | Feature | Timeline | Depends On |
|-------|---------|----------|------------|
| 1 | Core MVP (map, polygons, basic bid) | 2 to 3 weeks | Nothing |
| 2 | Soil integration (UC Davis + SDA) | 1 to 2 weeks | Phase 1 |
| 3 | Clearing method matrix and multi-option bids | 1 to 2 weeks | Phase 1 |
| 4 | PDF generation with method options | 1 to 2 weeks | Phase 3 |
| 5 | Multi-source satellite + AI density | 3 to 4 weeks | Phase 1 |
| 6 | Drone upload and photogrammetry | 3 to 4 weeks | Phase 5 |
| 7 | 3D visualization | 2 to 3 weeks | Phase 5 or 6 |
| 8 | Feedback loop and self-improvement | 2 to 3 weeks | Phase 4 |
| 9 | Progress tracking with drone flyovers | 2 to 3 weeks | Phase 6, 8 |
| 10 | Customer progress reports | 1 to 2 weeks | Phase 9 |
| 11 | ML tree detection model | 4 to 8 weeks | Phase 6, 8 |
| 12 | Polish, client portal, integrations | Ongoing | All |

**Note on Phase 3:** The clearing method matrix should ship early because it directly affects how bids are structured. It doesn't require any AI or satellite data, just the rate engine and UI. Get this in front of the crew for testing as soon as possible.

### Infrastructure Addition for Drone Processing

| Service | Purpose | Cost |
|---------|---------|------|
| NodeODM on Railway | Drone photogrammetry processing | $20 to $50/month |
| OR WebODM Lightning | Cloud processing (no self-hosting) | $30/month + credits |
| Supabase Storage (Pro) | Store orthomosaics, DEMs, point clouds | Included in Pro plan (up to 100GB) |
| Railway GPU instance | For large surveys (500+ images) | $0.50 to $2/hour on demand |

**Storage consideration:** A single drone survey (200 images) produces about 500MB of outputs (orthomosaic, DSM, DTM, point cloud). At 2 to 3 surveys per active job and 5 to 10 jobs per month, plan for 5 to 15GB per month of new storage. Supabase Pro includes 100GB which is plenty for the first year.

---

## Additional Open Questions for CCC

Added to the original list:

16. **Drone ownership:** Do they have a drone? Which model? If not, a DJI Mini 4 Pro ($760) or DJI Air 3 ($1,100) would be the minimum recommendation.
17. **Pilot certification:** Do they have a Part 107 (FAA remote pilot certificate)? Required for commercial drone use. If not, the test is $175 and takes about 2 weeks of study.
18. **Burn pile management:** Do they burn the piles or leave that to the customer? If CCC burns, do they carry additional insurance for that?
19. **Most common clearing method requested:** What percentage of jobs are mulch vs chainsaw/pile vs dozer?
20. **Customer communication preference:** Do customers want email reports, text updates, or a login portal?
21. **Reseeding:** Do they offer native grass reseeding after clearing? This is a common upsell.
22. **Cedar post salvage:** Some customers want the larger cedars cut for fence posts instead of mulched. Is this a service CCC offers? It affects the clearing method and pricing.

---

*End of addendum. The drone photogrammetry pipeline and clearing method matrix are the two most practical additions. The method matrix should ship in Phase 3 because it directly improves bid accuracy and sales close rates today without any AI. The drone pipeline is the accelerant that makes every other feature (AI, 3D, progress tracking, feedback loop) dramatically better.*
