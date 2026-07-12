# One-Screen Port — Execution Handoff

> **State as of 2026-07-12.** Execution of [ONE_SCREEN_PORT_PLAN.md](ONE_SCREEN_PORT_PLAN.md)
> on branch `one-screen-port`, stopped partway into Phase 3. This file records
> what is done, what drifted, every decision already made, and the exact
> remaining work so any session can pick it up without re-deriving anything.

## Where things stand

| Phase | Status | Commit |
|---|---|---|
| 0 — Baseline | ✅ green ×3 (203 tests / build / lint) | branch created off `main` @ `ef687ed` |
| 1 — Purge dev surfaces | ✅ committed | `1d88444` |
| 2 — Token retune | ✅ committed | `91a972d` |
| 3 — Component restyle | ⚠️ **started, uncommitted** | working tree |
| 4 — Theme 2-way | ⬜ not started | — |
| 5 — One-screen App | ⬜ not started | — |
| 6 — Docs purge | ⬜ not started | — |
| 7 — Verification | ⬜ not started | — |

**Uncommitted working-tree changes (Phase 3, partial):**

1. `components.css`: glass recipes replaced with solid card recipe —
   `.glass-panel` = solid `--color-card-fill` + `--color-outline` border +
   `--shadow-card`; `.glass-input` = solid `--color-surface-elevated` +
   `--color-control-border`; nested-panel rule now uses `--color-row(-border)`;
   the `@supports not (backdrop-filter…)` fallback block deleted. **Applied.**
2. `.ds-glass-panel` radius `--radius-dashboard` → `--radius-card`:
   **proposed but rejected/not applied** — re-decide or re-apply when resuming.

## Plan drift discovered (the plan predates BUILD_PLAN Phases 5–8)

The port plan was locked 2026-07-11; commits `459d1dd`…`ef687ed` then landed a
real PDF pipeline, the engine port, and real Convert/Review/Export flows.
Deviations already taken (all noted in the Phase 1 commit message):

- **`src/design/silly-sentences.ts` KEPT** — plan said delete; it now feeds
  `TypewriterLine` in the real Convert running stage.
- **`src/state/useCurrentJob.ts` KEPT** — plan said "unused skeleton"; the real
  `Convert.tsx` uses it (`job`, `updateJob`, `CURRENT_JOB_ID`).
- **`src/screens/PdfSpike.tsx` KEPT** (+ `?pdfspike=1` param in App) — production
  diagnostic surface per PHASE5_PLAN; the plan predates it.
- **Plan Phase 5's "new Convert.tsx with disabled Start" is superseded.**
  Convert is real (561 lines: intake → options → running → review → export,
  via `useConversion`, `ReviewStage`, `state/files`, `state/runs`). Phase 5 must
  **restyle/re-house the real Convert**, never replace it with a fake pre-flight
  or a disabled Start button. `convertMessages.startNotAvailable` is obsolete.
- **`src/screens/app.css` is much bigger than planned** — it now holds live
  `.convert-*`, `.review*`, and `.pdf-spike-*` rules (Phases 5–8 styles), all of
  which must migrate to `components.css` in Phase 5, not be dropped.
- Orphan screens `Setup/Upload/Progress/Review/Export.tsx` were confirmed
  11-line placeholders with zero importers before deletion (the real review
  lives in `ReviewStage.tsx`).

## Decisions already made (do not re-litigate)

- **Dark theme re-derived and contrast-verified** (in `91a972d`): on card
  `#2a1b1f` — body `#f6edef` 14.3:1, muted `#b7a1a7` 6.8:1; quota amber
  `#fcd34d` on `#352b16` 9.65:1; all status pairs ≥ 4.5:1.
- **Light muted `#8c797e` on white is 4.08:1** — below 4.5, but it is the
  HTML's own value and the owner locked "HTML values win". Flag to owner at
  sign-off; do not silently change.
- **Manifest `theme_color` = burgundy `#800020`** (brand); `background_color` =
  cream stage `#f4e9e0`. Theme-color hexes updated in all three places
  (index.html static meta + inline script, theme.ts, vite manifest).
