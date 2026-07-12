# Phase 6 — Engine port: AI handoff plan

_Written 2026-07-12. Audience: an AI coding agent (or developer) with full
access to this repository. Execute the steps in order; each ends with a
"Done when" gate. Scope is Phase 6 of [BUILD_PLAN.md](BUILD_PLAN.md): port
the Planner-Worker-Audit engine per [CODOX_MIGRATION.md](CODOX_MIGRATION.md)
— deterministic CSV emit, planner/worker/audit calls, answer-policy
enforcement, pause/resume checkpointing, and the real Progress screen. The
phase gate: **the appendicitis PDF grades 127/127 exact rows in
CodoxSandbox, and the measured quota burn of a real 25-page scan is written
into BUILD_PLAN.**_

---

## 0. Read these first (in order, before writing any code)

1. `CLAUDE.md` — hard rules. For this phase the load-bearing ones are
   **NEVER-GUESS** (enforced in deterministic code and the audit gate, not
   prompts), **engine semantics are pinned**, Gemini-only, and
   search-before-build. **Binding.**
2. `Docs/CODOX_MIGRATION.md` — **the entire file, carefully.** §1 (engine
   semantics) and §3 (output contract) are binding design; §2 prompts
   migrate **byte-for-byte** (copy-paste them into code as constants —
   never retype, never "improve", never add document hints); §4 lists the
   known blind spots this design exists to catch.
3. `Docs/BUILD_PLAN.md` Phase 6 — the checklist this plan expands.
4. `src/providers/controller.ts` + `src/providers/types.ts` — the
   engine-facing Gemini API. **The engine calls only
   `geminiController.runGeminiRequest`, never the adapter.** Quota/offline
   pauses are already handled inside it (calm pause → auto-resume);
   `wrong-key` and `provider-error` come back as failures for the engine
   to surface.
5. `src/pdf/` — Phase-5 pipeline the engine drives: `processPdf` (render →
   JPEG + text per page), `cropJpeg` + `clampCropBox` (deterministic
   crops), `RENDER_DPI = 200` (pinned).
6. `src/state/` — Dexie patterns (versioned, additive-only), the current
   job/`StoredPdf` shapes, `src/state/files.ts`.
7. `design-system/ERROR_LANGUAGE.md` + `src/copy/messages.ts` — the only
   allowed tutor-visible words (`progressMessages` already covers pause,
   offline, bad page, wrong declaration, finished states).
8. `src/mockups/ConvertMock.tsx` `RunningStage`/`DoneStage` — the visual
   reference for the Progress UI (one-screen design; Progress is a stage
   of the Convert column, not a separate takeover).
9. Verification harness note: headless-browser drives use
   `playwright-core` + `channel: 'msedge'`; copy the pattern in
   `scripts/drive-phase5.mjs`. Vite dev server: port 5173.

## 1. Locked decisions — do not re-litigate

- **The three prompts and the output contract migrate as-is.** Any edit —
  even whitespace "cleanup" — invalidates comparability with the archived
  CodoxSandbox results. Store them as string constants copied verbatim
  from CODOX_MIGRATION §2.
- **Deterministic code owns all formatting, IDs, paths, and CSV emission.**
  Models only read pages and return JSON; nothing a model returns is ever
  pasted into the CSV without passing the ownership/merge rules (§1.4,
  §1.7).
- **NEVER-GUESS is code, not vibes:** policy forcing (§1.5), the worker's
  `needs_review` always discarded at merge, blank `correct_index` never
  defaulted, conflicting marks → blank + flag, wrong declaration →
  everything flagged. Each of these is a deterministic function with a
  unit test.
- **Gemini only, via the controller.** No second provider, no failover, no
  key parameter anywhere in the engine. Temperature 0, JSON-only
  responses.
- **Model assignments** (per §1.2, availability-checked at runtime):
  planner `gemini-3.5-flash` (= `DEFAULT_GEMINI_VISION_MODEL`), audit
  `gemini-3.1-flash-lite`. The worker's design-doc name
  `gemma-4-31b-vision` is an **unverified API ID**: resolve it against
  `GET /models` live, record intended ID / chosen ID / reason in this
  file, never silently alias. If no suitable weak vision model exists on
  the free tier, use `gemini-3.1-flash-lite` as worker and record that.
