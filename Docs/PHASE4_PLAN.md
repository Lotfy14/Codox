# Phase 4 — Setup screen + provider layer: AI handoff plan

_Written 2026-07-11. Audience: an AI coding agent with full access to this
repository. Execute the steps in order; each ends with a "Done when" gate.
Scope is Phase 4 of [BUILD_PLAN.md](BUILD_PLAN.md): the first real feature —
key storage, provider adapters, the failover chain, and the real Keys/first-run
UI. The phase gate: **a real key validates in the UI, and a test image call
round-trips through the chain with a forced failover** (wrong key on provider 1
→ provider 2 answers)._

---

## 0. Read these first (in order, before writing any code)

1. `CLAUDE.md` — the three hard rules (COST-ZERO, NEVER-GUESS, keys
   on-device), search-before-build, stack conventions. **Binding.**
2. `Docs/CODOX_CONTEXT.md` §7 — the provider & key model: user-supplied free
   keys, chain walking, hot-swap on quota/failure, the measured CORS facts
   from 2026-07-08, and why "unreachable" must never be misdiagnosed as
   "wrong key" (BLIND-SPOTS #9).
3. `design-system/DESIGN_SYSTEM.md` — the component contract. Phase 4 screens
   compose these components; the "Rules screens must follow" section is
   binding, especially rule 6 (wrong key = danger, unreachable = blue-neutral,
   quota = amber, working = success — never collapsed).
4. `design-system/ERROR_LANGUAGE.md` + `src/mockups/copy.ts` — the
   owner-reviewed words for every state. Phase 4 uses these strings, not new
   ones.
5. `src/mockups/` — **the UI spec.** `FirstRunMock.tsx` and `KeysMock.tsx` are
   the approved shapes of the first-run walkthrough and the Keys tab;
   `MockupApp.tsx` shows the AppShell/TabNav dashboard the real app adopts.
   The real screens replace simulation (`simulateKeyCheck.ts`) with real
   calls; the layout and words carry over.
6. Current code: `src/App.tsx` (placeholder five-step nav that Phase 4
   replaces with the real shell), `src/state/db.ts` + `src/state/types.ts`
   (Dexie patterns), `src/screens/Phase2SpikeChecks.tsx` (must keep working —
   it is the Phase-2 evidence surface).

## 1. Locked decisions — do not re-litigate

- **Providers (locked set):** Google Gemini + NVIDIA NIM — behind **one
  adapter interface**. Both are roughly OpenAI-compatible; adapters stay thin.
  (Owner decision 2026-07-11: only these two carry many multimodal models on
  generous free tiers; Groq / OpenRouter `:free` / GitHub Models / Mistral were
  dropped as downgrades and clutter. **Gemini is the workhorse, NVIDIA the
  backup** — the 2026-07-04 bench in CODOX_CONTEXT §11 found free NVIDIA models
  weak on the hard corpus. Verify NVIDIA's free-tier terms in the Step-1
  research table before relying on it — COST-ZERO is non-negotiable.)
- **One key first.** First run asks for exactly one key; more keys are an
  optional later step in the Keys tab (BLIND-SPOTS #12). Never show multiple
  equal-weight key fields up front.
- **The three failure states are distinct** in words, color, and code:
  wrong key (danger) ≠ can't reach (blue-neutral) ≠ resting until quota
  returns (amber, calm). `StatusChip` already implements them.
- **Keys stay on-device.** Stored locally, sent only to the provider they
  belong to, never logged, never in URLs, never in error reports.
- **Navigation is the four-tab dashboard** (Convert / History / Keys / Help)
  from the owner-approved Phase 3 design. Phase 4 makes Keys + first-run real;
  Convert/History/Help become honest placeholders wired to the same shell.
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

**Done:** answer recorded here and in BUILD_PLAN with a date; the adapter list
for this phase is fixed (Gemini + NVIDIA, §1).

## 3. Step 1 — Search-before-build dispatches (CLAUDE.md rule)

Dispatch a Claude Sonnet 5 research subagent (Agent tool, model `sonnet`,
web search enabled) for each item; adopt maintained, permissively licensed
packages over hand-writing:

1. **Current provider facts** (this is the important one — endpoints and CORS
   policies change silently; do not trust training data):
   - For each provider: the OpenAI-compatible chat-completions endpoint, a
     current **free-tier vision-capable model id**, CORS policy for browser
     calls, the auth header shape, and the cheapest zero-or-near-zero-quota
     **probe request** (e.g. a models-list GET) usable for the startup
     reachability check.
   - Rate-limit/quota signalling per provider: status codes, `Retry-After` /
     reset headers, and how "daily quota exhausted" is distinguishable from
     "burst rate limit".
2. **Client library**: whether a maintained, MIT/Apache, browser-safe,
   tree-shakeable OpenAI-compatible client is worth adopting versus ~100
   lines of typed `fetch`. (Expect: hand-written `fetch` wins — the official
   `openai` package is heavy and its browser mode needs
   `dangerouslyAllowBrowser`; verify, then decide.) Retry/backoff helpers:
   only if trivial-sized; the chain walker's failover largely replaces
   per-call retries.
3. **Shell transport check**: whether Tauri 2 WebView and Capacitor Android
   WebView enforce CORS on `fetch` the same way browsers do (expected: yes).
   If a provider is browser-CORS-blocked, confirm the shells are equally
   blocked — the answer feeds the Gemini decision but must not create a
   platform fork inside this phase.

**Done when:** a short provider-facts table (endpoint, vision model, CORS,
probe, quota signals, verified date) is committed into this file, and the
build/adopt decisions are written down.

## 4. Step 2 — Key & settings storage (Dexie)

- Extend `src/state/` with a `providers` table (Dexie schema version bump):
  `{ id, name, apiKey, order, lastValidation?: { status, checkedAt } }`.
  Typed strictly; `id` is the provider slug.
- Provider **order is the failover order**; persist reorders immediately.
- A `settings` entry records `firstRunCompletedAt` so the walkthrough shows
  exactly once (mirrors the theme controller's localStorage pattern only if
  a synchronous read is genuinely needed — otherwise Dexie).
- Keys are stored as plain values in IndexedDB — same-origin protected,
  on-device, consistent with the owner's threat model. Do **not** invent
  encryption theater (a client-held key adds no real protection); do keep
  keys out of logs, exceptions, and React error boundaries.
- Migration safety: existing `jobs`/`meta` tables must survive the version
  bump (Dexie upgrade path, no data loss).

**Done when:** keys and order persist across reloads; deleting a key removes
it from storage; nothing key-shaped ever appears in console output.

## 5. Step 3 — Provider adapter layer (`src/providers/`)

One interface, thin adapters, deterministic error taxonomy:

```ts
interface ProviderAdapter {
  id: ProviderId
  name: string
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
- Adapters do **no formatting of engine output** and contain **no prompts** —
  they move bytes. (Engine semantics arrive in Phase 6 and are pinned.)
- Requests carry an `AbortSignal` end-to-end; nothing in this layer retries
  on its own.
- Unit-testable pure mapping: keep the status→taxonomy mapping as a pure
  function per adapter so it can be eyeballed and exercised without network.

**Done when:** each shipped adapter can validate a real key and complete one
small image call from the browser, and every failure mode lands in the right
taxonomy bucket (verified by forcing each: garbage key, airplane mode,
exhausted key if available).

## 6. Step 4 — Chain walker (`src/providers/chain.ts`)

The engine-facing API; Phase 6 will call only this, never adapters directly:

- `runWithChain(request, opts)`: walk providers in stored order; on
  `wrong-key | unreachable | provider-error | quota-exhausted`, mark that
  provider's live status and move to the next; on `rate-limited`, honor
  `Retry-After` for that provider while trying others.
- **All providers resting/failed → the chain emits a `paused` state**, not an
  error: `{ kind: 'paused', reason: 'quota' | 'offline', resumesAt? }`. It
  resumes automatically (timer for quota resets, `online` event for
  connectivity). This is what makes "paused — resumes when quota allows"
  true rather than cosmetic.
- Startup **reachability probe**: on app open (and manual refresh from the
  Keys tab), probe stored providers concurrently and update their status
  chips. Probes never mark a key wrong — only real auth failures do.
- Emits status events (current provider, switches, pauses) the Progress
  screen will consume in Phase 6; for now the Keys tab and the phase-gate
  test harness consume them.
- Hot-swap is **mid-job, per call**: a failed call is retried on the next
  provider with the same payload; a wrong user key on provider 1 must cost
  one failed call, not the job.

**Done when:** with two configured keys where provider 1's key is
deliberately wrong, a test image call automatically completes via provider 2,
and the UI shows provider 1 as "Wrong key" and provider 2 as "Working" —
**this is the phase gate.** Also: with all keys resting (simulate 429),
the chain reports calm `paused`, and flipping the network off/on transitions
paused → resumed without user action.

## 7. Step 5 — Real app shell + Keys tab + first-run

Promote the mockup shapes to the real app:

- Replace the placeholder five-step nav in `src/App.tsx` with the real
  `AppShell` + `TabNav` dashboard. Convert/History/Help render honest
  placeholders ("arrives in Phase 5/6/7") composed from the design system;
  Keys is fully real. Keep the Dexie `AppStep` job state intact for now
  (Phase 6 reworks job state); keep `Phase2SpikeChecks` reachable in dev,
  and keep the dev-only Gallery + Mockups entries working.
- **Keys tab** = `KeysMock` made real: `ProviderOrderList` bound to the
  Dexie-stored order; per-provider key field (uncontrolled inputs — see the
  GridList render-caching note in `KeysMock.tsx`); "Check key" runs
  `validateKey` with the pending button state; `StatusChip` + inline notes
  show the exact `ERROR_LANGUAGE.md` strings; an "add a provider" affordance
  for providers without keys.
- **First-run walkthrough** = `FirstRunMock` made real: shown when no
  provider has a validated key; one provider select + one key field + live
  validation + the one-line privacy notice; lands on Convert. "Skip" is
  allowed (user can add keys later via Keys tab).
- Move the canonical copy out of `src/mockups/copy.ts` into a real location
  (`src/copy/messages.ts`); mockups import from there so the strings cannot
  drift. `simulateKeyCheck.ts` stays mockup-only.
- Accessibility bar unchanged: keyboard operable end-to-end, focus visible,
  44px targets, both themes — the components already enforce most of this;
  don't fight them.

**Done when:** on a fresh profile the walkthrough appears, a real key
validates green, the app lands on Convert; on reload it goes straight to
Convert; the Keys tab shows live per-provider status with the approved words;
`npm run build` and `npm run lint` pass.

## 8. Step 6 — Phase-gate verification & recording

- Drive the real app (not unit tests): fresh profile → walkthrough → real
  key → validated; Keys tab → add second provider with a **wrong** key first
  in the order → run the built-in test call (add a small dev-only "send test
  image" action on the Keys tab for exactly this) → observe automatic
  failover and correct chips.
- Verify the three failure states visually side by side (garbage key /
  network off / 429 if reproducible) — words and tones must match
  `ERROR_LANGUAGE.md`.
- Re-verify on one shell (Tauri or Android) that the same build behaves
  identically — no platform fork crept in.
- Record in BUILD_PLAN: tick completed Phase 4 boxes, note the Gemini
  decision, note any provider whose free tier or CORS policy differed from
  the research table (with date).

**Done when:** the BUILD_PLAN Phase 4 gate sentence is demonstrably true and
the evidence (what was run, what was seen) is written into the PR/commit
description or this file.

## 9. Constraints & gotchas

- **COST-ZERO:** every provider used must have a genuinely free tier; every
  package added must be MIT/Apache/BSD/OFL. Anything paid/freemium/AGPL:
  stop and flag the owner. No CDN assets.
- **Do not touch** the three engine prompts, the CSV contract, or anything
  in `CODOX_MIGRATION.md`'s domain. No engine work in this phase — the
  chain walker's `complete()` is the only engine-adjacent surface.
- **Never log keys** — not in errors, not in status events, not in Dexie
  rows other than the key field itself. Grep for accidental `console.log`
  of request configs before finishing.
- **Do not commit or push.** Leave changes in the working tree and report;
  the owner decides when to commit (repo convention).
- **Don't trust remembered provider facts.** Endpoints, model ids, CORS
  policies, and free tiers in any training data are presumed stale — the
  Step 1 research table with a verification date is the only source.
- **Quota is not an error.** If any code path renders quota exhaustion in
  danger tones or the word "error"/"failed", it is a bug per the owner's
  design rulings.
- **Precedence:** latest direct owner instruction → CLAUDE.md → this plan →
  DESIGN_SYSTEM.md → mockups.