- **Typography untouched** — only Inter 400/500 and Jakarta 800 are loaded
  (`fonts.css`); the HTML's 600/650/700 weights are mockup shorthand. Use
  existing weight tokens; do not add font files.
- **`.ds-file-drop-zone__mark` is the drop icon tile** — no new `__icon`
  element; restyle the existing mark (it already is the tile).
- **Pill select = CSS modifier `.ds-select--pill`** applied via FileRow's
  existing `className` pass-through to `Select`; label hidden with the
  visually-hidden pattern inside the modifier; `aria-label` already present.
- **TabNav indicator span** stays in the TSX (types untouched until Phase 5);
  hide it in CSS (`display: none`) — the navitem active style replaces it.
- New tokens added in Phase 2 and ready to consume: `--stage-gradient`,
  `--color-frame(-border)`, `--color-row-border`, `--color-drop-border`,
  `--drop-gradient` (+ 2 stop tokens), `--shadow-frame`, `--shadow-card`,
  `--radius-frame`, `--layout-sidebar-width` (14.5rem), `--layout-rail-width`
  (6rem), `--frame-padding/gap/max-width`, `--stage-padding`.

## Remaining work

### Phase 3 — finish the component restyle (one commit)

All in `src/design/components/components.css` unless said otherwise. Tokens
only; no hex/px/rgba in rule bodies (7px meter track = `0.4375rem`, etc.).

1. `.ds-glass-panel` border-radius → `var(--radius-card)` (the rejected edit —
   confirm and apply; cards are 22px in the approved HTML).
2. `.ds-button`: border-radius → `var(--radius-input)` (12px corners), keep
   44px min-height. `--secondary` becomes the HTML ghost: `primary-soft` fill,
   primary text, transparent border. `--quiet`/`--danger` keep the same new
   geometry automatically.
3. `.ds-select__trigger`: `var(--glass-input-border/background)` →
   `var(--color-control-border)` / `var(--color-surface-elevated)`.
4. New `.ds-select--pill` modifier: rounded-full compact trigger
   (`--radius-full`, tighter padding, `--font-size-xs`), label visually hidden
   inside the modifier.
5. `FileRow.tsx` (one line): Select className →
   `"ds-file-row__answer-source ds-select--pill"`.
6. `.ds-toggle__track`: 2.75rem × 1.625rem (44×26), thumb 1.25rem at 3px inset,
   selected `translateX(1.125rem)`; primary when on (already).
7. `.ds-file-row`: border-color → `var(--color-row-border)`, background
   `var(--color-row)` (token change already makes it right), radius →
   `var(--radius-input)`.
8. `.ds-file-drop-zone`: `2px dashed var(--color-drop-border)`, background
   `var(--drop-gradient)`, radius `var(--radius-card)`. `__mark` keeps
   primary-soft/primary (already correct via tokens).
9. `FileDropZone.tsx`: add `onRejected?: (files: File[]) => void` (call with
   the non-PDF leftovers in both `onDrop` and `FileTrigger.onSelect`); make
   `label`/`description` **required** (delete default strings). Update the
   three call sites in `Convert.tsx` in the same commit — add
   `convertMessages` to `messages.ts` now (see Phase 5a list) and pass
   `dropTitle`/`dropHint` etc. from there; never inline literals.
10. `.ds-storage-meter`: track height `0.4375rem` (7px), label row
    `--font-size-xs` muted, fill primary (already).
11. `.ds-dialog`: radius `var(--radius-card)`, box-shadow `var(--shadow-frame)`
    (solid fill comes free from the glass recipe change).
12. `.ds-tab-nav` restyle: item = `border: 1px solid transparent`, radius
    `var(--radius-input)`, muted text; active = primary-soft bg + primary text
    + `--color-primary-border` border. Hide `.ds-tab-nav__indicator`
    (`display: none`, delete its position rules). Keep the mobile fixed
    bottom-bar pattern and the ≥64rem vertical variant. Add `.ds-tab-nav__label`
    (the HTML `.navlabel`: xs, weight-label, letter-spaced uppercase muted) for
    Phase 5. **Do not touch TabNav.tsx types yet.**