- **The images the models see are the Phase-5 renders** (200 DPI JPEGs).
  Planner boxes are `[ymin, xmin, ymax, xmax]` normalized **0–1000**
  relative to those exact images; crops are cut from the same JPEGs.
  Never re-render between planning and cropping (§1.8).
- **One bad page / one bad step never crashes a job.** Stop reasons are
  the §1.3 machine-readable statuses (`planner_unparseable`,
  `worker_chunk_invalid`, …); a stopped run still keeps its artifacts and
  the UI explains it in ERROR_LANGUAGE words.
- **Export stays in Phase 7.** This phase ends at validated merged rows +
  `questions.csv` content + crop blobs persisted in IndexedDB, plus a
  dev-only way to download the CSV for grading. The Review/Export UI is
  not this phase.
- **Grading happens in CodoxSandbox, not here.** Do not build a grader,
  gold fixtures, or scoring harness in this repo; produce the CSV, hand
  it over (owner runs the grader), iterate on what comes back.

## 2. Known gaps you must close early (verified against current code)

1. **The adapter cannot yet express engine calls.** `VisionRequest` has no
   `generationConfig` and `VisionSuccess` has no finish-reason, but §1.3
   gates on truncation and §1.11 pins temperature 0 + max output tokens.
   Extend the provider layer (types + `gemini.ts` + controller
   passthrough) with:
   - `generationConfig?: { temperature, maxOutputTokens, responseMimeType }`
     — passed through verbatim to `generateContent`
     (`responseMimeType: 'application/json'` gets clean JSON out of
     Gemini).
   - `finishReason?: string` on `VisionSuccess` (first candidate's
     `finishReason`; `MAX_TOKENS` = truncation → step gate fails).
   Keep the adapter byte-mover discipline: no retries, no prompt
   knowledge, key only in the header. Extend `controller.test.ts`
   provenance coverage to the new fields.
2. **Rate-limit pacing:** the controller already distinguishes
   `rate-limited` (short wait, honors `retryAfterSeconds`) from
   `quota-exhausted` (long calm pause) — matching §1.3's operational
   note. Do not add engine-side retry loops on top of it; the engine's
   "exactly one repair round / one chunk retry" counters are about
   *invalid content*, not transport, and must not be consumed by quota
   waits.
3. **Blob → base64:** `VisionRequest.images` wants base64 without the
   data-URL prefix; the Phase-5 pages are JPEG Blobs. Write one helper
   (FileReader/`arrayBuffer` + chunked btoa) and use it everywhere.

## 3. Architecture (new `src/engine/`)

```
src/engine/
  prompts.ts        §2 prompts, verbatim constants + a test pinning their hashes
  types.ts          Blueprint, PlannedRow, WorkerChunk, MergedRow, RunStatus…
  blueprint.ts      §1.6 validation (pure) + reduced-blueprint builder (§1.9)
  boxes.ts          0–1000-normalized box_2d → pixel CropBox on a page (pure)
  merge.ts          §1.4/§1.5/§1.7 ownership + policy forcing (pure)
  normalize.ts      post-merge label stripping ("A.", "b)") (pure)
  csv.ts            RFC-4180 emit of the 10-column contract (§3.1–3.2) (pure)
  validate.ts       final row validation (§1.3 step 7) (pure)
  calls.ts          planner/worker/audit call builders → controller requests
  executor.ts       the step machine: run, checkpoint, resume, stop reasons
  index.ts
```

Everything marked (pure) takes data in, returns data out, no I/O — that is
where the correctness lives and where the unit tests go. `executor.ts` is
the only file that touches the controller, the PDF pipeline, and Dexie.

