# Phase 1 Build Plan — Core Web Scaffold

_Audience: AI coding agents. Execution unit: one task at a time, in order.
Parent plan: [../BUILD_PLAN.md](../BUILD_PLAN.md) Phase 1._

## Status

**Not yet executed** (plan written 2026-07-09). This plan serves two modes:

- **EXECUTE mode** (default while `src/` holds only `.gitkeep`): run each
  task's Steps, then its Acceptance checks.
- **VERIFY mode** (once the scaffold exists): run Acceptance checks only;
  fix failures; skip Steps that already hold.

## Package decisions (search-before-build, researched 2026-07-09)

Per CLAUDE.md's search-before-build rule, a Sonnet research subagent with web
search resolved the open package choices on 2026-07-09. Versions below are
what was current that day; install whatever is latest-stable at execution
time unless a major bump breaks compatibility — then stop and report.

| Concern | Decision | Version then | License | Note |
|---|---|---|---|---|
| Scaffold | `npm create vite` `react-ts` template | Vite 8 (8.1.x) | MIT | Needs Node ≥ 20.19 / ≥ 22.12 |
| React | React 19 (template default) | 19.2.x | MIT | Still current major |
| Router | **None — deliberate deviation, see below** | — | — | Fallback if ever needed: wouter (ISC — not on CLAUDE.md's MIT/Apache/BSD list; re-flag to owner before adopting) |
| State | `dexie` + `dexie-react-hooks` (`useLiveQuery`) | 4.x / 4.4.x | Apache-2.0 | Official Dexie-org packages. **No Zustand**: Dexie is the single source of truth; a mirror store would need manual sync both ways — pure bug surface |
| PWA | `vite-plugin-pwa` | 1.3.x | MIT | Supports Vite 8 (peer range extended after Vite 8 shipped) |
| Icons | `@vite-pwa/assets-generator` (dev-time CLI only) | 1.0.x | MIT | Generates full icon set from one SVG |
| Deploy | Cloudflare Pages, **Git integration** | — | — | Free tier: 500 builds/mo, unlimited static bandwidth, $0 |

### Deviation from the parent plan — no router (owner sign-off required)

[../BUILD_PLAN.md](../BUILD_PLAN.md) Phase 1 says "Router with the five
screens as empty placeholder routes." The research verdict: for exactly five
**linear, single-job-flow** screens with no bookmarkable deep links, a router
adds a dependency and API surface for zero functional gain over a
`switch (job.step)` driven off the job-state store this phase builds anyway.
It also sidesteps URL/history quirks inside the future Tauri/Capacitor
WebViews (Phase 2). React Router is now at v8 (~58 KB min+gz, framework
machinery unused here); TanStack Router's typed-routing value is likewise
unused, and 42 `@tanstack/*` packages were hit by a (quickly contained)
supply-chain attack in May 2026 — no reason to add an unneeded dependency.

**The parent plan's "Done when" gate ("five navigable screens") is
unchanged.** Screens switch on persisted job state instead of URLs. The
owner accepts this deviation by ticking the Phase 1 router checkbox in
`BUILD_PLAN.md` at the exit gate (optionally rewording it); if rejected,
adopt wouter and re-flag its ISC license first.

### PWA update strategy — `prompt`, not `autoUpdate`

`registerType: 'autoUpdate'` force-enables Workbox `skipWaiting`, which can
swap the service worker under a user mid-job. Codox jobs are long-running
and export-early is law — use `registerType: 'prompt'` so an update never
interrupts in-progress work. Deliberate decision; do not "simplify" back to
`autoUpdate`.

## Global rules binding every task in this plan

1. Read `/CLAUDE.md` before starting. Its hard rules override this plan on
   conflict.
2. **Never run `git commit` or `git push`.** The owner commits manually.
   When a task's output is "changes ready to commit," stop, report the file
   list, and hand off. Tasks below marked `[OWNER]` are owner-manual.
3. Do not create files outside the repo root `/Users/lotfy/Documents/GitHub/Codox`.
4. If any Acceptance check cannot be made to pass, stop and report — do not
   improvise around it.
5. **COST-ZERO gate on dependencies:** every package added in this phase must
   already appear in the decision table above with a permissive license. Any
   other package a task seems to need → stop and report; do not install it.

## Preconditions (check before T1.1)

| Check | Command | Expected |
|---|---|---|
| Node ≥ 20.19 / ≥ 22.12 | `node --version` | ✓ (v26.3.0 on the dev machine, 2026-07-09) |
| npm present | `npm --version` | exit 0 |
| Repo clean, on `main` | `git status --porcelain` empty; `git branch --show-current` → `main` | ✓ |
| Phase 0 gate passed | `Docs/Build_Plans/Phase_0_Repo_Setup.md` exit gate green | ✓ (verified 2026-07-09) |

---

## T1.1 — Scaffold Vite + React 19 + TypeScript (strict)

**Objective:** the repo root is a buildable Vite + React 19 + TS-strict app.

**Steps:**
1. The repo root is non-empty, so scaffold in a temp dir outside the repo:
   `npm create vite@latest codox-scaffold -- --template react-ts`.
2. Move the template's files into the repo root, with two exceptions:
   - `.gitignore`: **merge** (union of lines) into the existing one — do not
     overwrite Phase 0's file (T1.2 owns the final content).
   - `README.md`: discard the Vite boilerplate; write a minimal Codox
     README instead (3–5 lines: what Codox is, link to
     `Docs/CODOX_CONTEXT.md`, "built per `Docs/BUILD_PLAN.md`").
3. Delete `src/.gitkeep` (real files now track `src/`).
4. Strip demo content: reduce `App.tsx` to a minimal shell (no logo assets,
   no counter demo, no `App.css` demo styles); delete unused demo assets
   (`src/assets/react.svg`, `public/vite.svg` — a Codox logo arrives in T1.3).
5. `npm install`.
6. Confirm strict mode: `tsconfig.app.json` (or `tsconfig.json`) has
   `"strict": true` — the template default; do not weaken any compiler flag.

**Acceptance:**
- `npm run build` → exit 0 (template script runs `tsc -b && vite build`)
- `grep '"strict": true' tsconfig.app.json tsconfig.json 2>/dev/null` → ≥ 1 match
- `node -p "require('./package.json').dependencies.react"` → starts with `^19` (or `19`)
- `test ! -f src/.gitkeep` → exit 0
- `package.json` contains **no** dependency outside the decision table
  (template defaults + react/react-dom are fine)

## T1.2 — `.gitignore` additions for Vite/PWA

**Objective:** build and dev artifacts from the new toolchain never enter
git history.

**Steps:** ensure `.gitignore` contains (union with Phase 0's entries and
the template's): `node_modules/`, `dist/`, `dev-dist/` (vite-plugin-pwa dev
output), `*.local`, `.DS_Store`, editor dirs from the template
(`.vscode/*` with `!.vscode/extensions.json`, `.idea/`) if the template
provided them.

**Acceptance (test case):**
1. `mkdir -p dev-dist && touch dev-dist/sw.js .env.local`
2. `git status --porcelain` → no line mentioning `dev-dist/` or `.env.local`
3. Clean up: `rm -rf dev-dist .env.local` (safe: exact paths created in
   step 1; do not widen the rm)

## T1.3 — vite-plugin-pwa: manifest, service worker, icons

**Objective:** the built app is installable (manifest + registered service
worker + required icons), with the `prompt` update strategy.

**Steps:**
1. `npm i -D vite-plugin-pwa @vite-pwa/assets-generator`.
2. Create `public/logo.svg` — a simple placeholder (rounded square,
   high-contrast "Cx" glyph, content within the center 80% so the maskable
   variant survives cropping). Any legible placeholder is acceptable; the
   owner supplies real art later.
3. Generate icons: `npx @vite-pwa/assets-generator --preset minimal-2023
   public/logo.svg` → emits 192×192 + 512×512 (+ maskable) PNGs,
   180×180 apple-touch-icon, favicon into `public/`.
4. Configure the plugin in `vite.config.ts`: `registerType: 'prompt'`
   (see decision above), manifest with `name: "Codox"`,
   `short_name: "Codox"`, description, `display: "standalone"`,
   theme/background colors, and the 192/512/maskable icon entries.
5. Add to `index.html`: `<link rel="apple-touch-icon" ...>` (iOS ignores
   manifest icons for Add-to-Home-Screen) and the favicon link; set
   `<title>Codox</title>` and a theme-color meta.
6. Register the service worker in app code per the plugin's `prompt`-mode
   docs (an update notice UI can stay a stub — a `console.log` — until
   Phase 3 designs it).

**Acceptance:**
- `npm run build` → `dist/` contains `manifest.webmanifest` and `sw.js`
- `node -p "JSON.parse(require('fs').readFileSync('dist/manifest.webmanifest','utf8')).name"`
  → `Codox`; manifest icons include sizes `192x192` and `512x512`
- `grep apple-touch-icon dist/index.html` → ≥ 1 match
- Manual (10 s): `npm run preview` → open in Chrome → DevTools → Application
  → Manifest shows no installability errors

## T1.4 — Job-state store skeleton (Dexie)

**Objective:** a typed job-state skeleton persisted to IndexedDB; the app's
current screen survives a reload.

**Boundary — do not invent engine state.** The engine's real job/page/row
shapes arrive in Phase 6 from [../CODOX_MIGRATION.md](../CODOX_MIGRATION.md)
(semantics pinned). Phase 1 defines only the app-shell skeleton below;
adding speculative engine fields now creates drift risk.

**Steps:**
1. `npm i dexie dexie-react-hooks`.
2. `src/state/types.ts`:
   `type AppStep = 'setup' | 'upload' | 'progress' | 'review' | 'export'`
   and a minimal
   `interface JobState { id: string; createdAt: number; step: AppStep }`.
3. `src/state/db.ts`: Dexie database `codox`, version 1, table `jobs`
   (primary key `id`). Version-1 schema is intentionally minimal; later
   phases migrate via Dexie `.version(n)` upgrades.
4. `src/state/useCurrentJob.ts`: hook wrapping `useLiveQuery` that reads
   (creating on first run) a single current job and exposes
   `setStep(step: AppStep)` writing through Dexie. Writes go **only**
   through Dexie — no mirrored in-memory copy (see decision table).
5. Ephemeral UI state (open dialogs etc.) stays in plain `useState` —
   never mixed into persisted job state.

**Acceptance:**
- `npm run build` → exit 0
- Both `dexie` packages in `package.json`, nothing else new
- Manual (30 s): `npm run dev` → switch screens (after T1.5; if executing
  in order, defer this check to T1.5's acceptance) → reload the page →
  the same screen is shown (state came back from IndexedDB, visible under
  DevTools → Application → IndexedDB → `codox`)

## T1.5 — Five placeholder screens + navigation

**Objective:** the five screens exist as placeholders and are navigable by
keyboard alone, driven by persisted job state (no router — see deviation).

**Steps:**
1. `src/screens/`: `Setup.tsx`, `Upload.tsx`, `Progress.tsx`, `Review.tsx`,
   `Export.tsx`. Each renders an `<h1>` with its name plus one sentence of
   intent taken from [../CODOX_CONTEXT.md](../CODOX_CONTEXT.md) §6 (so the
   placeholder communicates purpose, not lorem ipsum).
2. `App.tsx`: `switch` on `useCurrentJob().step` to render the screen, plus
   a temporary always-visible `<nav aria-label="Screens">` of five real
   `<button>` elements calling `setStep`. This nav is Phase-1 scaffolding;
   the real flow (Phase 3+) will control step transitions.
3. Real DOM, semantic elements, visible focus states — per CLAUDE.md
   accessibility conventions. No CSS framework yet (Phase 3 owns design).

**Acceptance:**
- `npm run build` → exit 0
- `ls src/screens/` → the five files
- Manual (60 s): `npm run dev` → using only Tab/Enter, visit all five
  screens (each shows its own `<h1>`) → reload on Review → Review is still
  shown (completes T1.4's persistence check)

## T1.6 — [OWNER] Deploy to Cloudflare Pages (Git integration)

**Objective:** a public HTTPS URL serves the app; every push to `main`
auto-deploys.

**Agent action:** none beyond reporting readiness (T1.1–T1.5 green and
committed by owner). Owner steps, one-time, ~5 min:

1. dash.cloudflare.com → sign up / log in (free plan) → Workers & Pages →
   Create → **Pages** → **Connect to Git** → select `Lotfy14/Codox`.
2. Build settings: framework preset **Vite**, build command `npm run build`,
   output directory `dist`. Deploy.
3. Use **Git integration, not `wrangler` direct upload** — a direct-upload
   project can never be switched to Git integration later.
4. Note: Cloudflare steers new projects toward "Workers with static
   assets"; Pages remains fully supported with no deprecation deadline and
   is the simpler owner experience. Stick with Pages (researched
   2026-07-09; revisit only if Cloudflare announces an actual deadline).

**Acceptance (owner-verified):**
- `https://<project>.pages.dev` loads the app over HTTPS
- A later push to `main` triggers an automatic redeploy

## T1.7 — [OWNER] Installability on real phones

**Objective:** the parent plan's gate — the PWA installs on an iPhone and
on Android Chrome.

**Owner steps:**
- iPhone Safari → open the pages.dev URL → Share → **Add to Home Screen** →
  launch from the icon → app opens standalone (no Safari chrome) with the
  Codox icon (from the 180×180 apple-touch-icon).
- Android Chrome → open the URL → install prompt or ⋮ → **Add to Home
  screen / Install** → launch → standalone window.
- On either device: navigate to Review, kill the app, relaunch → Review is
  still shown (IndexedDB persisted on-device).

**Acceptance (owner-verified):** both installs launch standalone and the
reload-persistence check passes.

---

## Phase exit gate

All of: T1.1–T1.5 Acceptance green (agent-verifiable) AND T1.6–T1.7
confirmed by owner. On exit, tick the Phase 1 checkboxes in
[../BUILD_PLAN.md](../BUILD_PLAN.md) (edit only — owner commits; ticking
the router line = accepting the no-router deviation, reword it if
preferred) and report Phase 2 (shell spikes) as next.
