# Codox — Build Plan

_Written 2026-07-09. Stack per [TECHSTACK_RESEARCH.md](TECHSTACK_RESEARCH.md):
TypeScript + React 19 + Vite web-core → PWA (web/iPhone/macOS), Tauri 2
(Windows `.exe`), Capacitor (Android `.apk`). Engine semantics migrate as-is
from [CODOX_MIGRATION.md](CODOX_MIGRATION.md). Grading stays in CodoxSandbox._

_Owner decisions baked in: AI agents write most code · one codebase identical
everywhere · Android ships a real `.apk` · distribution via GitHub Releases +
a web link · users are the owner's own group using public-domain documents, so
the consent notice is kept minimal (one line, first run)._

Phases are ordered so that the riskiest unknowns die first and no phase
builds on an unproven assumption. Each phase ends with a "Done when" gate.

---

## Phase 0 — Repo & ground rules (~half a day)

- [x] `git init`, first commit with the three context docs
- [x] Create `CLAUDE.md` for coding agents: the three hard rules (COST-ZERO,
      NEVER-GUESS, minimal-consent), the output contract pointer, "engine
      semantics are pinned — never edit the three prompts," code conventions
- [x] `CLAUDE.md` rule — **search before build**: before implementing any
      non-trivial functionality from scratch, dispatch a Claude Sonnet 5
      research subagent (web search) to check whether an existing package
      already does it. Adopt the package if it's maintained, permissively
      licensed (MIT/Apache/BSD — never AGPL, never paid), and reasonably
      sized; hand-write code only when the subagent comes back empty.
      Goal: minimize hand-written code. (Trivial glue — a loop, a small
      helper — needs no search)
- [x] `.gitignore`, basic folder layout (`src/`, `src-tauri/` later,
      `android/` later)
- [x] Create the GitHub repo, push

**Done when:** repo exists on GitHub with docs + CLAUDE.md committed.

## Phase 1 — Core web scaffold (~1 day)

- [x] Scaffold Vite + React 19 + TypeScript
- [x] Add vite-plugin-pwa (manifest, service worker, installability)
- [x] Router with the five screens as empty placeholder routes:
      Setup → Upload → Progress → Review → Export
- [x] App-wide state store skeleton (job state shape defined, persisted to
      IndexedDB via Dexie — even if empty for now)
- [ ] Deploy to Cloudflare Pages; confirm the PWA installs on an iPhone
      (Add to Home Screen) and on Android Chrome
      _(Cloudflare auto-deploy live; Android shell confirmed 2026-07-11.
      iPhone Add-to-Home-Screen still unconfirmed — leave unchecked until tested.)_

**Done when:** a public URL serves an installable empty app with five
navigable screens.

## Phase 2 — Shell spikes: kill the packaging risk (~2–3 days)

The point is to prove distribution while the app is still trivial, so a shell
failure costs a day, not a rewrite.

- [x] **Capacitor Android spike** (hardest, do first): wrap the Phase-1 build,
      generate a signed `.apk` (self-signed keystore), sideload on a real
      Android phone. Prove: file picker opens a PDF, share sheet exports a
      dummy zip, IndexedDB persists across restarts
      _(Confirmed 2026-07-11: sideloaded, file picker + share sheet + zip
      download + IndexedDB persistence all worked.)_
- [x] **Tauri Windows spike**: NSIS `.exe`, install on a clean Windows
      machine/VM, walk the SmartScreen "More info → Run anyway" flow, app
      launches and navigates
      _(Confirmed 2026-07-11: installed past SmartScreen, launched, all five
      screens navigate.)_
- [x] **GitHub Releases dry run**: upload both artifacts to a release, download
      and install each from the release link on the target device
      _(Confirmed 2026-07-11: `v0.2.0-spike` prerelease holds both `.exe` and
      `.apk`; both downloaded from the release link and installed on device.)_
- [x] **Gemini direct-call check** (10 min, piggybacked here): one
      `generateContent` call with an image from the deployed browser app.
      Decides relay-drop for Phase 4
      _(2026-07-11: `gemini-3.5-flash` returned **HTTP 200** with candidates
      from inside the Tauri WebView2 shell and the Capacitor shell. WebView2 is
      Chromium and enforces CORS like a browser, so this supersedes the
      2026-07-08 "Gemini CORS-blocked" note. **Relay not needed** — re-confirm
      once on the deployed browser PWA before deleting the relay option
      entirely.)_
- [x] Write down the exact build commands for each shell in `docs/RELEASING.md`

**Done when:** both installers built from the same web bundle, installed from
a GitHub Release link on real devices, and the Gemini answer is known.

## Phase 3 — UI/UX design pass (~2–3 days)