**Search-before-build applies twice here:** (a) CSV emission — check for a
tiny maintained RFC-4180 *writer* (MIT/Apache; pdf-side quoting rules in
§3.2 are strict); hand-write the ~30 lines only if the search comes back
empty. (b) The executor/checkpointing — BUILD_PLAN pre-authorizes
LangGraph.js with a custom IndexedDB checkpointer **only if hand-rolling
is painful**; try the hand-rolled step machine first (it is a linear
8-step sequence, not a graph), and dispatch the research subagent before
reaching for LangGraph.

### Persistence (Dexie v5, additive-only)

- `runs`: one row per conversion run — `{ id, jobId, pdfId, status
  ('running' | 'paused' | 'stopped' | 'done'), stopReason?, step,
  createdAt, updatedAt }`.
- `runArtifacts`: `{ id, runId, kind ('page-jpeg' | 'page-text' |
  'blueprint-raw' | 'blueprint-valid' | 'crop' | 'chunk-request' |
  'chunk-response' | 'merged-rows' | 'csv' | 'audit-report'), pageIndex?,
  chunkIndex?, blob?/json? , createdAt }` — §1.3's "each step writes its
  inputs and outputs to disk before the next step starts", which is also
  exactly what resume needs. Record per chunk what was sent
  (reconstructability rule).
- Checkpoint = the `runs.step` pointer + artifacts present. Resume =
  re-enter the executor at the first step whose outputs are missing.
  This must survive: reload mid-run, quota pause, connection drop,
  process kill.

### The step machine (§1.3, engine statuses verbatim)

1. Render pages via `processPdf` (persist page JPEG + text per page as
   they stream — memory discipline holds; never hold all pages in JS
   memory; base64 is made per call from stored blobs). Page render
   failure → that page flags (`progressMessages.badPage`) but the run
   continues; *zero* successfully rendered pages → `render_failed`.
2. Planner call: prompt + all page images. Gate: JSON parses, no
   truncation, required fields. Fail → stop `planner_unparseable` (keep
   raw response artifact).
3. Blueprint validation (§1.6). Invalid → exactly one repair round (same
   model, original pages + invalid blueprint + errors). Still invalid →
   stop `planner_invalid_after_repair` **before any worker call**.
4. Deterministic crops: `boxes.ts` → `cropJpeg` from the stored page
   JPEGs. Missing/degenerate referenced asset → continue but mark
   `not_safe_to_import`.
5. Chunked worker calls (default 10 rows, reduced blueprint, referenced
   pages + crops only). Gate per chunk: valid JSON, exact row IDs, order,
   no planner-owned changes. One retry with the error appended → still
   bad → stop `worker_chunk_invalid`.
6. Deterministic merge (`merge.ts`), then `normalize.ts`. Gate → stop
   `merge_validation_failed`.
7. Final validation + CSV emit (`validate.ts`, `csv.ts`). Failure →
   still write the CSV artifact, mark `not_safe_to_import`; never send
   validation failures back to the worker.
8. Audit call (read-only). Audit-call failure → `audit_unavailable`,
   never an inferred pass. Audit fail → CSV + report both persist, run
   marked not safe to import.

### Declaration cross-check (BUILD_PLAN "wrong declaration degrades safely")

The user's Upload declaration (`batchAnswerSource` / per-file override)
**never feeds the prompts** (no document-specific hints, §2 usage notes).
It is checked *after* the planner returns: declaration says answers exist
but the planner's evidence-based policy is `no_answer_key`/`uncertain` —
or the reverse — → deterministic code forces every row blank + flagged
and surfaces `progressMessages.wrongDeclaration(fileName)`. Degrades to
"everything flagged," never to wrong rows.

### Progress UI (Convert running/done stages per the mockup)

- Wire `geminiController.subscribe` + run state to the mockup's
  `RunningStage`: overall + per-file `ProgressBar`, `StatusChip`
  working/quota-paused/unreachable, `progressMessages.pausedQuota` /
  `offline` / `badPage` / `wrongDeclaration`, `TypewriterLine` silly
  sentences while healthy. Quota pause renders calm (amber), never as an
  error.
