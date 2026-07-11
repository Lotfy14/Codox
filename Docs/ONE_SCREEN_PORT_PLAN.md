# Codox One-Screen Port & Purge Plan

> **Status: planned, not executed.** This is the approved plan of record. Execute it in a dedicated session, on branch `one-screen-port`, phase by phase — every phase must end with tests/build/lint green.

## Context

The UI existed in three copies: `design-system/one-screen-layout.html` (what the owner approved), `src/mockups/` (dev-only React mockups, stripped from release builds), and `src/screens/` (what the exe/apk actually renders — mostly placeholders). Every design agreement was made on copy 1 and shipped as copy 3, two lossy manual hops behind. This plan makes the approved HTML design THE app, then hard-deletes every other design artifact so the running app is the only source of truth. Correct-by-construction: after this, what the owner downloads is what was agreed.

**Design source of truth until its final deletion:** `design-system/one-screen-layout.html` — framed cream stage; 3-column grid (left sidebar 232px: brand + Convert/History nav + storage meter · center work column: drop zone → file rows → options → Start · right rail 96px: API/Help buttons + theme toggle + privacy).

## Owner decisions (locked 2026-07-11 — do not re-litigate)

1. **Purge:** delete `src/mockups/**`, `DesignGallery.tsx/.css`, `Phase2SpikeChecks.tsx` (git history is the reference), orphan screens `Setup/Upload/Progress/Review/Export.tsx`, `Placeholders.tsx`, `silly-sentences.ts`, `ProviderOrderList`. In `design-system/`: keep only `ERROR_LANGUAGE.md` + `assets/`; delete the six other docs; delete `one-screen-layout.html` last, after owner click-through.
2. **HTML values win:** `tokens.css` light theme updated to exactly match the HTML (cream stage, white cards, burgundy `#800020`, radii 32/22/12). Dark theme survives, re-derived to harmonize (warm ink family, not midnight blue). Status-color tokens survive.
3. **History** = second left-nav item; honest empty state until Phase 6 of BUILD_PLAN builds run storage.
4. **Avatar dropped** (no accounts exist — nothing fake ships).
5. **Theme:** 2-state light/dark toggle (per HTML). Migrate stored `'system'` preference → unset → follow OS until first explicit toggle.
6. **Convert column = real pre-flight:** working drop zone, real file names/sizes (NO page counts until PDF parsing exists), real options state, Start visibly disabled with an honest note. No fake files, counts, or time estimates ("23 pages · ~2 min" does not ship).
7. **Storage meter:** real `navigator.storage.estimate()`; renders nothing (not zero) if unavailable.
8. **Mobile:** single column; Convert/History/API/Help in a bottom bar reusing the existing responsive TabNav pattern.
9. **API rail button** opens a dialog hosting the REAL `GeminiKeySection` (existing key check/replace/remove flow, untouched behavior). Help and Privacy likewise open dialogs with real copy from `messages.ts`.

## Agent discipline (applies to every step — this is the "no drift" contract)

- **Tokens only:** every color/size/radius/shadow/spacing comes from `src/design/tokens.css`. Zero hex/px/rgba literals in `components.css` rule bodies (grep-enforced in Phase 7).
- **One class per pattern:** every repeated visual lives as exactly one shared `.ds-*` class in `src/design/components/components.css`. Before writing a new class, check for an existing one. Two buttons must never differ because they were styled separately — same component, same class, variant modifiers only.
- **No inline `style=`, no component-local CSS files, no CSS-in-JS.**
- **No string literals in JSX:** every user-visible string lives in `src/copy/messages.ts` (mirrored from `design-system/ERROR_LANGUAGE.md`). Remove user-visible default-prop strings from shared components; call sites pass copy.
- **No mock data in production code:** if a value can't be real yet, the element doesn't render.
- **Reuse, don't rebuild:** restyle the existing React Aria components (`Button`, `Select`, `Toggle`, `Dialog`, `FileDropZone`, `FileRow`, `StorageMeter`, `TabNav`, `GlassPanel`…). New components only where the mapping table below says so.
- **Untouchable behavior:** `src/providers/**`, `src/state/db.ts|credentials.ts|settings.ts|types.ts`, `src/copy/messages.ts` semantics, all tests. Accessibility floor: React Aria semantics, keyboard nav, 3px burgundy focus ring, `--touch-target-min` 44px hit areas (smaller visual glyphs are fine).
- **Branch first:** `auto-release.yml` ships exe/apk on every push to `main`. All work on branch `one-screen-port`; merge only after the Phase 7 checklist passes.