Design before feature code. Each screen's *intent* from CODOX_CONTEXT.md §6
must survive; the surface is free.

- [x] Pick a component approach (headless primitives — Radix/React Aria — plus
      a small design system: colors, type, spacing)
- [x] Clickable mockups of all five screens (desktop + phone widths) —
      dev-only prototype at `/?mockups=1` (`src/mockups/`), composed from the
      Phase-3A component library on fake data:
      - Setup: exactly one user-supplied Gemini key; live validation
      - Upload: drop zone + the one declaration question (answers inside /
        separate file / none); second drop zone appears conditionally
      - Progress: per-file bars, "paused — resumes when quota allows" state
        designed as a calm state, not an error
      - Review: flagged row + source crop side-by-side, full keyboard flow
        (next flag / pick answer / confirm without touching the mouse)
      - Export: prominent manual export with no auto-download; share sheet on
        mobile, zip download on desktop
- [x] Error-language pass: every failure a tutor can hit, written in plain
      English ("Gemini is unreachable" ≠ "your key is wrong") — see
      `design-system/ERROR_LANGUAGE.md`; all strings visible
      in the mockups (Help tab shows the full catalog)
- [x] One-screen relayout (2026-07-11): mockups restructured to the owner's
      one-screen design — left workspace nav (Convert/History + storage),
      the whole job in one center column with review inline (no takeover),
      Keys/Help as overlay panels on a right utility rail. See
      `design-system/DESIGN_AUDIT.md` for what changed and why.
- [ ] Owner reviews mockups and signs off

**Done when:** owner has clicked through the five screens and approved them.

## Phase 4 — Setup screen + Gemini integration (~3–4 days)

The first real feature, because everything downstream needs a working key.
Detailed AI handoff plan: [PHASE4_PLAN.md](PHASE4_PLAN.md).

- [x] Store exactly one user-supplied Gemini API key on-device
      (2026-07-11: Dexie v3 singleton `credentials` record, fixed id
      `'gemini'`; replace overwrites, remove deletes, no second record
      representable)
- [x] **Per-user quota isolation:** Codox has no shared, bundled, developer, or
      fallback API key. Every Gemini request from an installation uses only
      the key entered on that installation, so one user can never consume
      another user's Gemini quota. (The controller reads only the singleton
      repository; `src/providers/controller.test.ts` fails if an alternate
      key source is introduced.)
- [x] Thin Google Gemini adapter behind the engine-facing provider interface;
      no NVIDIA NIM or other provider implementation for now
      (`src/providers/gemini.ts`, hand-written fetch per Step-1 research)
- [x] Gemini request controller: startup reachability probe, deterministic
      error taxonomy, and pause/resume on quota or connectivity loss; no
      cross-provider failover (`src/providers/controller.ts`)
- [x] Setup screen per the mockup: paste key → live test call → green check
      or plain-English failure; replace/remove the key, but do not add more
      (first-run walkthrough + Keys panel; flows driven in a headless
      browser against live Gemini, see PHASE4_PLAN.md Step-6 evidence)
- [x] Error taxonomy wired: bad key vs. provider unreachable vs. quota
      exhausted are three distinct, user-visible states (verified visually:
      danger / blue-neutral / amber with the ERROR_LANGUAGE.md words)
- [x] One-line first-run notice (pages are sent to the provider under your
      key) — minimal per owner decision (the exact canonical sentence)
- [x] Relay: **skipped** — Phase-2 Gemini direct-call check passed in the
      shells (2026-07-11). One open re-confirm: the deployed browser PWA path,
      before the relay option is deleted for good.

**Done when:** a user's real Gemini key validates in the UI, a test image call
round-trips using that exact key, and inspection confirms there is no code path
that can substitute a shared, bundled, developer, fallback, or second user's
key.

> **Gate status (2026-07-11):** every automated part is verified (see
> PHASE4_PLAN.md Step-6 evidence): live wrong-key/unreachable states against
> the real Gemini endpoint, no-fallback behavior, provenance tests, and the
> dev-only test-image-call surface in Keys. The one step only the owner can
> do — paste a **real** key, see it validate green, and press "Send test
> image call" (dev build, Keys tab) — remains. Also still open from Phase 2:
> one `generateContent` re-confirm from the deployed browser-PWA origin.

## Phase 5 — PDF pipeline (~4–5 days)

All client-side, memory-disciplined. This phase decides whether the app
survives on phones.

- [ ] Integrate @hyzyla/pdfium: open PDF, page count, render one page at a
      controllable DPI
- [ ] **Page-at-a-time discipline**: render → hand off → destroy canvas +
      free WASM page before touching the next; re-instantiate the WASM module
      every ~5–10 pages as a safety net
