# Codox Design System — AI Implementation Plan

_Written 2026-07-10 and refined during implementation on 2026-07-10.
Audience: an AI coding agent with full access to this repository.
Execute the steps in order; each ends with a "Done when" gate. Scope
was set by the owner on 2026-07-10: **spec + CSS tokens + React
component library** (the fullest option). The final deliverable of
this plan is `design-system/DESIGN_SYSTEM.md` — see Step 8._

### Refinements found during the implementation audit

- The owner reconfirmed **Neon Scan** as the current Codox logo during this
  implementation. Keep its palette and glow treatment independent from the
  app UI palette; reconcile the missing root/public copies without redesigning
  or recoloring the mark.
- Plus Jakarta Sans has real weights only through **800**. Use 800 for
  headings and labels; never synthesize the unavailable 900 weight.
- The upstream Triviadox document does define geometry: 32/40px dashboard
  radii, 28px action radii, 20px card radii, 12–16px input/chip radii, and
  32px desktop / 16px mobile gaps. Use those values instead of inventing a
  replacement geometry system.
- The Triviadox source gives both theme-specific card fills/outlines and a
  generic glass recipe. Resolve this as theme-specific fill + outline with
  the shared blur, saturation, and shadow values; document the interpretation.
- The gallery is a development review surface, not workflow state. It must
  not be added to the persisted `AppStep`/Dexie job value.
- This plan is the **Phase 3A design-system foundation**. It does not claim
  that the later five-screen clickable mockups or owner sign-off are complete.

---

## 0. Read these first (in order, before writing any code)

1. `CLAUDE.md` — the three hard rules (COST-ZERO, NEVER-GUESS, keys
   on-device), search-before-build, stack conventions. **Binding.**
2. `design-system/PHASE3_DESIGN_DECISIONS.md` — every owner-approved
   UX decision: layout model, navigation, progress/motion rules, the
   silly-sentence line, theming, History/Export/Keys behavior. Treat
   every line as a requirement, not a suggestion.
3. `design-system/TRIVIADOX_PALETTE.md` — the exact colors, glass
   specs, and typography. These values are given; do not invent
   alternatives.
4. `Docs/CODOX_CONTEXT.md` §6 — the intent of each screen (what the
   user is trying to do there). Components must serve these intents.
5. `Docs/BUILD_PLAN.md` Phase 3 — how this work slots into the
   project timeline.
