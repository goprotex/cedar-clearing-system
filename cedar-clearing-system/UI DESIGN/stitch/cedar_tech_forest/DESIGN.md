# Design System Document: Technical Nature & Hyper-Modern Precision

## 1. Overview & Creative North Star
**The Creative North Star: "The Digital Forester"**

This design system is a sophisticated collision between the raw, tactile world of forestry and the precise, analytical world of high-tech machinery. It moves beyond the "template" look by rejecting traditional grid-bound structures in favor of **Organic Brutalism**. We treat the screen as a high-resolution HUD (Heads-Up Display) overlaying a deep, atmospheric landscape. 

The aesthetic is driven by intentional asymmetry, where technical data "floats" over rich, earthy voids. By utilizing high-contrast typography scales—pairing massive, thin-weight display type with dense, monospaced data—we create an editorial experience that feels both authoritative and futuristic.

---

## 2. Colors
Our palette is rooted in the "Deep Forest," utilizing slate and moss tones to provide a low-fatigue background, punctuated by "Electric Vitality" accents.

### The "No-Line" Rule
**Borders are prohibited for sectioning.** To define boundaries, designers must use background color shifts. For example, a card should not have an outline; it should be a `surface-container-low` object sitting on a `surface` background. This creates a "soft edge" transition that feels premium and integrated rather than boxed-in.

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers—stacked sheets of tinted obsidian and frosted glass.
*   **Base:** `surface` (#101415)
*   **Low Elevation:** `surface-container-low` (#191C1E) for large structural groupings.
*   **High Elevation:** `surface-container-highest` (#323537) for interactive modules.
*   **Nesting:** Always place a higher-tier container inside a lower-tier one to create "recessed" or "extruded" depth without using shadows.

### The "Glass & Gradient" Rule
Floating elements (modals, navigation bars, or data HUDs) must use **Glassmorphism**. Apply `surface-variant` at 60% opacity with a `backdrop-blur` of 20px. 
*   **Signature Textures:** Use a subtle linear gradient for primary CTAs, transitioning from `primary` (#010d05) to a lighter variant of `primary` at a 135-degree angle. This adds "soul" and a sense of liquid energy.

---

## 3. Typography
The typography system relies on the tension between the wide, architectural `Space Grotesk` and the functional, neutral `Inter`.

*   **Display & Headlines (`Space Grotesk`):** These are your "Editorial Markers." Use `display-lg` with a font-weight of 300 to create a sense of airy, high-tech elegance.
*   **Titles & Body (`Inter`):** Focused on legibility. `body-md` is the workhorse for all technical descriptions.
*   **Technical Labels:** For GPS coordinates, density metrics, or machinery status, use `label-md` in all caps with a letter-spacing of 0.05rem to mimic tactical displays.

Hierarchy is conveyed through **extreme scale contrast**: pair a `display-lg` headline with a `label-sm` sub-header to create a bespoke, high-end layout.

---

## 4. Elevation & Depth
We abandon the "drop shadow" of the 2010s in favor of **Tonal Layering** and **Ambient Glows**.

*   **The Layering Principle:** Depth is achieved by stacking. A `surface-container-lowest` card on a `surface-container-low` section creates a natural "in-set" look, appearing as if the content is etched into the interface.
*   **Ambient Shadows:** If a floating state is required, use a shadow with a 40px blur, 0% spread, and 6% opacity, tinted with the `primary` color (#010d05). This mimics the glow of a screen in a dark forest.
*   **The "Ghost Border" Fallback:** If accessibility requires a border, use `outline-variant` at **15% opacity**. It should be felt, not seen.
*   **Glowing Edges:** For "Active" or "Critical" machinery states, apply a 1px inner-glow using the `primary` or `secondary` token to simulate a powered-on LED.

---

## 5. Components

### Buttons
*   **Primary:** Gradient fill (`primary` to a lighter variant of `primary`), no border, `subtle roundedness` (0.375rem). 
*   **Secondary:** Ghost style. No fill, `outline` token at 20% opacity, text in `on-surface`.
*   **Tertiary:** Text-only with an underline that only appears on hover, using the `secondary` (#81755b) accent.

### Input Fields
*   **Style:** Forgo the four-sided box. Use a `surface-container-high` background with a 2px bottom-stroke of `outline`. 
*   **Focus State:** The bottom stroke transitions to `primary` with a subtle outer glow.

### Cards & Lists
*   **Constraint:** **Strictly no dividers.**
*   **Execution:** Separate list items using 12px of vertical white space. Use a slight background shift (`surface-container-lowest`) on hover to indicate interactivity.
*   **Data Visualization:** Incorporate "Sparklines" using the `primary` color for GPS paths and `secondary` for density alerts.

### Signature Component: The "HUD Overlay"
A specialized container for intelligent machinery data. Features a `backdrop-blur`, a `surface-variant` background at 40% opacity, and "corner-only" borders (4px L-shapes in each corner) using the `primary` token to emphasize the "scanning" aesthetic.

---

## 6. Do's and Don'ts

### Do:
*   **Do** embrace asymmetry. Align a headline to the far left and the data to the far right.
*   **Do** use "Deep Forest Green" (`primary` / #010d05) sparingly as a functional signal, not a decorative one.
*   **Do** use high-contrast font weights (e.g., Light 300 for headlines, Bold 700 for labels).

### Don't:
*   **Don't** use pure black (#000000). Use `surface` (#101415) to maintain atmospheric depth.
*   **Don't** use 1px solid, high-contrast dividers. They break the "fluid motion" of the layout.
*   **Don't** use standard "drop shadows." If it doesn't look like an ambient light source, remove it.
*   **Don't** over-round corners. Stick to the `subtle roundedness` scale to keep the "machinery" feel sharp and intentional.