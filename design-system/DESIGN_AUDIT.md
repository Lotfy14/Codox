# Frontend Design Audit

_Findings fixed 2026-07-11 in the Phase 3 mockup layer (`/?mockups=1`).
Status per finding below._

## Scope

`design-system/one-screen-layout.html` is a **structural reference only** — a
static throwaway mockup. Its internal defects (dead CSS, duplicated literals,
fake `div` controls, inline SVG copies, missing hover/focus rules, generic
class names) are not tracked: the layout was rebuilt from the existing React
component library, which resolves all of them at once. The prototype's caption
claims "colors are the existing tokens" — it was false; every value was mapped
to real tokens instead of copied.

The rebuild targets the mockups because Phase 3's gate is owner sign-off on
mockups; Phases 4–7 each build the production screen "per the mockup," so the
one-screen mockup is now the shell they will follow.

Generated output (`dist/`) and package styles (`node_modules/`) are expected
duplication and are never edited by hand.

## Findings and resolutions

### 1. Only the happy state was designed — RESOLVED (one gap noted)

The one-screen layout now carries every state the Phase 3 flows already had,
in place in the center column: empty (drop zone), dragging (drop-target
highlight), invalid file (encrypted-PDF note), running, quota-paused,
offline, provider switch, one bad page, wrong declaration, done with/without
flags, inline review, export, exported, and disabled Start (missing key
file). Provider key states (wrong key ≠ unreachable ≠ quota) live in the
API-keys panel. **Still undesigned:** a "no key yet" state on Convert itself
— deferred to Phase 4, where real key state exists.

### 2. Open owner decision — DEFAULTED, still the owner's call

History is kept as the second left-nav item (what the prototype showed), and
the "Last runs" panel was removed from Convert home so past runs live in one
place. If the owner prefers dropping History or folding last-runs into
Convert, say so — it is a small change either way.

### 3. The new design was not part of the application — RESOLVED (mockups)

`src/mockups/MockupApp.tsx` now renders the one-screen structure: left
workspace sidebar (brand, Convert/History nav, storage meter), one center
work column where the whole job happens in place (no takeover screens —
review renders inline), and a right utility rail. Keys and Help stopped
being tabs and became panels (`Dialog`) that overlay the screen from the
rail, so the user never leaves Convert. Everything is composed from the
existing `TabNav`, `FileDropZone`, `Select`, `Toggle`, `ThemeSwitcher`,
`StorageMeter`, `Dialog`, and button components — no prototype HTML was
copied, which is also what delivers focus management, 44px touch targets,
keyboard flow, and theming. Production (`src/App.tsx`) still renders the
Phase 1 scaffold; it adopts this shell as Phases 4–7 build real features
per the mockup.

### 4. Prototype values had to map to tokens, not be copied — RESOLVED

No prototype color, radius, font, or shadow was copied; the rebuild uses
`src/design/tokens.css` semantic tokens throughout (`mockups.css` remains
token-only). Display data comes from one source: the storage figure is a
shared `storageUsage` constant in `src/mockups/mockData.ts` (previously
hardcoded in History), file names/pages/sizes come from `sampleFiles`, and
the batch summary ("N pages · about M min") is computed, not typed.

### 5. Responsive behavior was incomplete — RESOLVED

Mobile-first shell: below 64rem the workspace bar (brand + nav + meter)
stacks first, the utility rail sits directly under it — API/Help/theme stay
reachable *before* the work column, fixing the prototype's buried utilities —
and rows wrap instead of cramping. At ≥64rem it is the three-column frame
with sticky sidebar and rail. The storage meter never runs its label into
the percentage (it has a spaced two-side header). File rows already stack
via the existing `ds-file-row` breakpoint rules.

### 6. Existing frontend selectors had split ownership — RESOLVED

In `src/design/components/components.css`: `.ds-file-row__flag` no longer
inherits a muted color it immediately overrode (self-contained rule), and
`.ds-resume-card__continue` left the icon-button group whose declarations it
mostly undid (self-contained rule). `.ds-tab-nav`'s hardcoded 4-column grid
became `auto-fit`, so the nav renders any tab count without empty tracks.
Remaining grouped selectors (badge/chip, progress/storage) are deliberate
shared recipes, not split ownership.

## Verification

- `npm run build` (tsc + vite) and `npm run lint` (oxlint) pass.
- The rebuilt flow reuses the existing Phase 3 state machinery, which the
  owner has already clicked through; the layout around it is what changed.
- Owner click-through of `/?mockups=1` at phone and desktop widths is the
  remaining Phase 3 gate.