6. Current code: `src/index.css` (placeholder styles you will
   replace), `src/App.tsx` (existing screen-nav pattern),
   `src/screens/` (placeholder screens; `Phase2SpikeChecks.tsx` must
   keep working), `src/state/db.ts` (Dexie patterns), `package.json`
   (what's already installed).
7. `design-system/assets/codox-logo.svg` — the canonical Neon Scan logo.
   It deliberately does **not** use the app palette; never recolor it and
   never derive UI colors from it. Mirror it byte-for-byte to `codox-logo.svg`
   and `public/logo.svg` where those copies are required.

## 1. Locked decisions — do not re-litigate, do not ask again

- **Palette = Triviadox.** Burgundy primary (`#800020` light /
  `#af2b3e` dark), parchment `#fff8f7` light surface, midnight
  `#011a36` dark surface, amber `#f59e0b` = timer/warning, emerald
  `#10b981` = success. Exact values and card/outline colors in
  `TRIVIADOX_PALETTE.md`.
- **Surfaces = Triviadox glassmorphism** (owner ruling 2026-07-10).
  Implement `.glass-panel` and `.glass-input` per the specs in
  `TRIVIADOX_PALETTE.md`. Guardrails in §4.
- **Typography:** Plus Jakarta Sans (headers weight 800; small labels
   weight 800 with wide letter-spacing), Inter (body). English-only UI
   — do not add Tajawal/Arabic fonts.
- **Light + dark from day one.** Follow system by default, manual
  override toggle. Both themes are first-class; never design
  light-only and "invert later."
- **Motion: subtle & purposeful only.** Tab transitions, cards easing
  in, bars gliding, a satisfying tick on flag-resolve/export. Nothing
  decorative. `prefers-reduced-motion` must disable all of it.
- **Accessibility is not optional:** real DOM, full keyboard
  operation, visible focus rings, headless accessible primitives
  (Radix or React Aria — chosen in Step 1).
- **One codebase.** No platform-specific component forks; responsive
  behavior (e.g., sidebar vs bottom nav) is CSS/layout-driven within
  the same components.

## 2. Deliverables (definition of done for the whole plan)

| # | Deliverable | Location |
|---|-------------|----------|
| 1 | Design tokens (colors, type, spacing, radii, shadows, glass, motion, focus) as CSS custom properties, both themes | `src/design/tokens.css` |
| 2 | Self-hosted fonts wired in | `src/design/fonts.css` + npm packages |
| 3 | Theme controller (system/light/dark tri-state, persisted, no flash of wrong theme) | `src/design/theme.ts` |
| 4 | Component library per the inventory in Step 5 | `src/design/components/` |
| 5 | Gallery screen showing every component, every state, both themes | `src/screens/DesignGallery.tsx` |
| 6 | `npm run build` and `npm run lint` pass; keyboard + reduced-motion verified | — |
| 7 | **The design system file** documenting everything as built | `design-system/DESIGN_SYSTEM.md` |
| 8 | Canonical component exports and shared component styles | `src/design/components/index.ts` + `src/design/components/components.css` |

## 3. Steps

### Step 0 — Environment sanity

Run `npm install`, `npm run dev`, `npm run build`, `npm run lint`.
Fix nothing yet; just confirm the baseline is green so later failures
are attributable to your changes.

Record the baseline Vite output for the bundle comparison in Step 7.
At the 2026-07-10 audit baseline, the main JS was 102.80 KiB gzip and
the CSS was 0.88 KiB gzip.

**Done when:** dev server serves the app and build + lint pass.

### Step 0.5 — Reconcile the canonical Neon Scan logo

- Keep `design-system/assets/codox-logo.svg` as the canonical owner-approved
  Neon Scan artwork.
- Copy that same SVG to `codox-logo.svg` and `public/logo.svg`; do not maintain
  three divergent drawings.
- Preserve the logo's palette-exempt status and glow. Shell icon regeneration
  remains a shell release task unless it can be performed deterministically
  from this master.

**Done when:** all three SVG copies represent Neon Scan and the design
documents consistently identify it as the current owner-approved mark.

### Step 1 — Search-before-build dispatches (CLAUDE.md rule)

Dispatch a Claude Sonnet 5 research subagent (web search enabled) for
each non-trivial piece before writing it by hand:

1. **Headless primitive library** — Radix UI Primitives vs React Aria
   Components (both permissively licensed). Evaluate: React 19 compatibility,
   maintenance activity, per-component tree-shaking / bundle cost,
   coverage of what Step 5 needs (dialog, select, toggle, tabs,
   drag-to-reorder or at least listbox). Pick **one**; record the
   choice and reasons for the DESIGN_SYSTEM.md doc.
2. **Fonts** — confirm `@fontsource` (or `@fontsource-variable`)
   packages for Plus Jakarta Sans and Inter: OFL license, self-hosted,
   subsettable to latin. COST-ZERO check applies.
3. Anything else you're about to hand-write that exceeds trivial glue
   (per CLAUDE.md). Note: the typewriter effect in Step 5 is ~20 lines
   — that is trivial glue; hand-write it rather than adopting a
   dependency.

Audit choice: **React Aria Components 1.19.x** (Apache-2.0). It is the
better fit because the locked provider failover UX needs keyboard-, touch-,
and screen-reader-accessible reordering (`GridList` + `useDragAndDrop`), which
Radix does not provide. Use subpath imports and lazy-load the reorder surface
when it reaches a production screen. The plan previously called both options
MIT; React Aria is Apache-2.0, which is still explicitly permitted.

Font choice: static `@fontsource/plus-jakarta-sans` and `@fontsource/inter`
(OFL-1.1), with three direct Latin WOFF2 faces only: Plus Jakarta Sans 800,
Inter 400, and Inter 500. Do not import package CSS that makes Vite emit WOFF
fallbacks and unused script subsets.

**Done when:** primitive library and font packages are chosen,
licenses verified (MIT/Apache/BSD/OFL only — never AGPL, never paid),
and the choices are written down for Step 8.

### Step 2 — Design tokens (`src/design/tokens.css`)

All values from `TRIVIADOX_PALETTE.md` become CSS custom properties.
Structure:

- `:root` holds the **light** theme values and all theme-independent
  tokens (spacing, radii, type scale, motion).
- `[data-theme="dark"]` overrides the color tokens.
- When the user preference is "system", JS sets `data-theme` from
  `matchMedia('(prefers-color-scheme: dark)')` and tracks changes
  (Step 3) — so CSS only ever deals with the attribute.

Required token groups (names are yours to finalize; keep them
semantic — `--color-primary`, not `--burgundy`):

- **Surfaces:** base surface, card fill, outline — light and dark
  values per the palette tables.
- **Semantic colors:** primary (burgundy, both modes), warning/timer
  (amber), success (emerald), plus a danger/error tone derived from
  the burgundy family, and text tones (strong/muted) with WCAG AA
  contrast on their surfaces (verify with a contrast checker; adjust
  lightness only if a pairing fails AA, and record any adjustment).
- **Glass:** blur radii, saturation, fills, borders, shadow from the
  glassmorphism specs — expressed as tokens so `.glass-panel` /
  `.glass-input` classes are pure token consumers.
- **Typography:** the two family stacks; weights 800/400–500; a
  modest type scale you define (~6 steps, 12–32px range, rem-based);
  the wide letter-spacing value for labels.
- **Spacing:** 4px-base scale (4/8/12/16/24/32/48…), with the source
  responsive gaps represented by 16px and 32px tokens.
- **Radii:** 12/16px inputs and chips, 20px cards, 28px actions,
  32/40px dashboard containers, and full pills/bars.
- **Motion:** 2–3 duration tokens + easing curves; everything in the
  app animates only with these.
- **Focus ring:** one token pair (color + width) used by every
  interactive component.
- **Touch target:** min 44px interactive height as a token.

The type scale and 4px spacing scale are Codox proposals; the primary radii
and responsive gaps come from the upstream Triviadox system. Replace the
placeholder styling in `src/index.css` with a minimal reset that imports the
font, token, and component sheets; keep the existing screens rendering
(restyle, don't break).

**Done when:** the app renders with token-driven styles in both
themes (temporary hardcoded `data-theme` toggle is fine until
Step 3).

### Step 3 — Fonts + theme controller

- Install the chosen font packages; create `src/design/fonts.css` with
  direct WOFF2-only Latin `@font-face` declarations (bundle discipline).
  Wire the families
  into the typography tokens. **No CDN links** — the PWA must work
  offline and COST-ZERO forbids anything that could ever bill.
- `src/design/theme.ts`: a `useTheme()` hook exposing
  `{ preference: 'system' | 'light' | 'dark', setPreference }`.
  Persist the preference in **`localStorage`** (not Dexie: the read
  must be synchronous so a tiny inline script in `index.html` can set
  `data-theme` before first paint — no flash of the wrong theme).
  When preference is `system`, subscribe to the `matchMedia` change
  event so the app flips live with the OS. Also expose the resolved theme,
  validate stored values, react to cross-tab `storage` events, update
  `color-scheme` and the `theme-color` meta tag, and tolerate storage errors.

**Done when:** fonts render offline (dev-tools network check), the
tri-state toggle works, no wrong-theme flash on a hard reload in dark
mode.

### Step 4 — Glass surface classes

Implement `.glass-panel` and `.glass-input` from
`TRIVIADOX_PALETTE.md`, consuming only tokens. Use each theme's card fill and
outline, combined with the shared panel/input blur, saturation, and shadow
recipe. Include both standard and `-webkit-` backdrop filters, plus:

- A solid-color fallback via
  `@supports not (backdrop-filter: blur(1px))` — same layout, same
  borders, opaque card fill.
- **No nested/stacked glass:** a glass panel never sits on another
  glass panel. Dense scrolling lists (History rows, Review rows, file
  rows) are **solid rows inside one glass container** — never per-row
  `backdrop-filter` (GPU cost on iPhone-SE-class devices; the mobile
  memory/perf discipline in CLAUDE.md is law).

**Done when:** both classes render correctly in both themes, and the
fallback is verified by toggling `backdrop-filter` off in dev tools.

### Step 5 — Component library (`src/design/components/`)

Build on the Step 1 primitive library. Every component: keyboard
operable, focus-visible ring from the token, ≥44px touch targets,
both themes, `prefers-reduced-motion` respected. One component per
file, named exports, props typed strictly.

Inventory (derived from `PHASE3_DESIGN_DECISIONS.md` — reread the
relevant section before building each):

| Component | Purpose / key states | Used by |
|-----------|----------------------|---------|
| `GlassPanel` | Card wrapper on the glass class; `as`/padding props | everywhere |
| `GlassInput` | Text input incl. paste-a-key styling; error + success states | Keys, Upload |
| `Button` | primary (burgundy) / secondary / quiet; loading + disabled | everywhere |
| `StatusChip` | Plain-language provider status: working / wrong key / can't reach / **resting until quota returns** — quota is a calm state, visually distinct from errors (amber-ish, not red) | Keys, Progress |
| `ProgressBar` | One calm bar; real fraction with percent **on the bar**; advances only on real events — no fake timers, no indeterminate shimmer | Progress, resume card |
| `TypewriterLine` | The silly-sentence line: types sentences from a provided list, shuffled, no repeats until exhausted; rotation on a **fixed calm timer, never tied to engine events**; `prefers-reduced-motion` → sentence appears instantly (one CSS/JS branch). Content prop takes a string array; create `src/design/silly-sentences.ts` with ~10 obvious placeholders (owner delivers the real ~100 later) | Progress |
| `TabNav` | The four tabs (Convert / History / Keys / Help): left sidebar ≥ desktop breakpoint, bottom bar below it — same component, CSS-driven | app shell |
| `FileRow` | Dropped-PDF row: name, size, per-row declaration override, flag/remove | Upload |
| `Select` | Declaration picker, retention dropdown (accessible listbox from the primitive lib) | Upload, History |
| `Toggle` | e.g. "keep original PDF" per-run switch | Upload, History |
| `Badge` | e.g. the quiet **"not exported yet"** badge | dashboard, History |
| `ResumeCard` | Minimized-review card: "bio_exam — 4 flags left, continue" | Convert home |
| `Dialog` | Modal for confirmations (delete run, etc.) from the primitive lib | History |
| `StorageMeter` | Simple used-storage bar for the History storage row | History |
| `ThemeSwitcher` | System / light / dark preference without hiding the resolved state | Gallery, Help/settings |
| `FileDropZone` | Keyboard-operable PDF picker/drop target backed by a real file input | Upload |
| `ProviderOrderList` | Provider cards with accessible drag, touch, keyboard reorder and explicit move controls | Keys |
| `AppShell` | Shared responsive sidebar/bottom-nav frame; focused-review takeover support | app shell |

`TabNav` is page navigation (`<nav>` + `aria-current="page"`), not an ARIA
tablist. Add `src/design/components/index.ts` as the only public import surface
for app code and keep component styling in `components.css`.

Do **not** build full screens — that is Phase 3 mockup work. Build
the parts screens will compose.

**Done when:** every component in the table exists, typechecks, and
is keyboard-walkable.

### Step 6 — Gallery screen (`src/screens/DesignGallery.tsx`)

Expose the Gallery from the existing development screen-nav without adding
`gallery` to the persisted `AppStep`. A local/query-string development view
is acceptable and must be easy to remove from release UI. The gallery shows:
every color
token as a swatch grid, the type scale, spacing/radii samples, and
every component in every state — with the theme toggle at the top so
the owner can flip light/dark while looking at it. This is the
owner's review surface for everything this plan builds.

**Done when:** the owner (or you, on their behalf, via `npm run dev`)
can see every token and component state in both themes on one screen,
at desktop and phone widths.

### Step 7 — Verification pass

- `npm run build` and `npm run lint` pass.
- Keyboard-only walk through the gallery: every interactive component
  reachable, operable, focus always visible.
- Dev-tools emulation: `prefers-reduced-motion: reduce` → typewriter
  renders instantly, transitions gone; `prefers-color-scheme: dark` +
  preference "system" → theme follows.
- Phone-width check (~375px) and desktop check.
- Bundle check: compare `vite build` output size before/after. Treat ~100 kB
  gzip for the primitive layer as an audit trigger rather than a hard gate:
  accessible drag-and-drop is intentionally substantial. Report JS gzip and
  raw font assets separately; subpath-import and screen-split heavy reorder
  code before considering a less accessible implementation.
- `Phase2SpikeChecks.tsx` still functions.

**Done when:** all of the above pass, honestly reported (failures
listed, not glossed).

### Step 8 — FINAL STEP: create the design system file

Create **`design-system/DESIGN_SYSTEM.md`** — the canonical,
single-source-of-truth design system document for Codox — and add it
to this folder. Document **what was actually built** (real values,
real APIs — not aspirations). Required sections:

1. **Identity & feel** — one paragraph: Triviadox-matched
   glassmorphism over parchment/midnight, calm density, one strong
   burgundy accent; logo usage note (logo palette ≠ UI palette,
   pointer to `assets/`).
2. **Tokens** — every token with its light + dark value, in tables,
   grouped as in Step 2. Note any AA-contrast adjustments made and
   why.
3. **Typography** — families, weights, the scale, label tracking
   rule, where each level is used.
4. **Surfaces & glass** — the two glass classes, their token recipe,
   the fallback, and the no-stacked-glass / solid-rows-in-glass-list
   rules.
5. **Motion** — the duration/easing tokens, what is allowed to
   animate (the Phase-3 list), the reduced-motion contract, and the
   ProgressBar/TypewriterLine timing rules (real events only; fixed
   calm rotation).
6. **Components** — one subsection per component: props API, states,
   a11y behavior (keys handled, roles), which screens use it, and a
   short do/don't.
7. **Theming** — the `data-theme` mechanism, tri-state preference,
   persistence, no-flash bootstrapping.
8. **Rules screens must follow** — 44px targets, focus ring token,
   quota-reads-as-paused language, error tones distinguishable (bad
   key ≠ unreachable ≠ quota), export button prominence, no
   decorative motion.
9. **Provenance** — links to `TRIVIADOX_PALETTE.md`,
   `PHASE3_DESIGN_DECISIONS.md`, and the Step 1 library choices with
   licenses.

Then update `design-system/README.md`'s index to link the new file,
and tick only the Phase 3 checkbox "Pick a component approach…" in
`Docs/BUILD_PLAN.md`. Do not mark the later mockups or owner approval done.

**Done when:** `design-system/DESIGN_SYSTEM.md` exists, matches the
shipped code exactly, and the README index links it.

## 4. Constraints & gotchas (read before every step)

- **COST-ZERO:** verify the license of every package you add
  (MIT/Apache/BSD/OFL). Anything AGPL, paid, or freemium: stop and
  flag to the owner. No CDN assets of any kind.
- **Do not touch** the engine docs, the three prompts, the CSV
  contract, or anything under `Docs/CODOX_MIGRATION.md`'s domain.
  This plan is UI-foundation only.
- **Do not commit or push.** Leave changes in the working tree and
  report; the owner decides when to commit.
- **Never guess owner-level decisions.** If something here conflicts
  with the repo or is genuinely ambiguous, stop and ask the owner —
  don't invent a resolution. Everything in §1 is already decided.
- **Perf discipline:** glass never stacks; dense lists get solid rows
  inside one glass container; animate only `transform`/`opacity`
  (never layout properties); target iPhone-SE-class devices.
- **The gallery is the contract:** if a component state isn't visible
  in the gallery, it doesn't exist. Owner sign-off happens there.
- **Precedence:** latest direct owner instruction → owner-approved Phase-3
  decisions → shipped `DESIGN_SYSTEM.md` → extracted Triviadox source notes.