## Phase 0 — Baseline

`npm test`, `npm run build`, `npm run lint` — record green. Every phase below must end green on all three.

## Phase 1 — Purge dead dev surfaces (old 4-tab shell keeps working)

One commit; importers edited in the same commit as their deleted imports (`tsc -b` typechecks everything under `src/`).

1. `src/App.tsx`: remove only dev machinery — lazy imports of `DesignGallery`/`MockupApp`/`Phase2SpikeChecks`, `DevView`/`mockupsOpen` state, `?gallery/?spike/?mockups` parsing, dev header buttons, devView render branches. Keep FirstRun gate, AppShell + 4-tab TabNav, placeholders, `refreshStatus()` effect.
2. Delete: `src/mockups/` (entire dir), `src/screens/DesignGallery.tsx` + `.css`, `src/screens/Phase2SpikeChecks.tsx`, `src/screens/{Setup,Upload,Progress,Review,Export}.tsx`, `src/design/silly-sentences.ts`.
3. Delete `src/design/components/ProviderOrderList.tsx`; drop its export from `index.ts`; in `components.css` remove its dedicated block (~lines 833–890) and its selectors inside grouped rules (~363–378, ~560–580, media block ~1028–1034) — **edit selector lists, never delete rules shared with `.ds-badge`/`.ds-file-row__remove`/`.ds-dialog__close`.**
4. Delete `src/state/useCurrentJob.ts` (unused skeleton; BUILD_PLAN Phase 6 reworks job state anyway). Keep `db.ts` schema (never rewind Dexie versions) and `state/types.ts`.
5. `src/index.css`: delete legacy blocks for removed screens (`.app-shell`, `.app-header`, `.phase-2-spike*`, `.screen*`, `.spike-*`, `screen-enter` keyframes). Keep reset, imports, focus/selection, `#root`, `.sr-only`, reduced-motion.

**Gate:** green ×3; `grep -rE 'mockups|DesignGallery|Phase2SpikeChecks|silly-sentences|ProviderOrderList|useCurrentJob' src/` → empty.

## Phase 2 — Token retune: HTML values win (`src/design/tokens.css`)

Value edits + new tokens only; architecture (`:root` light / `[data-theme="dark"]`) unchanged. App re-renders recolored on the old layout.

### Token mapping (HTML → token; *retune existing* / **add new**)