- Done stage: `finishedClean` / `finishedWithFlags(n)`; Review/Export
  buttons stay disabled placeholders until Phase 7 (honest note, same
  pattern as Phase 5's Start button).
- Start button on the files stage becomes real: creates a `runs` row per
  exam PDF and starts the executor (sequential across files; one file's
  stop never kills the batch).

### Quota-burn measurement (the "one number that could force a redesign")

Count every Gemini request and, where the response provides
`usageMetadata`, sum token counts per run; persist totals on the `runs`
row and show them on the dev spike surface. After the first real 25-page
scan run, write the number into BUILD_PLAN Phase 6.

## 4. Step-by-step build order

1. **Provider extension** (§2 gap 1 + 3) + tests. *Done when:* a
   controller request can carry generationConfig and report finishReason,
   provenance tests still green.
2. **Pure core**: `types.ts`, `prompts.ts` (+ hash-pinning test),
   `boxes.ts`, `csv.ts`, `blueprint.ts`, `merge.ts`, `normalize.ts`,
   `validate.ts` — with exhaustive unit tests (policy forcing matrix,
   RFC-4180 quoting incl. quotes/commas/newlines/UTF-8, box rounding,
   chunk reduction, label stripping edge cases: "A.", "(b)", "iii)",
   options that legitimately start with a letter-dot like "E. coli" —
   when in doubt strip only unambiguous enumeration patterns and flag
   ambiguity rather than guessing). *Done when:* `npm run test` green.
3. **Executor + Dexie v5** with an injected fake adapter (constructor
   injection already exists on `GeminiController`) — drive the full step
   machine in tests: happy path, planner repair, chunk retry, resume
   after simulated reload at every step boundary, quota pause replay.
   *Done when:* every §1.3 stop reason and the resume matrix pass.
4. **Progress UI** on Convert + dev CSV download surface. *Done when:*
   drive script (extend `scripts/drive-phase5.mjs` pattern) runs a fake
   full conversion in headless Edge: paused → resumed → done → CSV
   artifact downloadable, screenshots match the mockup stages.
5. **Live run** (needs the owner's real key, dev build): appendicitis PDF
   end-to-end → export CSV → owner grades in CodoxSandbox → iterate on
   *code* (never prompts) until **127/127**. Record each attempt's
   failure diff in this file.
6. **Quota burn**: real 25-page scan run, write the number into
   BUILD_PLAN, tick the checkboxes with evidence notes.

## 5. Traps

- Do not "fix" the worker's output; do not let the worker "fix" the
  planner. Every disagreement resolves by ownership rules or a flag.
- `needs_review` from the worker is **always discarded** — even when it
  looks right.
- Blank `correct_index` is a success state, not an error. Never default
  to 0; a defaulted 0 is a silently wrong medical answer.
- The repair/retry counters are exactly 1 each and are consumed only by
  *invalid content*, never by quota/transport waits (the controller
  absorbs those).
- Box convention is `[ymin, xmin, ymax, xmax]` 0–1000 — y first. Getting
  x/y swapped produces plausible-looking wrong crops; unit-test with an
  asymmetric page.
- `options` is a JSON array **inside** a CSV cell: JSON-encode first,
  then CSV-quote. Test with option text containing `"`, `,`, and
  newlines.
- Don't hold page images in memory across steps — re-read blobs from
  IndexedDB per call (the ~100 MB phone budget still applies while the
  engine runs).
- The planner prompt example shows `output_path: images/asset01.png`;
  actual crops are JPEG. Code owns paths (§1.4): deterministically
  rewrite the extension to `.jpg` and use that in `image_urls` — record
  this choice; do not emit a `.png` path pointing at JPEG bytes.
- Never put the key, page images, or model responses in console logs.
- `may_flag_planner_disagreement: false` is intentional. Do not add a
  disagreement channel.

## 6. Status

Nothing built yet — Steps 1–6 all open. Prerequisites in place from
Phases 4–5: controller with pause/resume + no-fallback-key provenance
tests, PDF pipeline (`processPdf`, `cropJpeg`), Dexie v4, canonical
copy, Convert screen with persisted files + declaration awaiting a real
Start. Phase-5's only open item (25-page device stress test) does not
block starting; if it fails and the render DPI/quality changes, re-run
any engine calibration made against old images.
