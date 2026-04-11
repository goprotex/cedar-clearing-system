# How Our Spectral Analysis Works

A plain-language guide for explaining the cedar detection system to customers.

---

## The Elevator Pitch

> "We use government aerial photography and satellite imagery to scan your entire property at the individual-tree level. The system analyzes how each tree reflects light — not just visible light, but invisible near-infrared light that the human eye can't see. Cedar and oak trees reflect light in fundamentally different ways, and our system uses five independent scientific measurements to identify which is which, then cross-checks every result against its neighbors to eliminate errors."

---

## Two Imagery Sources

### 1. NAIP (USDA Aerial Photography)

High-resolution aerial photography flown by USDA aircraft across the entire US. This captures your property at roughly 1-meter resolution in **four light bands**: Red, Green, Blue, and Near-Infrared. This is the primary source for tree-by-tree classification.

### 2. Sentinel-2 (European Space Agency Satellite)

Orbits Earth every 5 days. The system pulls both **winter and summer** passes over the property. Since cedar is evergreen and oak drops its leaves, comparing the two seasons is a powerful confirmation of what's cedar and what's not.

---

## How It Tells Cedar From Oak

Every type of vegetation reflects light differently — like a fingerprint. When sunlight hits a cedar tree vs an oak tree, they absorb and bounce back different amounts of red, green, and infrared light. The system measures five separate signatures:

| Measurement | What It Tells Us |
|---|---|
| **NDVI** (vegetation greenness) | How alive and green the canopy is — separates vegetation from bare ground |
| **GNDVI** (chlorophyll content) | How much chlorophyll is in the leaves — cedar and oak have different chlorophyll profiles |
| **SAVI** (soil-adjusted vegetation) | Filters out soil interference so thin canopy areas are still measured accurately |
| **Excess Green index** | Detects bright green grass vs dark evergreen canopy |
| **NIR ratio** (canopy density) | How much invisible infrared light bounces back — this is the big differentiator |

### The Key Insight

**Cedar trees appear dark and muted in infrared, while oak trees glow bright red-pink.** Cedar has a dense, waxy, year-round canopy that absorbs infrared light. Oak has broad deciduous leaves that reflect it strongly. When you look at infrared imagery, oak practically lights up compared to cedar. The system quantifies this automatically.

---

## How Accurate Is It

The system doesn't rely on any single measurement. It runs all five indices on each sample point and they **vote** — if 3, 4, or 5 out of 5 measurements agree that a spot is cedar, that's a high-confidence classification.

Then, the **overlapping tile consensus** system cross-checks every point against its neighbors in overlapping 75-meter zones. If one point says "grass" but it's completely surrounded by cedar on all sides, the system recognizes that's likely a measurement error and corrects it.

Across a property, the system typically samples **every 15 meters** — that's roughly every 50 feet. For a 100-acre ranch, that's thousands of individual measurement points, each analyzed five ways, then spatially cross-verified.

---

## By The Numbers

| Metric | Value |
|---|---|
| Light bands analyzed | 4 (Red, Green, Blue, Near-Infrared) |
| Vegetation indices per sample point | 5 |
| Cross-checks per point (tile consensus) | Up to 9 |
| Sampling resolution | 15 meters (~50 feet) |
| Imagery sources | 2 (USDA aerial + ESA satellite) |
| Seasonal passes compared | 2 (winter vs summer for evergreen detection) |

---

## Customer-Facing Summary

> "We sample your property every 50 feet using USDA aerial photography with four-band imaging including invisible infrared light. Each sample point is analyzed five different ways and cross-checked against its neighbors. We also pull winter and summer satellite passes to confirm which trees keep their leaves year-round. The result is a color-coded map of your property showing exactly where the cedar is, how dense it is, and how many acres need clearing — before we ever set foot on your land."