| HTML | Value | Token |
|---|---|---|
| `--cream-0` | `#f4e9e0` | *`--color-surface`* (stage base + light theme-color meta) |
| `--cream-1` | `#fbf4ef` | **`--color-stage-mid`** |
| gradient stop | `#fdf6f0` | **`--color-stage-glow`** |
| `.stage` bg | radial-gradient(120% 90% at 12% 0%, …) | **`--stage-gradient`** (composed from the 3 stops) |
| `--frame` | `#fffaf7` | **`--color-frame`** |
| `.frame` border | `#f3e7e2` | **`--color-frame-border`** |
| cards | `#ffffff` | *`--color-surface-elevated`*; card fill goes solid (no alpha) |
| `--ink` | `#2a1b1f` | *`--color-text-strong`* |
| `--muted` | `#8c797e` | *`--color-text-muted`* (also absorbs HTML's `#6f5e62` — don't mint a 4th gray) |
| `--line` | `#efe2e0` | *`--color-outline`* (solid, replaces alpha burgundy) |
| `--burg` / `--burg-hi` / `--burg-soft` | `#800020` / `#6a001b` / `#f6e9ec` | *`--color-primary`* / *`--color-primary-hover`* / *`--color-primary-soft`* |
| navitem active border | `#f0d8dd` | *`--color-primary-border`* |
| control/pill border | `#ead9dd` | *`--color-control-border`* |
| `.frow` bg / border | `#fbf7f6` / `#f4ebe9` | *`--color-row`* / **`--color-row-border`**; re-derive *`--color-row-hover`* |
| `.drop` border / fill | `#e7c9cf` / gradient `#fffdfc→#fff7f8` | **`--color-drop-border`**, **`--drop-gradient`** (+2 stop tokens) |
| amber / emerald + softs | `#f59e0b`/`#fdf3e0`, `#10b981`/`#e7f6f0` | *`--color-warning(-surface)`*, *`--color-success(-surface)`* |
| radii 32 / 22 / 12px | — | **`--radius-frame: var(--radius-dashboard)`** (2rem) / *`--radius-card`* → 1.375rem / *`--radius-input`* (unchanged 0.75rem). Normalize micro-radii onto this trio + `--radius-chip` + `--radius-full`; no new radius tokens. |
| frame / card shadows | HTML lines 59, 70 | **`--shadow-frame`**, **`--shadow-card`** |
| structure | 232px / 96px / 16px / 1180px / clamp pad | **`--layout-sidebar-width`**, **`--layout-rail-width`**, **`--frame-padding`**, **`--frame-gap`**, **`--frame-max-width: 73.75rem`**, **`--stage-padding`** |