13. New one-screen section (classes only, consumed in Phase 5): `.ds-stage`
    (stage gradient, min-height 100vh, `--stage-padding`), `.ds-frame`
    (max-width, centered, 3-col grid `var(--layout-sidebar-width) minmax(0,1fr)
    var(--layout-rail-width)`, frame bg/border/radius/shadow, `--frame-padding`
    /`--frame-gap`; single column under 64rem), `.ds-sidebar` + `__foot`
    (column flex, foot `margin-top: auto`), `.ds-brand` (migrated `.app-brand`
    rules), `.ds-work` + `__head` (column flex; h1 + muted subtitle),
    `.ds-panel-head` (title + muted hint row), `.ds-start-row` + `__note`,
    `.ds-rail` + `__foot` + `__privacy` (column flex, centered, foot pinned).
14. New `RailButton.tsx` (`.ds-rail-button`): React Aria Button, vertical
    icon+label chip — white card fill, `--color-outline` border, radius
    `var(--radius-chip)`, xs label, primary icon; 44px min hit area. Export
    from `index.ts`.
15. Retire glass tokens: after (1)–(3) nothing references `--glass-*` — delete
    the recipe + theme-resolved glass blocks from both themes in `tokens.css`
    (grep `var(--glass-` first; `--shadow-raised`/`--shadow-dialog` stay, they
    are used by review/resume styles).
16. Survivors untouched: `ProgressBar`, `ResumeCard`, `TypewriterLine`,
    `Badge`, `StatusChip`, `GlassInput` component code — say in the commit they
    are the kit for BUILD_PLAN Phases 5–7, not dead code.

**Gate:** `npm test` + `npm run build` + `npm run lint` green; old 4-tab shell
renders with the new skin.

### Phase 4 — theme 3-way → 2-way

1. `theme.ts`: `ThemePreference = 'light' | 'dark'`; stored `'system'` →
   `removeItem` + treat as unset; unset follows `prefers-color-scheme` live
   (keep the matchMedia listener for the unset case only); `setThemePreference`
   always persists. Internal "no stored preference" state replaces the
   `'system'` union member — check `resolveTheme` callers and
   `handleStorage`.
2. `index.html` inline script already only honors `'light'|'dark'` — no change
   (hexes done in Phase 2).
3. `ThemeSwitcher.tsx`: rewrite as 2-state pill — two icon buttons (inline
   sun/moon SVGs), `aria-pressed`, pressed = white chip + primary icon; group
   label + `aria-live` line, strings from `messages.ts`
   (`appMessages.themeGroupLabel/themeLight/themeDark`), `.sr-only` as needed.
   CSS: `.ds-theme-switcher` becomes the small rail pill (HTML `.theme-toggle`).

**Gate:** green ×3; hand-seed `localStorage['codox-theme-preference']='system'`
→ boots clean, follows OS until first click, then persists.

### Phase 5 — the one-screen App (ONE commit; AppTab ripple forbids splitting)

**Adapted from the plan: the real Convert survives; this phase re-houses it.**

