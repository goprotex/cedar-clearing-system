# Design System Strategy: Tactical Scavenger 

## 1. Overview & Creative North Star
### Creative North Star: "The Relic Interface"
This design system is built on the tension between survivalist grit and high-precision instrumentation. It is not a clean "Silicon Valley" dashboard; it is a tactical terminal salvaged from a futuristic wasteland. The aesthetic prioritizes **Information Density** and **Structural Honesty**.

To break the "template" look, we utilize **Asymmetric Heavy-Loading**: layouts should feel weighted toward specific corners, using intentional "empty" space filled with technical micro-copy or scanning line textures. We reject the "soft" web; we embrace the hard, the sharp, and the utilitarian.

## 2. Colors & Tonal Depth
The palette is a high-contrast interplay between charred, organic depth and volatile chemical energy.

### The Palette
- **Primary (Rust/Fire):** `#FFB693` (Active) / `#FF6B00` (Warning/Container). Used for critical path actions and high-alert data.
- **Tertiary (Toxic/Biohazard):** `#00E639` / `#13FF43`. Use this exclusively for "Safe" states, active power signals, or bio-readouts.
- **Surface (Charred Earth):** `#141312`. A near-black that serves as the void.

### The "No-Line" Rule & Surface Nesting
- **No Traditional Borders:** Standard 1px solid dividers are prohibited. Separation is achieved through **Surface Stacking**. 
- **Nesting Hierarchy:** 
    - Base Layer: `surface`
    - Inset Technical Panels: `surface-container-low` 
    - Active Data Modules: `surface-container-high`
- **The "Glass & Gradient" Rule:** To simulate HUD-style glass, use `surface-variant` at 40% opacity with a `20px` backdrop blur. Apply a subtle linear gradient from `primary` to `primary-container` (at 15% opacity) to provide a "flicker" of energy to main CTAs.

## 3. Typography: The Technical Ledger
We pair the aggressive, wide stance of **Space Grotesk** with the utilitarian precision of **Inter**.

- **Display & Headlines (Space Grotesk):** Use for technical headers (e.g., `WASTELAND_01`). These should always be uppercase to mimic stamped metal or digital readouts.
- **Body & Data (Inter):** Use for descriptions. The high x-height ensures readability against high-density backgrounds.
- **Labels (Space Grotesk):** Set at `label-sm` (0.6875rem). These act as "micro-metadata" and should often be paired with `tertiary` (Toxic Green) to denote active scanning.

## 4. Elevation & Depth: Tonal Layering
In a wasteland interface, "shadows" aren't soft—they are absences of light. 

- **Layering Principle:** Instead of shadows, use "Glow Diffusion." Elements that are "higher" in the hierarchy do not cast shadows; they emit a faint 4% opacity glow using the `surface-tint`.
- **The "Ghost Border":** Where containment is required for complex data, use the `outline-variant` token at **15% opacity**. It should look like a faint laser-etching on the glass, not a box.
- **Hard Edges:** All `borderRadius` values are strictly `0px`. Roundness suggests manufacturing comfort; we prioritize field-ready ruggedness.

## 5. Components

### Buttons: Tactical Actuators
- **Primary:** Background `#FF6B00`, Text `#561F00`. No rounded corners. Add a 2px "clip-path" notch on the top-right corner for a custom, salvaged look.
- **Secondary:** Outline only using `outline` token at 40%. Hover state fills with `surface-container-highest`.
- **Tertiary:** Text-only, using `tertiary` (Toxic Green) with an underscore prefix (e.g., `_INITIATE`).

### Input Fields: Data Entry
- **State:** Inactive inputs use `surface-container-lowest` with a "Ghost Border." 
- **Focus:** The background shifts to `surface-container-high` and the `tertiary` (Green) accent appears as a 2px vertical "scan line" on the left edge.

### Chips: Status Indicators
- **Selection Chips:** Use `secondary-container`. When selected, they should glow with a `surface-tint` outer shadow (8% opacity).
- **Format:** All chips must be rectangular.

### Cards & Tactical Panels
- **Constraint:** Forbid divider lines. 
- **Method:** Separate content sections using `surface-container-low` vs `surface-container-high` background shifts.
- **The "Overlay" Component:** Introduce a "Data Overlay" component—a semi-transparent glass panel (`surface-variant` + blur) that sits offset (e.g., 8px top/left) from its parent container to create a "scavenged hardware" feel.

## 6. Do’s and Don'ts

### Do:
- **Use Monospacing for Numbers:** Ensure all data readouts use monospaced styling for alignment.
- **Embrace Asymmetry:** Place critical stats in non-centered modules to mimic a field-repaired HUD.
- **Layer Textures:** Use a subtle grain or noise overlay on `surface` backgrounds to avoid a "flat digital" look.

### Don’t:
- **No Rounded Corners:** Never use a radius. Everything is cut, not molded.
- **No Pure White:** Never use `#FFFFFF`. Use `on-surface` (`#E6E1DF`) for text to maintain the charred, low-light aesthetic.
- **No Soft Transitions:** Interactions should be "snappy"—avoid long, flowy easing. Use short (100-150ms) linear or "expo-out" transitions.