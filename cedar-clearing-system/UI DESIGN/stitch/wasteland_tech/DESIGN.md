# Design System Strategy: Wasteland Tech

## 1. Overview & Creative North Star: "The Terminal Frontier"
The Creative North Star for this design system is **The Terminal Frontier**. This is not a "user-friendly" consumer app in the traditional sense; it is a high-functioning tactical interface recovered from a harsh, industrial future. It moves beyond the soft, rounded "SaaS" look of the last decade, embracing **Hard-Surface Brutalism**.

The aesthetic breaks the "template" look by utilizing extreme high contrast, a strict 0px radius policy, and intentional asymmetry. We treat the viewport as a CRT monitor or a tactical HUD, where information density is high, and every pixel is a deliberate choice. We favor verticality, monospaced rhythm, and a "built-to-survive" industrial grit.

---

## 2. Colors: High-Volatility Spectrum
The palette is designed for high-stress environments where legibility is life or death. It uses a "high-volatility" approach—extreme darks met with searing, luminous accents.

### The Palette
*   **Background / Surface (`#131313`):** The "True Black" abyss. All UI elements emerge from this depth.
*   **Primary (`#FFB693`) & Primary Container (`#FF6B00`):** Safety Orange. Used for critical actions, warnings, and high-priority data points.
*   **Secondary Container (`#13FF43`):** Emerald Neon Green. Used for "System Go" states, active connections, and successful telemetry.
*   **Neutral Tones (`#353534` to `#E5E2E1`):** A range of charcoals and stark whites to provide structural definition.

### Strategic Color Rules
*   **The "No-Line" Rule (Subverted):** Unlike soft modern systems, this system *requires* lines, but never "decorative" ones. Boundaries are defined by the `surface-container` shifts. If a section needs to feel distinct, drop the background to `surface-container-lowest` or raise it to `surface-bright`.
*   **Surface Hierarchy:** Nesting is key. Use `surface-container-low` for the main dashboard and `surface-container-highest` for active modular panels. This creates a "stacked plate" industrial feel.
*   **The "Glass & Gradient" Rule:** Use `surface-variant` with a 40% opacity and 12px backdrop blur for floating HUD elements. Apply a subtle linear gradient from `primary` to `primary_container` on large-scale buttons to simulate a glowing phosphor effect.

---

## 3. Typography: Monospaced Authority
The system exclusively uses **Space Grotesk**. Its monospaced-adjacent rhythm provides a mechanical, technical feel that suggests the UI was "coded" rather than "drawn."

*   **Display (L/M/S):** 3.5rem to 2.25rem. Use for mission-critical status codes or heavy environmental headers. Always Uppercase.
*   **Headline & Title:** Use `headline-sm` (1.5rem) for section modules. Letter-spacing should be set to `-0.02em` to maintain a tight, industrial density.
*   **Body (L/M/S):** 1rem down to 0.75rem. This is the "Data Stream." It must be clear and high-contrast (`on-surface`).
*   **Label:** 0.75rem. Use for metadata, timestamps, and coordinate tracking.

**Hierarchy Strategy:** Brand identity is conveyed through "Information Overload" styling—using labels and body text in tight clusters to mimic a complex machine's readout.

---

## 4. Elevation & Depth: Tonal Layering & Industrial Seams
In this system, "Elevation" is not about soft clouds; it’s about physical assembly.

*   **The Layering Principle:** Avoid shadows where possible. Instead, use "Tonal Stepping." A `surface-container-high` panel sitting on a `surface` background provides all the necessary "lift."
*   **Ambient Shadows:** If an element must float (e.g., a critical modal), use a `primary` (Orange) tinted shadow at 10% opacity with a massive 40px blur. This creates a "glow" rather than a shadow, suggesting the element is radioactive or powered-on.
*   **The "Ghost Border" Fallback:** For containers that require a hard edge, use `outline-variant` at 20% opacity. This creates a "faint wiring" look that guides the eye without cluttering the technical density.
*   **Hard Borders:** Critical containers use a 2px solid border of `outline` (`#A98A7D`) to simulate reinforced industrial casing.

---

## 5. Components: Modular Hardware

*   **Buttons:**
    *   **Primary:** Solid `primary_container` (Orange), 0px radius, black text.
    *   **Secondary:** 2px `outline` border, no fill, text in `secondary_fixed`.
    *   **States:** On hover, buttons should "invert"—text becomes the background color and background becomes white.
*   **Input Fields:**
    *   Style as "Underlined" only or "Fully Enclosed" with a 1px `outline-variant`. 
    *   Active state: The border flashes to `secondary_container` (Neon Green).
*   **Chips (Telemetry Tags):**
    *   Small, rectangular boxes with `label-sm` text. Use `tertiary_container` for inactive data and `primary` for "Live" data.
*   **Cards & Lists:**
    *   **FORBIDDEN:** Divider lines.
    *   **REQUIRED:** Use 16px or 24px vertical "dead space" or a slight background shift to `surface-container-low` to distinguish items. Each list item should feel like a line of code in a terminal.
*   **Progress Bars:** 
    *   Stepped indicators rather than smooth bars. Use `secondary` (Green) blocks to show completion.

---

## 6. Do's and Don'ts

### Do:
*   **Embrace 0px:** Every corner must be sharp. Roundness is a sign of weakness in the Wasteland.
*   **Use Monospaced Alignment:** Align text and icons to a strict vertical axis to mimic data columns.
*   **Highlight the "Glitches":** Use the `error` (`#FFB4AB`) color for more than just errors—use it for "unstable" data or high-volatility metrics.

### Don't:
*   **No Soft Gradients:** Avoid "pretty" pastel gradients. Only use gradients to simulate light emission (Glows).
*   **No Circular Icons:** If an icon is placed in a container, that container must be a square or a diamond.
*   **No Standard Shadows:** Never use a default black 20% opacity shadow. It flattens the technical "HUD" vibe.
*   **No Centered Text:** In a technical interface, data is almost always left-aligned for rapid scanning. Centered text feels like a greeting card; avoid it.