- [ ] pdf.js `getTextContent()` alongside, for PDFs that have a text layer
- [ ] Figure cropping: `createImageBitmap(sx,sy,sw,sh)` → small canvas →
      compressed blob; use pdfium sub-region rendering for high-DPI crops
- [ ] Image budget: compressed JPEG per page for LLM calls; nothing full-res
      retained
- [ ] Upload screen per mockup: multi-PDF drop, declaration question wired
      into job state
- [ ] Stress test: a real 25-page scan on a mid-range Android phone and the
      oldest available iPhone — no crash, memory stays flat page-to-page

**Done when:** the 25-page stress test passes on both phones.

## Phase 6 — Engine port (~5–7 days)

Port the Planner-Worker-Audit engine per CODOX_MIGRATION.md. Semantics are
pinned; only the executor is new.

- [ ] Deterministic emit layer first: CSV writer implementing the 9+1-column
      contract exactly (IDs, JSON-array cells, relative image paths,
      `needs_review` reasons) — this owns formatting, never the model
- [ ] Planner call: page classification + plan, per the migrated prompt
- [ ] Worker calls: per-section extraction, declaration-routed (grid / inline
      marks / handwritten / none)
- [ ] Audit gate: the deterministic checks + audit prompt; any doubt →
      blank + flag (NEVER-GUESS enforced in code, not just prompts)
- [ ] Answer-form resolve paths, incl. conflicting-marks → blank + flag, and
      wrong-declaration → degrade to everything-flagged
- [ ] **Pause/resume**: job state checkpointed to IndexedDB after every step;
      survives reload, quota pause, connection drop. (Decision point: if
      hand-rolling this is painful, adopt LangGraph.js as the executor with a
      custom IndexedDB checkpointer — semantics unchanged)
- [ ] Progress screen wired to real job state, quota-aware pacing
- [ ] First end-to-end run: clean appendicitis PDF → bundle → send CSV to
      CodoxSandbox for grading. Iterate until **127/127**
- [ ] **Measure and record quota burn** on a real 25-page scan (the doc's
      "one number that could force a redesign") → write it into this file

**Done when:** appendicitis grades 127/127 in CodoxSandbox and the quota-burn
number is written down.

## Phase 7 — Review & Export screens (~4–5 days)

Where the product quality lives.

- [ ] Review screen per mockup: flagged rows with source crops beside them,
      set/correct answers, virtualized list, complete keyboard flow
- [ ] Review works fully offline on an already-converted bundle
- [ ] Export: fflate streaming zip; `navigator.share({files})` on
      mobile (files-only payload — iOS quirk), download on desktop;
      Capacitor share plugin inside the `.apk`
- [ ] **Export-early**: keep the primary manual export action prominent when
      review completes; no auto-download or eviction nags beyond the quiet
      "not exported yet" badge
- [ ] Bundle correctness: unzip → folder moves anywhere → image paths still
      resolve; batch of 3 PDFs → 3 namespaced bundles
- [ ] Run the hard gold inputs end-to-end (scanned IM ×2, derm
      photo-of-screen) → grade in CodoxSandbox; fix until the mark-reading
      and grouping gates pass

**Done when:** all four gold PDFs pass their gates in CodoxSandbox and a
non-technical person can review + export on a phone unaided.

## Phase 8 — Hardening & release (~3–4 days)

- [ ] Degraded-input behavior: one bad page flags and continues; wrong
      declaration degrades safely; provider outage mid-job pauses and resumes
- [ ] Rebuild both shells from the final web build; install-test each again
- [ ] Landing page: download buttons (Windows/Android → GitHub Release),
      iPhone 2-step Add-to-Home-Screen visual guide, note for school-managed
      Windows laptops ("use the browser version")
- [ ] `v1.0` GitHub Release: `.exe`, `.apk`, changelog
- [ ] Hand the links to the first real users; watch the first sessions

**Done when:** a real user on their own device converts a real PDF, reviews
it, exports it, and imports it into Triviadox — without help.

---

## Rough total

~4–5 weeks of focused build time. Phases 0–2 ≈ first week (all risk-killing),
Phases 3–5 ≈ weeks 2–3, Phases 6–7 ≈ weeks 3–4, Phase 8 ≈ final week.

## Standing rules while building

1. **The gold suite is the referee** — a change "works" when CodoxSandbox
   says so, not when it looks right.
2. **Never let the model own formatting** — deterministic code emits, models
   only read (Phase-0b lesson).
3. **The app is never the sole holder of a user's work** — export-early is a
   law, not a feature.
4. **Measure quota before optimizing anything** — the Phase-6 number decides
   whether coarse batching / fewer calls become priorities.
