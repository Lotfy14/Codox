# Phase 4 — Setup screen + Gemini integration: AI handoff plan

_Written 2026-07-11. Audience: an AI coding agent with full access to this
repository. Execute the steps in order; each ends with a "Done when" gate.
Scope is Phase 4 of [BUILD_PLAN.md](BUILD_PLAN.md): the first real feature —
one user-supplied Gemini key, Gemini request handling, quota-aware pause/resume,
and the real API-key/first-run UI. The phase gate: **a user's real Gemini key
validates in the UI and a test image call round-trips using that exact key,
with no shared, bundled, developer, fallback, or second-user key path.**_

---

## 0. Read these first (in order, before writing any code)

1. `CLAUDE.md` — the three hard rules (COST-ZERO, NEVER-GUESS, keys
   on-device), search-before-build, stack conventions. **Binding.**
2. `Docs/CODOX_CONTEXT.md` §7 — the provider & key model: exactly one
   user-supplied Gemini key per installation, no quota sharing or fallback
   key, the measured CORS facts, and why "unreachable" must never be
   misdiagnosed as "wrong key" (BLIND-SPOTS #9).
3. `design-system/DESIGN_SYSTEM.md` — the component contract. Phase 4 screens
   compose these components; the "Rules screens must follow" section is
   binding, especially rule 6 (wrong key = danger, unreachable = blue-neutral,
   quota = amber, working = success — never collapsed).
4. `design-system/ERROR_LANGUAGE.md` — the owner-reviewed words for every
   state and the canonical provider wording. `src/mockups/copy.ts` still
   contains historical multi-provider prototype copy; update it from the
   canonical document when promoting mockup code, never the other way around.
5. `src/mockups/` — **the visual UI reference, not the provider model.** Reuse
   the first-run and API-panel layout where it fits, but remove provider lists,
   provider ordering, add-provider controls, and failover copy. The real UI
   replaces simulation (`simulateKeyCheck.ts`) with Gemini calls.
6. Current code: `src/App.tsx` (placeholder five-step nav that Phase 4
   replaces with the real shell), `src/state/db.ts` + `src/state/types.ts`
   (Dexie patterns), `src/screens/Phase2SpikeChecks.tsx` (must keep working —
   it is the Phase-2 evidence surface).

## 1. Locked decisions — do not re-litigate

- **Provider (locked): Google Gemini only.** Keep one thin adapter interface so
  the engine is not coupled to HTTP details, but do not implement NVIDIA NIM or
  any other provider. Do not build a provider chain.
- **Exactly one key per installation.** The key is supplied by that user and
  may be replaced or removed. There is no add-more-keys flow.
- **Quota isolation is non-negotiable.** Codox has no shared key pool, bundled
  key, developer key, fallback key, or remote key lookup. Every Gemini request
  uses only the key stored on that installation, so one user cannot consume
  another user's Gemini requests or quota.
- **The three failure states are distinct** in words, color, and code:
  wrong key (danger) ≠ can't reach (blue-neutral) ≠ resting until quota
  returns (amber, calm). `StatusChip` already implements them.
- **The Gemini key stays on-device.** It is stored locally, sent only to
  Gemini, and never logged, placed in URLs, included in error reports, or
  synchronized between installations.
- **Navigation follows the approved shell.** Phase 4 makes the API-key panel
  and first-run flow real; Convert/History/Help remain honest placeholders.
- **One codebase.** No per-platform network forks. If a platform-specific
  transport ever becomes unavoidable (see Gemini/CORS below), it must hide
  behind the same adapter interface, chosen at runtime — never a UI fork.
- **First-run notice is one line**, the exact sentence in
  `firstRunCopy.privacyNotice` (owner-approved minimal consent).

## 2. RESOLVED: the Gemini/relay decision

**Resolved 2026-07-11.** The Phase-2 spike ran a real `generateContent` call
with a real key from inside both installed shells (Tauri WebView2 on Windows,
Capacitor on Android): **`gemini-3.5-flash` returned HTTP 200 with candidates.**
Direct provider calls work. WebView2 is Chromium and enforces CORS like a
browser, so this supersedes the 2026-07-08 "Gemini CORS-blocked" observation.
Therefore:

- Build the Gemini adapter like any other; **no relay.**
- Recorded in BUILD_PLAN Phase 2.

**One open re-confirm** (not a blocker): the check ran in the shells, not the
deployed browser PWA. WebView2 evidence makes a browser block unlikely, but
confirm one `generateContent` call from the deployed PWA origin during Step-1
research before deleting the relay option for good. If — unexpectedly — the
pure browser is blocked while the shells are not, that is a runtime-selected
transport behind the same adapter interface, **never a UI fork.**

**Done:** answer recorded here and in BUILD_PLAN with a date; the only adapter
for this phase is Gemini (§1).

## 3. Step 1 — Search-before-build dispatches (CLAUDE.md rule)

Dispatch a Claude Sonnet 5 research subagent (Agent tool, model `sonnet`,
web search enabled) for each item; adopt maintained, permissively licensed
packages over hand-writing:

1. **Current Gemini facts** (this is the important one — endpoints and CORS
   policies change silently; do not trust training data):
   - Record Gemini's current endpoint, a **free-tier vision-capable model id**,
     CORS policy for browser calls, auth shape, and cheapest
     zero-or-near-zero-quota probe usable for startup reachability checks.
   - Record Gemini's rate-limit/quota signalling: status codes, `Retry-After` /
     reset headers, and how "daily quota exhausted" is distinguishable from
     "burst rate limit".
2. **Client library**: whether Google's maintained browser-safe Gemini SDK is
   worth adopting versus a small typed `fetch` adapter. Adopt a package only
   if it remains permissively licensed, small enough, and useful.
   Retry/backoff helpers are allowed only if trivial-sized and quota-aware.
3. **Shell transport check**: whether Tauri 2 WebView and Capacitor Android
   WebView enforce CORS on `fetch` the same way browsers do (expected: yes).
   Re-confirm Gemini from the deployed browser PWA. The answer must not create
   a UI fork.

**Done when:** a short Gemini facts table (endpoint, vision model, CORS,
probe, quota signals, verified date) is committed into this file, and the
build/adopt decisions are written down.

## 4. Step 2 — Key & settings storage (Dexie)

- Extend `src/state/` with a singleton Gemini credential record (Dexie schema
  version bump): `{ id: 'gemini', apiKey, lastValidation?: { status,
  checkedAt } }`. Typed strictly; the fixed id prevents accidental creation of
  multiple active provider/key records.
- A `settings` entry records `firstRunCompletedAt` so the walkthrough shows
  exactly once (mirrors the theme controller's localStorage pattern only if
  a synchronous read is genuinely needed — otherwise Dexie).
- The key is stored as a plain value in IndexedDB — same-origin protected,
  on-device, consistent with the owner's threat model. Do **not** invent
  encryption theater (a client-held key adds no real protection); do keep
  keys out of logs, exceptions, and React error boundaries.
- No import, sync, fallback, environment variable, build-time secret, or remote
  lookup may supply an API key. The request layer receives the singleton local
  key explicitly.
- Migration safety: existing `jobs`/`meta` tables must survive the version
  bump (Dexie upgrade path, no data loss).

**Done when:** the user's Gemini key persists across reloads; replacing it
overwrites the previous value; deleting it removes it; no second active key can
be created; nothing key-shaped appears in console output.

## 5. Step 3 — Gemini adapter layer (`src/providers/`)

One interface, one Gemini adapter, deterministic error taxonomy:

```ts
interface GeminiAdapter {
  id: 'gemini'
  name: 'Google Gemini'
  /** Cheap reachability probe; never spends meaningful quota. */
  probe(key: string, signal?: AbortSignal): Promise<ProbeResult>
  /** Live key validation: minimal real call that proves the key works. */
  validateKey(key: string, signal?: AbortSignal): Promise<KeyCheckResult>
  /** One vision call: page image(s) + prompt in, text out. */
  complete(request: VisionRequest, key: string, signal?: AbortSignal): Promise<VisionResult>
}
```

- **Error taxonomy is the heart of this step.** Every thrown/returned failure
  is one of a closed union — `wrong-key | quota-exhausted | rate-limited |
  unreachable | provider-error | aborted` — mapped deterministically:
  401/403 → wrong-key; 429 with daily-quota signal → quota-exhausted;
  429 burst → rate-limited; `TypeError`/CORS/network → unreachable
  (cross-check `navigator.onLine` to distinguish "you are offline" from
  "provider unreachable"); 5xx → provider-error. Unknown → provider-error,
  never wrong-key.
- The adapter does **no formatting of engine output** and contains **no
  prompts** — it moves bytes. (Engine semantics arrive in Phase 6 and are
  pinned.)
- Requests carry an `AbortSignal` end-to-end; nothing in this layer retries
  on its own.
- Keep status-to-taxonomy mapping as a unit-testable pure function so it can be
  inspected and exercised without network access.

**Done when:** the Gemini adapter can validate the user's real key and complete
one small image call from the browser, and every failure mode lands in the right
taxonomy bucket (verified by forcing each: garbage key, airplane mode,
exhausted key if available).

## 6. Step 4 — Gemini request controller (`src/providers/controller.ts`)

The engine-facing API; Phase 6 will call only this, never the adapter directly:

- `runGeminiRequest(request, opts)` reads the singleton local credential and
  passes that exact key to the Gemini adapter. It never accepts a fallback key.
- `quota-exhausted | rate-limited | unreachable` emits a calm paused state:
  `{ kind: 'paused', reason: 'quota' | 'offline', resumesAt? }`. Resume using
  Gemini reset/retry timing or the browser `online` event.
- `wrong-key` stops cloud work until the user replaces and validates their key;
  it must never fall back to another credential.
- Startup reachability probes and manual refresh update Gemini's status. A
  probe never marks a key wrong unless Gemini returns a real auth failure.
- Emit status events for running, paused, resumed, wrong-key, and unreachable.
  There are no provider-switch events.
- Make key provenance auditable: every request obtains the key from the same
  singleton credential repository, and tests must fail if any alternate key
  source is introduced.

**Done when:** a test image call succeeds with the locally entered Gemini key;
a wrong key produces `wrong-key` without another request under a different
credential; simulated 429 produces calm `paused`; and network off/on moves
paused → resumed without user action.

## 7. Step 5 — Real app shell + API-key panel + first-run

Promote the mockup shapes to the real app:

- Replace the placeholder five-step nav in `src/App.tsx` with the real
  `AppShell` + `TabNav` dashboard. Convert/History/Help render honest
  placeholders ("arrives in Phase 5/6/7") composed from the design system;
  the API-key panel is fully real. Keep the Dexie `AppStep` job state intact for now
  (Phase 6 reworks job state); keep `Phase2SpikeChecks` reachable in dev,
  and keep the dev-only Gallery + Mockups entries working.
- **API-key panel:** one Google Gemini key field with Replace, Remove, and
  Check key actions. "Check key" runs `validateKey` with a pending state;
  `StatusChip` and inline notes show the approved wrong-key, unreachable,
  quota, and working language. Do not render provider order or Add provider.
- **First-run walkthrough** = `FirstRunMock` made real: shown when no
  Gemini key has been validated; one Gemini key field + live validation + the
  one-line privacy notice; lands on Convert. "Skip" is allowed (the user can
  enter their Gemini key later through the API panel).
- Move the canonical copy out of `src/mockups/copy.ts` into a real location
  (`src/copy/messages.ts`); mockups import from there so the strings cannot
  drift. `simulateKeyCheck.ts` stays mockup-only.
- Accessibility bar unchanged: keyboard operable end-to-end, focus visible,
  44px targets, both themes — the components already enforce most of this;
  don't fight them.

**Done when:** on a fresh profile the walkthrough appears, a real key
validates green, the app lands on Convert; on reload it goes straight to
Convert; the API panel shows live Gemini status with the approved words;
`npm run build` and `npm run lint` pass.

## 8. Step 6 — Phase-gate verification & recording

- Drive the real app (not unit tests): fresh profile → walkthrough → user's
  Gemini key → validated → run a small dev-only test image call → confirm the
  request is billed to that key. Replace it with a garbage key and confirm the
  call stops as wrong-key without fallback.
- Verify the three failure states visually side by side (garbage key /
  network off / 429 if reproducible) — words and tones must match
  `ERROR_LANGUAGE.md`.
- Re-verify on one shell (Tauri or Android) that the same build behaves
  identically — no platform fork crept in.
- Record in BUILD_PLAN: tick completed Phase 4 boxes and note any Gemini
  free-tier, model, quota, or CORS fact that differed from the research table.

**Done when:** the BUILD_PLAN Phase 4 gate sentence is demonstrably true and
the evidence (what was run, what was seen) is written into the PR/commit
description or this file.

## 9. Constraints & gotchas

- **COST-ZERO:** Gemini must have a genuinely free tier; every
  package added must be MIT/Apache/BSD/OFL. Anything paid/freemium/AGPL:
  stop and flag the owner. No CDN assets.
- **Do not touch** the three engine prompts, the CSV contract, or anything
  in `CODOX_MIGRATION.md`'s domain. No engine work in this phase — the
  Gemini controller's `complete()` is the only engine-adjacent surface.
- **Never log keys** — not in errors, not in status events, not in Dexie
  rows other than the key field itself. Grep for accidental `console.log`
  of request configs before finishing.
- **Do not commit or push.** Leave changes in the working tree and report;
  the owner decides when to commit (repo convention).
- **Don't trust remembered Gemini facts.** Endpoints, model ids, CORS
  policies, and free tiers in any training data are presumed stale — the
  Step 1 research table with a verification date is the only source.
- **Quota is not an error.** If any code path renders quota exhaustion in
  danger tones or the word "error"/"failed", it is a bug per the owner's
  design rulings.
- **Precedence:** latest direct owner instruction → CLAUDE.md → this plan →
  DESIGN_SYSTEM.md → mockups.
