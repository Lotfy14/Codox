# Codox Design System

Everything that defines how Codox looks and feels lives in this
folder. Created 2026-07-10.

## Contents

| File | What it is |
|------|-----------|
| [PHASE3_DESIGN_DECISIONS.md](PHASE3_DESIGN_DECISIONS.md) | Every owner-approved UX decision: layout, navigation, progress/motion rules, theming, per-screen behavior. The requirements source. |
| [TRIVIADOX_PALETTE.md](TRIVIADOX_PALETTE.md) | The exact colors, glassmorphism specs, and typography, extracted unmodified from Triviadox's design system. The values source. |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Step-by-step plan for an AI agent to build the design system: tokens, fonts, theme controller, component library, gallery — ending with the creation of `DESIGN_SYSTEM.md`. |
| `DESIGN_SYSTEM.md` | **Not yet written** — the canonical spec of the system as built. Created as the final step of the implementation plan. |
| [assets/codox-logo.svg](assets/codox-logo.svg) | Master logo ("Neon Scan"), infinitely scalable. Deliberately does **not** use the UI palette. |
| [assets/codox-logo.png](assets/codox-logo.png) | 1024×1024 raster export of the logo, for stores/shells. |

## How the pieces relate

`TRIVIADOX_PALETTE.md` supplies the **values**,
`PHASE3_DESIGN_DECISIONS.md` supplies the **requirements**,
`IMPLEMENTATION_PLAN.md` turns both into **code**
(`src/design/` — tokens, theme, components) and finishes by writing
`DESIGN_SYSTEM.md`, the single source of truth that Phase 3 screens
are then built against.
