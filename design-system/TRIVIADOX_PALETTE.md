# Triviadox Color Palette (extracted from Triviadox DESIGN_SYSTEM.md)

Delivered by the owner on 2026-07-10. Source:
`/Users/lotfy/Documents/GitHub/Triviadox/DESIGN_SYSTEM.md` (unmodified).
This is the palette Codox's UI derives from (see
[PHASE3_DESIGN_DECISIONS.md](PHASE3_DESIGN_DECISIONS.md)). Note: the app
logo (`assets/codox-logo.svg`) intentionally does not use this palette.

## Global Surface Colors
| Mode | Element | Color/Value | Purpose |
| :--- | :--- | :--- | :--- |
| Light | Base Surface | `#fff8f7` (Parchment) | Soft, editorial background |
| Light | Card Fill | `rgba(255, 255, 255, 0.88)` | High-efficiency glass panels |
| Light | Outline | `rgba(128, 0, 32, 0.22)` | Burgundy-tinted borders |
| Dark | Base Surface | `#011a36` (Midnight) | Deep cosmic background |
| Dark | Card Fill | `rgba(13, 17, 23, 0.75)` | Deep navy semi-transparent |
| Dark | Outline | `rgba(255, 255, 255, 0.1)` | Subtle white borders |

## Semantic Actions (Burgundy)
- Primary: `#800020` (Light) / `#af2b3e` (Dark - "Vibrant Red")
- Use Case: All primary actions, high-level navigation, and active state indicators.
- Accents: Only used for functional highlights (e.g., icons, active tab buttons).

## State Indicators
- Timer/Warning: `#f59e0b` (Amber) — countdowns/urgency
- Success/Teams: `#10b981` (Emerald) — team selections

## Glassmorphism Specs
- `.glass-input`: `background: rgba(255, 255, 255, 0.02)`; `backdrop-filter: blur(12px) saturate(150%)`; `border: 1px solid rgba(255, 255, 255, 0.1)`
- `.glass-panel`: `background: rgba(255, 255, 255, 0.1)`; `backdrop-filter: blur(40px) saturate(160%)`; `box-shadow: 0 15px 45px -12px rgba(0, 0, 0, 0.15)`

## Typography
- English: Plus Jakarta Sans (source calls for headers 900, labels 800 +
  tracking-widest), Inter (body). The shipped Plus Jakarta Sans files top out
  at a genuine 800 weight, so Codox implements headings and labels at 800
  rather than synthesizing a nonexistent 900.
- Arabic: Tajawal

## Component Geometry

These values are also present in the Triviadox source and were omitted from
the first palette summary:

- Main dashboard containers: 32px or 40px radius
- Action buttons: 28px radius
- Selection cards: 20px radius
- Inputs and chips: 12px to 16px radius
- Responsive layout gaps: 32px desktop, 16px mobile
- Minimum interactive target: 44×44px

Triviadox's decorative starfield, twinkle, pulse, and hover-scale effects are
not part of this palette transfer. Codox follows its separately approved
subtle, purposeful motion rule.