5a. `messages.ts` additions first:
   - `appMessages`: `brandName`, `brandTagline` (the current header's "Exam
     PDFs → Triviadox"), `navLabel` "Workspace", `navConvert`, `navHistory`,
     `railApi` "API", `railHelp`, `railPrivacy`, `storageLabel`
     "On-device storage", `apiDialogTitle`, `helpDialogTitle`,
     `privacyDialogTitle`, `themeGroupLabel`, `themeLight`, `themeDark`.
   - `convertMessages`: `title`, `subtitle` (HTML line 284 wording), `dropTitle`
     "Drop PDFs here", `dropHint` "batch of PDFs supported", plus keys for the
     real screen's current literals: `dropMoreTitle`/`dropMoreHint`,
     `keyDropTitle`/`keyDropHint`, `filesReady(n)`, `batchOverrideHint`,
     `clearAll`, `keepOriginalLabel`/`Hint`, `startButton` "Start converting",
     pages/minutes note, running/done headings, review/export button labels…
     (sweep `Convert.tsx` for every user-visible literal). **No
     `startNotAvailable` — Start is real.**
   - `historyMessages` additions: `emptyTitle` "No runs yet", `emptyBody`.
   - Reuse existing `uploadMessages.*`.
   - Remove user-visible default-prop strings from shared components
     (`FileRow` `answerSourceLabel`/`flagLabel`, `StorageMeter` `label`,
     `Select` option literals in `FileRow`'s options list, `FileDropZone`
     "Choose files", Dialog `dismissLabel`, AppShell "Minimize review" —
     move to messages.ts and pass from call sites).

5b. Files:
   1. `src/state/storage.ts` (new): `useStorageEstimate()` — guards
      `navigator.storage?.estimate`, returns `{used,total} | null`
      (null = unavailable / rejected / zero-total), reads once on mount.
   2. `TabNav.tsx`: generalize to `TabNav<T extends string>` with required
      `items` prop (id/label/optional icon); `AppTab` narrows to
      `'convert' | 'history'`; delete the built-in tab list.
   3. `Convert.tsx`: keep ALL behavior; restructure render onto the new
      classes — `.ds-work__head` (title + subtitle), dropzone first when
      empty, `.ds-panel-head` for "N PDFs ready" + `batchOverrideHint`,
      `.ds-start-row`/`__note` for the start row (real page count + minutes
      stays — it is real data from `readPdfInfo`, not a fake estimate),
      strings from `convertMessages`, `onRejected` → `uploadMessages.notPdf`.
      Rename `.convert-*`/`.app-tab-screen` styles into `.ds-*` shared classes
      as they migrate into `components.css`.
   4. `src/screens/History.tsx` (new): heading + honest empty-state panel
      (`historyMessages.emptyTitle/emptyBody`). `state/runs.ts` exists but
      History-as-run-browser is BUILD_PLAN scope — empty state only unless the
      owner says otherwise.
   5. `KeysPanel.tsx`: reshape to dialog body — drop `<section>`/`<h1>` chrome
      (title comes from the Dialog); keep `GeminiKeySection allowRemove` +
      DEV-only `DevTestCall` exactly.
   6. Delete `Placeholders.tsx`: Help copy (already message-sourced) moves to
      the Help dialog body (tiny `HelpContent.tsx` if App crowds).
   7. `App.tsx` full rewrite:
      - Keep: FirstRun gate, `geminiController.refreshStatus()` effect
        verbatim, `?pdfspike=1` branch.
      - `.ds-stage > .ds-frame`: `.ds-sidebar` (brand, `.ds-tab-nav__label`,
        TabNav[convert,history], `__foot` = StorageMeter only when estimate ≠
        null) · `main.ds-work` renders Convert|History · `.ds-rail`
        (RailButton API/Help; `__foot` = ThemeSwitcher + privacy text button).
      - State: `activeTab: AppTab`, `openDialog: 'api'|'help'|'privacy'|null`.
        Three `Dialog`s: api → KeysPanel body; help → help copy; privacy →
        `firstRunMessages.privacyNotice` + `keyMessages.keyOwnership`.
      - <64rem: single column, rail hidden, bottom-bar TabNav carries
        Convert/History/API/Help — API/Help entries open dialogs and do NOT
        change `activeTab`.
      - Delete `AppShell.tsx` + its export + its `.ds-app-shell*` CSS block
        (the frame replaces it). Note: AppShell's review-takeover focus
        behavior — `Convert.tsx` manages its own focus hand-off already
        (`sectionRef`), so nothing is lost; verify.
   8. Delete `src/screens/app.css`: migrate ALL live rules into
      `components.css` — `.app-brand`→`.ds-brand` (done in Phase 3),
      `.app-tab-screen` (→ `.ds-work` equivalents), `.key-section*`,
      `.key-inline-note*`, `.key-ownership-note`, `.first-run*`, all
      `.convert-*`, all `.review*` (+ `review-tick` keyframes, `.review-paper`
      — its `#fdfdf8` paper-white needs a token: add `--color-paper` or reuse;
      NO raw hex may remain), `.pdf-spike-*`. Drop the import from App.tsx.
      `index.css` = reset + imports + focus/selection/#root/.sr-only/
      reduced-motion only.
   9. `FirstRun.tsx`: behavior untouched; wrap in `.ds-stage` so the
      walkthrough sits on the framed cream world.

**Gate:** green ×3 + dev click-through (Phase 7 script).

### Phase 6 — docs, design-system purge, CLAUDE.md

1. `Docs/BUILD_PLAN.md`: check the Phase 3 sign-off box with a dated note
   (owner approved one-screen-layout.html 2026-07-11; mockups retired; the
   running app is the design artifact). Rewrite the `/?mockups=1` items;
   repoint "per the mockup" phrases (Phases 4–7) → "per the in-app one-screen
   design".
2. `Docs/PHASE4_PLAN.md`: update mockup/spike references (spike retired after
   Phase-2 evidence was banked); mark the copy-migration note done.
3. `design-system/ERROR_LANGUAGE.md`: header points at `src/copy/messages.ts`
   + the running app; delete the `/?mockups=1` pointer. Stays the copy source
   of truth.
4. Delete `design-system/{DESIGN_SYSTEM,DESIGN_AUDIT,IMPLEMENTATION_PLAN,PHASE3_DESIGN_DECISIONS,TRIVIADOX_PALETTE,README}.md`.
   Keep `ERROR_LANGUAGE.md` + `assets/`.
5. `CLAUDE.md`, one short rule under Stack & conventions: *the running app is
   the only design artifact; UI approval = owner click-through in the app; no
   standalone HTML mockups as approval artifacts; every visual value comes
   from `tokens.css`, every shared pattern is one class in `components.css`.*
6. **Only after the owner's click-through sign-off:** delete
   `design-system/one-screen-layout.html`.

### Phase 7 — verification checklist

- [ ] `npm test`, `npm run build`, `npm run lint` — all green.
- [ ] Grep-proofs in `src/` (already clean for the Phase-1 set): zero hits for
      `mockups|DesignGallery|Phase2SpikeChecks|ProviderOrderList|app\.css|\?gallery|\?spike`;
      **adapted:** `silly-sentences` and `useCurrentJob` are allowed (kept);
      no `'system'` ThemePreference; no `backdrop-filter|--glass-`;
      `grep -E '#[0-9a-fA-F]{3,8}' src/design/components/components.css` →
      empty; no user-visible string literals in `Convert.tsx`/`History.tsx`/
      `App.tsx`.
- [ ] Dev click-through (`npm run dev`, fresh profile): FirstRun on framed
      stage → one screen (232px sidebar / 96px rail / cream stage) → drop 2
      real PDFs → "2 PDFs ready" with real names/sizes **and real page counts
      (they are real now — readPdfInfo)** → per-file pill + batch select +
      toggle work → **Start actually converts** (needs a Gemini key) → drop a
      .txt → notPdf message → History empty state → API dialog: full key
      check/replace/remove + DEV test call → Help + Privacy dialogs → theme
      toggles and persists; hand-seeded `'system'` boots clean → <64rem:
      single column, bottom bar works, dialogs trap focus above the bar.
- [ ] StorageMeter: real numbers in Chromium; API stubbed away → meter absent,
      no layout hole.
- [ ] PWA: `build` + `preview` → new theme colors in manifest; SW updates on
      reload (registerType 'prompt' may need a second reload — known).
- [ ] Tauri smoke (WebView2): frame, dialogs, drop zone, storage meter noted.
- [ ] Capacitor smoke (Android): bottom bar, 44px targets, dialog focus,
      status-bar color `#f4e9e0`/`#191013`.
- [ ] Flag to owner at sign-off: light muted text 4.08:1 (HTML value, locked).
- [ ] **Owner click-through sign-off in the running app** → then and only
      then: delete `one-screen-layout.html`, finalize BUILD_PLAN sign-off,
      merge to `main` (auto-release ships the exe/apk).

## Risks carried forward (from the plan, still live)

- AppTab ripple: TabNav retype + App rewrite + KeysPanel/Placeholders reshape
  are ONE commit.
- Grouped selectors: delete selectors, never shared rules (done correctly for
  ProviderOrderList; same care for `.ds-app-shell` removal in Phase 5).
- `tsc -b` typechecks unreferenced files — keep deletion + importer edits in
  the same commit.
- CI ships on every push to `main` — stay on `one-screen-port` until Phase 7
  passes and the owner signs off.
- Don't "fix" fonts to match the HTML.
- Dialog focus on mobile WebViews; dialog z-index (100) already above the
  bottom bar (20).