- Typography tokens untouched (Jakarta headings / Inter body stay; the HTML's single-font stack is mockup shorthand — record in commit message).
- Retire the glass recipe tokens (`--glass-*`) once Phase 3 removes their last uses; cards are opaque now.

### Dark theme + theme-color literals

- `[data-theme="dark"]`: re-derive from the warm ink family (stage ≈ `#191013`, frame ≈ `#211517`, card ≈ `#2a1b1f`, row ≈ `#332125`; text `#f6edef` / muted `#b7a1a7`; primary stays `#af2b3e` family). Status quads keep dark values. **Hard requirement: body and muted text ≥ 4.5:1 on card — run a contrast check before commit.**
- Update theme-color hexes in **three places** (miss one and the Android status bar contradicts the stage): `index.html` (static meta + inline script), `src/design/theme.ts` (~line 68), `vite.config.ts` manifest (`background_color: #f4e9e0`; pick `theme_color` = burgundy or stage and note the choice).

**Gate:** green ×3.

## Phase 3 — Restyle shared components onto the HTML patterns

### HTML-class → shared class/component mapping

| HTML pattern | Ships as | Action |
|---|---|---|
| `.stage` / `.frame` | **new** `.ds-stage` / `.ds-frame` | stage gradient + centered max-width; 3-col grid `sidebar / minmax(0,1fr) / rail`, frame tokens |
| `.card` | `GlassPanel` (`.ds-glass-panel`) | restyle solid: white fill, `--color-outline` border, `--radius-card`, `--shadow-card`; delete backdrop-filter recipes, keep class names |
| `.side` / `.side-foot` | **new** `.ds-sidebar` on `GlassPanel as="aside"` | column flex; foot pinned `margin-top:auto` |
| `.brand` | `.ds-brand` | migrate `.app-brand` rules from `app.css`; uses `/logo.svg` (master stays in `design-system/assets/`) |
| `.navlabel` / `.navitem` | `TabNav` (`.ds-tab-nav__label`, `__item`) | desktop = vertical sidebar list (active: primary-soft bg + primary text + primary-border); mobile <64rem = existing fixed bottom-bar pattern |
| `.meter` | `StorageMeter` | restyle 7px track, xs label row, primary fill; logic untouched |
| `.work` / `.work-head` | **new** `.ds-work`, `.ds-work__head` | column flex; h1 + muted subtitle |
| `.drop` / `.drop-ic` | `FileDropZone` | restyle dashed drop-border + drop-gradient; add `__icon` tile; **edit component:** add `onRejected?(files)` callback, make label/description required props (no default strings) |
| `.panel` / `.panel-head` | `GlassPanel padding="compact"` + **new** `.ds-panel-head` | bold title + muted hint |
| `.frow`/`.fdoc`/`.fname`/`.fsize` | `FileRow` | restyle row tokens; renders real `file.name` + `file.size` only — no page-count node exists |
| `.pill-select` | `Select` modifier `.ds-select--pill` | rounded-full compact trigger, visually-hidden label; used per-file in FileRow |
| `.xbtn` | `.ds-file-row__remove` | round; 44px hit area, 30px glyph |
| `.field`+`.control` | `Select` | restyle trigger: `--radius-input`, control-border, white bg |
| `.toggle-row`/`.switch` | `Toggle` | 44×26 track, primary when on; two-line label (existing props) |
| `.btn` / `.btn.ghost` | `Button --primary` / `--secondary` | 12px corners, weight 700, primary / primary-soft fills; `--quiet`/`--danger` re-derived same geometry |
| `.start-row`/`.start-note` | **new** `.ds-start-row(__note)` | flex row; muted xs note |
| `.railbtn` | **new component** `RailButton.tsx` (`.ds-rail-button`) | React Aria Button; vertical icon+label chip; export from `index.ts` |
| `.rail` / `.rail-foot` | **new** `.ds-rail(__foot)` | column flex, foot pinned |
| `.theme-toggle` | `ThemeSwitcher` | 2-state pill (Phase 4) |
| `.privacy` | **new** `.ds-rail__privacy` | quiet text button → Privacy dialog |
| `.inplace`, `.caption`, `.legend*`, avatar | **not shipped** | mockup commentary / dropped avatar |

Also: restyle `.ds-dialog` (radius-card, solid, frame-class shadow); `ProgressBar`/`ResumeCard`/`TypewriterLine`/`Badge`/`StatusChip`/`GlassInput` survive untouched — they are the kit for BUILD_PLAN Phases 5–7, not dead code (say so in the commit). **Do not touch TabNav's types yet** (ripples into App — Phase 5).

**Gate:** green ×3; old shell renders with new skin.

## Phase 4 — Theme: 3-way → 2-way

1. `src/design/theme.ts`: `ThemePreference = 'light' | 'dark'`. Stored `'system'` → `removeItem` + treat as unset; unset → follow `prefers-color-scheme` live (keep matchMedia listener for the unset case only); `setThemePreference` always persists — first explicit toggle ends OS-following.
2. `index.html` inline no-flash script already only honors `'light'|'dark'` — no logic change (hexes done in Phase 2).
3. `ThemeSwitcher.tsx`: rewrite as 2-state pill — two icon buttons (inline sun/moon SVGs), `aria-pressed`, pressed = white chip + primary icon; group label + `aria-live` line from messages.ts, `.sr-only`.

**Gate:** green ×3; stored `'system'` boots clean, follows OS until first click, then persists.

## Phase 5 — The one-screen App (single commit — the AppTab type ripple forbids splitting)

### 5a. New copy in `src/copy/messages.ts` first

- **`appMessages`** (new): `brandName`, `navLabel` "Workspace", `navConvert`, `navHistory`, `railApi` "API", `railHelp`, `railPrivacy`, `storageLabel` "On-device storage", `apiDialogTitle`, `helpDialogTitle`, `privacyDialogTitle`, `themeGroupLabel`, `themeLight`, `themeDark`.
- **`convertMessages`** (new): `title`, `subtitle` (HTML line 284 wording), `dropTitle` "Drop PDFs here", `dropHint` "batch of PDFs supported", `filesReady(n)` (real count), `batchOverrideHint`, `keepOriginalLabel`/`Hint`, `startButton` "Start converting", `startNotAvailable` — honest disabled note ("Converting arrives in the next update. Your files and choices are real — nothing runs yet.").
- **`historyMessages`** additions: `emptyTitle` "No runs yet", `emptyBody`.
- Reuse existing `uploadMessages.declarationQuestion/declarationHelp/needsKeyFile/notPdf`.

### 5b. Files

1. **`src/state/storage.ts` (new):** `useStorageEstimate()` — guards `navigator.storage?.estimate`, returns `{used,total} | null` (null = unavailable/rejected/zero-total), reads once on mount, no polling.
2. **`TabNav.tsx`:** generalize to `TabNav<T extends string>` with explicit `items` prop (id/label/icon); `AppTab` narrows to `'convert' | 'history'`; delete built-in tab list — call sites pass items from messages.ts.
3. **`src/screens/Convert.tsx` (new):** real pre-flight. State: `files: File[]` (session-only), per-file answer-source overrides, batch answers-location `Select`, `keepOriginal` `Toggle`, reject note. Render: work-head → FileDropZone (`onRejected` → `uploadMessages.notPdf`) → if files: panel (`filesReady(n)` + hint; one FileRow per real file with pill select + remove) → options panel (+ `needsKeyFile` note when batch = key-file) → start-row with `Button isDisabled` + `startNotAvailable` note.
4. **`src/screens/History.tsx` (new):** heading + honest empty-state panel. No fake rows.
5. **`KeysPanel.tsx`:** reshape to dialog body (drop page chrome; title comes from Dialog). Keep `GeminiKeySection allowRemove` + DEV-only `DevTestCall` behavior exactly.
6. **Delete `Placeholders.tsx`:** Help copy (already message-sourced) moves to the Help dialog body (tiny `HelpContent.tsx` if App crowds).
7. **`src/App.tsx` full rewrite:**
   - FirstRun gate unchanged; keep `geminiController.refreshStatus()` effect verbatim.
   - `.ds-stage > .ds-frame`: sidebar (brand, TabNav[convert,history], StorageMeter only when estimate ≠ null) · `main.ds-work` renders Convert|History · `.ds-rail` (RailButton API/Help, foot: ThemeSwitcher + privacy).
   - State: `activeTab: AppTab`, `openDialog: 'api'|'help'|'privacy'|null`. Three `Dialog`s: api → KeysPanel, help → help copy, privacy → `firstRunMessages.privacyNotice` + `keyMessages.keyOwnership`.
   - <64rem: single column, rail hidden, bottom-bar TabNav carries Convert/History/API/Help (API/Help open dialogs, don't change activeTab).
   - `AppShell.tsx` becomes unused → delete it + its export (the frame replaces it).
8. **Delete `src/screens/app.css`:** migrate live rules (`.app-brand`→`.ds-brand`, `.key-section*`, `.key-inline-note*`, `.key-ownership-note`, `.first-run*`) into `components.css`; drop the import. `index.css` = reset + imports + focus/selection/sr-only only.
9. **`FirstRun.tsx`:** behavior untouched; wrap in `.ds-stage` so the walkthrough matches the framed world.

**Gate:** green ×3 + dev click-through (Phase 7 script).

## Phase 6 — Docs, design-system purge, CLAUDE.md

1. `Docs/BUILD_PLAN.md`: check the Phase 3 sign-off box with a dated note (owner approved one-screen-layout.html 2026-07-11; mockups retired; the running app is the design artifact). Rewrite the `/?mockups=1` items; repoint "per the mockup" phrases (Phases 4–7) → "per the in-app one-screen design".
2. `Docs/PHASE4_PLAN.md`: update mockup/spike references (spike retired after Phase-2 evidence was banked); mark the copy-migration note done.
3. `design-system/ERROR_LANGUAGE.md`: header now points at `src/copy/messages.ts` + the running app; delete the `/?mockups=1` pointer. File remains the copy source of truth.
4. Delete `design-system/{DESIGN_SYSTEM,DESIGN_AUDIT,IMPLEMENTATION_PLAN,PHASE3_DESIGN_DECISIONS,TRIVIADOX_PALETTE,README}.md`. Keep `ERROR_LANGUAGE.md` + `assets/`.
5. `CLAUDE.md` — add one short rule under Stack & conventions: *the running app is the only design artifact; UI approval = owner click-through in the app; no standalone HTML mockups as approval artifacts; every visual value comes from `tokens.css`, every shared pattern is one class in `components.css`.*
6. **Only after the owner's click-through sign-off:** delete `design-system/one-screen-layout.html`.

## Risks / gotchas

1. **AppTab ripple** — TabNav retype + App rewrite + Placeholders/KeysPanel reshape are ONE commit.
2. **PWA staleness** — `registerType: 'prompt'` with console-only `onNeedRefresh`: deployed users may need a second reload for new CSS. Verify update flow post-merge; a visible refresh prompt is a separate follow-up.
3. **Theme-color in three places** (index.html ×2, theme.ts, vite manifest) — miss one → wrong Android status bar / splash.
4. **Dark re-derivation** is the big judgment call — explicit 4.5:1 contrast pass, quota-amber especially.
5. **Light control borders** (`#ead9dd`) are sub-3:1 non-text contrast; HTML wins per owner, but the 3px burgundy focus ring must stay untouched so keyboard affordance never depends on the border.
6. **Touch targets** — HTML draws 30px/24px controls; keep 44px hit areas with smaller glyphs.
7. **Dialog focus on mobile** — verify focus-trap/restore from the fixed bottom bar on WebView2 + Android WebView; dialog z-index stays above the bar.
8. **`storage.estimate()`** absent in some WebView contexts — meter renders nothing, never zero; label used/total from the API only.
9. **Grouped selectors** (ProviderOrderList shares rules) — delete selectors, not shared rules.
10. **`tsc -b` typechecks unreferenced files** — deletion order inside Phase 1 as sequenced.
11. **CI ships on main** — branch `one-screen-port` until Phase 7 passes.
12. **Don't "fix" fonts to match the HTML** — typography tokens are out of scope.

## Phase 7 — Verification checklist

- [ ] `npm test`, `npm run build`, `npm run lint` — all green.
- [ ] Grep-proofs (excluding node_modules): zero hits for `mockups|DesignGallery|Phase2SpikeChecks|silly-sentences|ProviderOrderList|useCurrentJob|app\.css|\?gallery|\?spike` in `src/`; no `'system'` ThemePreference; no `backdrop-filter|--glass-` if glass fully retired; `grep -E '#[0-9a-fA-F]{3,8}' src/design/components/components.css` → empty (tokens only); no user-visible string literals in `Convert.tsx`/`History.tsx`/`App.tsx`.
- [ ] Dev click-through (`npm run dev`, fresh profile): FirstRun on framed stage → one screen (232px sidebar / 96px rail / cream stage) → drop 2 real PDFs → "2 PDFs ready" with real names/sizes, no page counts → per-file pill + batch select + toggle work → Start disabled with honest note → drop a .txt → notPdf message → History empty state → API dialog: full key check/replace/remove + DEV test call → Help + Privacy dialogs → theme toggles and persists; hand-seeded `'system'` boots clean → <64rem: single column, bottom bar works, dialogs trap focus.
- [ ] StorageMeter: real numbers in Chromium; API stubbed away → meter absent, no layout hole.
- [ ] PWA: `build` + `preview` → new theme colors in manifest; SW updates on reload.
- [ ] Tauri smoke (WebView2): frame, dialogs, drop zone, storage meter noted.
- [ ] Capacitor smoke (Android): bottom bar, 44px targets, dialog focus, status-bar color.
- [ ] **Owner click-through sign-off in the running app** → then and only then: delete `one-screen-layout.html`, finalize BUILD_PLAN sign-off line, merge to main (auto-release ships the matching exe/apk).

## Critical files

- `src/App.tsx` — rewrite target (frame, nav/dialog state, mobile bar)
- `src/design/tokens.css` — every HTML value lands here first
- `src/design/components/components.css` — the one home for all shared classes (absorbs app.css)
- `src/design/theme.ts` — 2-way preference + `'system'` migration
- `src/copy/messages.ts` — all new user-visible strings
