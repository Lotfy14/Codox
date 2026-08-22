# CLAUDE.md — Codox

Codox converts exam PDFs into Triviadox-ready CSV bundles, entirely
client-side, for non-technical tutors. Read [Docs/CODOX_CONTEXT.md](Docs/CODOX_CONTEXT.md)
for the product and the platform facts every decision has to survive,
[Docs/OUTPUT_CONTRACT.md](Docs/OUTPUT_CONTRACT.md) for what every conversion
workflow must produce, and [workflows/README.md](workflows/README.md) for how
the strategies are separated. Gold's own pipeline semantics are
[workflows/Gold/ENGINE.md](workflows/Gold/ENGINE.md).

This file is the decision history and the binding rules. Where it and a doc
disagree, this file wins.

## Hard rules (non-negotiable)

1. **COST-ZERO** — $0 recurring cost, ever. No paid dependencies, services,
   certificates, or developer-paid API usage. Licenses must be permissive
   (MIT/Apache/BSD) — **never AGPL, never paid/freemium SDKs**. Anything with
   a price: stop and flag it to the owner.
2. **The key stays on-device** — each user brings their own Gemini API key;
   calls go directly from their device to Gemini. No Codox-operated server ever
   sees a key or a page. First run shows a one-line notice that pages are
   sent to Gemini under the user's key (owner chose minimal notice —
   users are a known group working with public documents).

## Provider and quota rule (non-negotiable)

- **Gemini only.** Each installation stores exactly one user-supplied Google
  Gemini API key. Codox has no shared, bundled, developer, fallback, or second
  provider key. Every cloud request uses only the key entered on that
  installation, so one user can never consume another user's Gemini quota.
  The user may replace or remove the key, but cannot pool multiple keys. (This
  bans a fallback *key/provider*; the runtime *model* fallback added
  2026-07-22 — primary → known-good model under the **same** one key — does not
  touch it. See the model-fallback note under "Engine semantics are pinned".)

## How answers flow (description, not doctrine)

Where `correct_index` comes from, as the code actually works today. Change it
freely — this is a map, not a rulebook.

- **Engine path.** For an on-page answer the **worker's reading is the only
  perceptual authority**: every row permits extraction, the worker reads the
  mark off the page, and `forceAnswer` (`merge.ts`) applies the policy at
  merge — a filled value is accepted only as a number in range for that row's
  options, and a worker that reads no mark yields `no_visible_answer`. A
  **separate answer key** still decides its own rows through EVIDENCE's per-ref
  state. INDEX's `answer_present` is now an observation only, NOT a gate (see
  the 2026-07-30 note under "Engine semantics"). Blanked rows
  carry a `needs_review` reason (`no_visible_answer`, `key_unclear`,
  `index_out_of_range`, `not_mcq`, …) that Review shows the tutor.
  `forceAnswer` also has a **document-level** veto: policy `no_answer_key` or
  `uncertain` blanks every row before any per-row logic. That veto is kept, but
  the policy feeding it is now honest about documents that carry both an
  attached key and on-page marks — see `keepIndexObservedMarks` below.
- **Ask AI** (`src/engine/solver.ts`, Review only) answers from model
  knowledge. It writes to the `ai-answers` artifact, never to `merged-rows`;
  the answer reaches the row when the tutor approves it, as an ordinary
  resolution.
- **Export** ships resolved questions only (`isFlagged` after resolutions in
  `exporter.ts`). A row still flagged is held back and the Export button warns
  with the held-back count first. Consequence: a document with no answer key
  exports nothing until the tutor answers the questions in Review.
- **Agent-conversion import** (`agent-conversion/`, `src/agent-import/`) lets a
  coding agent extract an exam outside the app under the tutor's own
  subscription; Folders imports the result. Each question declares
  `answer.source`: `extracted` (read off the page) fills `correct_index`;
  `reasoned` (worked out from knowledge) lands in `ai-answers` for tutor
  approval; `none` or an out-of-range index imports blank and flagged.
  `validateAgentExam`/`toExamQuestion` demote rather than repair. The import makes
  no network request — no Gemini call, no key — so the provider/quota rule is
  untouched, and it writes the same artifacts a finished conversion does, so
  Review, edit mode, topic matching and export work on it unchanged. Import is
  a folder picker, so the button feature-detects `webkitdirectory` and says so
  where it is missing.

## Engine semantics

The Planner-Worker-Audit engine semantics, its three prompts, and the
Triviadox CSV output contract migrated **as-is** from CodoxSandbox. They now
live where they belong: the semantics in
[workflows/Gold/ENGINE.md](workflows/Gold/ENGINE.md) (Gold's strategy, not the
repo's), the prompts in [workflows/Gold/PROMPTS.md](workflows/Gold/PROMPTS.md),
and the output contract in [Docs/OUTPUT_CONTRACT.md](Docs/OUTPUT_CONTRACT.md)
(shared — it is what earns every mineral one Review screen). Deterministic
code owns all formatting, IDs, and CSV emission — models only read pages,
never format output.

Prompts belong to the workflow that runs them. Gold's three big prompts live in
**`workflows/Gold/PROMPTS.md`** and `engine/prompts.ts` is GENERATED from it —
edit the block, run `node scripts/sync-workflow-prompts.mjs Gold`, done.
`prompts.test.ts` only verifies the generator was run (doc block ≡ constant), so
"edited the doc, forgot to regenerate" fails loudly instead of silently shipping
the old prompt. **They are not frozen** — they have been edited four times
(2026-07-15 output split, 2026-07-30 answer extraction, 2026-08-02 `group_id`
removal ×2). What proves an edit good is a benchmark run on real documents; the
SHA-256 pins that used to guard them were removed 2026-08-02 as ceremony.

*Model assignment (owner-approved 2026-07-14, superseded 2026-07-22):* the
2026-07-14 pin ran all roles on `gemini-3.1-flash-lite` (chosen over
the migrated design's `gemini-3.5-flash` planner because 3.5-flash's free-tier
per-minute ceiling 429'd a single multi-page planner call on its own). As of
2026-07-22 the **primary** for every role is Google's newer
`gemini-3.5-flash-lite` (GA; model id verified live against the Gemini docs
2026-07-22), and `gemini-3.1-flash-lite` becomes the runtime fallback below.
Open cost carried forward: Flash-Lite bounding boxes are weaker and the new
model's crop quality is unmeasured.

*Runtime model fallback (owner-approved 2026-07-22, overrides the earlier "the
engine still never swaps a role's model at runtime" wording):* the **engine**
still never swaps a role's model — the role constants are fixed and the engine
retries the same model. The one runtime swap lives in the **controller**
(`src/providers/controller.ts`), outside the engine path: a request the primary
model cannot answer is retried once on the known-good
`FALLBACK_GEMINI_VISION_MODEL` (`gemini-3.1-flash-lite`) under the **same one
key** — a second model, never a second key or provider, so the
provider/quota rule holds. "Cannot answer" = a per-minute `rate-limited`, a
per-day `quota-exhausted` (see the 2026-07-30 correction below), a
`provider-error`, a missing/billing-gated model, or a body still empty after
the primary's own transient retries. Deliberately **not** fallback triggers:
`wrong-key` (same key for both — a swap would only mask the real fault),
`aborted` (user stop), and `unreachable` (a network fact, model-agnostic, so
the primary keeps its calm "paused, not broken" pause; the fallback keeps that
pause too, so it still shows when BOTH models are stalled). COST-ZERO guard: a
per-session circuit breaker disables a primary
that returns `model-unavailable`/`billing-required`, so a key without access to
the new primary wastes exactly one doomed call per session, not one per
request. The fallback re-runs the identical request; it never invents an answer. The three pinned prompts and the output contract
are untouched. Consequence: the key check runs the **fallback** model (the
guaranteed-runnable path), so a key that lacks the new primary but can run the
fallback still validates and converts.

*Daily quota is per MODEL, not per key — correction + model demotion
(owner-approved 2026-07-30):* the paragraph above originally excluded daily
`quota-exhausted` from the fallback as "key-wide … a model swap is futile".
**That was wrong.** Gemini's free-tier requests-per-day is metered per model —
the violated quota Google returns is literally named
`GenerateRequestsPerDayPerProjectPerModel-FreeTier` — so
`gemini-3.5-flash-lite` being out says nothing about `gemini-3.1-flash-lite`.
Reported live: a run sat at 0% showing "Resting until quota returns", re-probing
the one exhausted model every 5 minutes forever, while its pair had a full day's
allowance untouched. A per-day 429 is now the **strongest** fallback trigger.

Alongside it the swap became **sticky**, because re-trying a doomed model once
per request is the same waste the `model-unavailable` breaker already existed to
prevent. `recordModelFailure` (`controller.ts`) counts **consecutive**
demote-worthy failures per model; any usable answer resets the count. A per-day
`quota-exhausted` demotes on the **first** strike — Gemini has already stated
the answer cannot change before the 00:00 UTC reset, so further attempts are
guaranteed 429s. Every other kind (`rate-limited`, a non-transient
`provider-error`, a body still empty after all transient retries) is genuinely
transient and takes **3** consecutive strikes. A demoted model is skipped in the
**primary** slot only; the paired model is always attempted, and that attempt
still carries the calm quota/offline pause. `invalid-request` never counts — a
deterministic bad request is the caller's fault, not the model's.

*Strict swap (owner call 2026-07-30):* demoting a model **un-demotes its pair**,
so when the stand-in main earns its own demotion the model it replaced gets its
turn back rather than both ending up shut out. This is why the two can never
deadlock, and why a run spanning the 00:00 UTC reset returns to the tutor's
chosen primary on its own. When both models really are exhausted the pair
alternates one doomed call per pause cycle and the fallback attempt's pause
keeps it calm — bounded, not a busy loop. Demotion is per controller instance
and non-persistent: a fresh launch starts every model clean. The
provider/quota rule is untouched — this is a second model, never a second key.

*The header tally is per model too (2026-07-30):* the same correction applies to
the free-tier strip, which was one combined bar out of 400 and could therefore
read "full" while the model actually in use had most of its day left.
`src/state/quota.ts` now tallies per model id (`recordDailyRequest(model)`,
stored as `{day, counts}`) and the strip shows **one bar per selectable model,
each out of `DAILY_FREE_REQUESTS_PER_MODEL` = 500** — which is what tells a
tutor which model the controller can still fall back to. Still device-local and
still a floor, not an exact meter: Google's own counter is not readable with an
API key, so requests the same key makes from another device are invisible. A
pre-split stored row is migrated by attributing its single count to the default
model (before the split, near enough everything ran on a step's primary), not
discarded. The key check counts against `GEMINI_KEY_CHECK_MODEL`, the model it
actually runs on.

*Per-step model selection (owner-approved 2026-07-22):* the fixed one-model-
for-every-role pin above is now a **default**, not a lock. Customize's Advanced
"Which model does each step" lists **every request-making engine step
individually** (`ENGINE_STEPS`, pipeline order): **index** (also drives the
legacy single-planner path and the per-page INDEX repair), **evidence**,
**figure**, **box**, **worker**, and **audit**. The tutor picks each step's
**primary** from exactly the two selectable models (`SELECTABLE_ENGINE_MODELS`:
`gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`); the model **not** picked
becomes that step's runtime **fallback** — "the other one is the fallback" —
threaded as the request's `fallbackModelId` (`otherEngineModel`) and honored by
the controller's existing one-swap path above (a per-request fallback now,
defaulting to `FALLBACK_GEMINI_VISION_MODEL` when unset, which is how the
post-audit AI steps keep their old behavior). The pair is **closed at two**, so
"the other one" is always well-defined. The per-step split exists so a tutor can
put the geometry-heavy **box** step on the older model (whose bounding boxes are
the measured weak point of the newer one) without dragging the text-reading
steps with it. This does **not** touch the provider/quota rule: every step runs
under the **same one user key** — a second model, never a second key or
provider. The **engine still never swaps a step's model mid-run** — the tutor's
choice is fixed for the whole run and the engine retries the same model; only
the controller does the one paired-fallback swap. Defaults leave every step on
`gemini-3.5-flash-lite`, so a tutor who changes nothing gets byte-identical
behavior. Choices live in `CustomizationSettings.engineModels`
(`Record<EngineStep, EngineModel>`, defined in `src/engine/model-steps.ts`) and
snapshot per run at creation like the other Customize knobs; the brief first
cut shipped three grouped pickers (planner/worker/audit) and those stored fields
migrate per step. The three pinned prompts and the output contract are
untouched. Post-audit AI steps (topic matching, Ask-AI solver, matching-split)
are **not** part of this selection — they keep their own `gemini-3.1-flash-lite`
pin.

*Question count is code-owned (owner-approved 2026-07-14):* ENGINE.md
§1.6's rule "`planned_rows` count equals `document_profile.question_count`" no
longer runs as a validation rule. `question_count` must still BE a number (the
contract shape), but deterministic code emits `rows.length` — the rows are the
product, the count is a number the planner wrote beside them. Only a
**shortfall** is a real signal, and `isUnderExtracted` owns it: fewer rows than
the planner counted skips the repair round entirely (the cheapest way to comply
is to lower the count) and splits the page window instead. The surplus direction
is not an error — rejecting it threw away 17 fully-specified rows over a
profile field that read 15, and stopped a real 30-page run.

*Planner redesign (owner-approved 2026-07-14):* the single Planner prompt is
replaced by INDEX, EVIDENCE / KEY MAP, FIGURE DETECT, and BOX prompts. INDEX
enumerates exam-page question slots without geometry; deterministic code
reconciles identities and assembles the pinned Blueprint. Evidence and figures
are observed separately, and an unresolved page is a visible non-fatal planning
issue rather than a reason to discard clean rows. *(2026-07-17, owner-approved:)*
a BOX_BATCH variant covers several pages per BOX call when `BOX_PAGES_PER_CALL`
is above 1 — an accuracy-for-quota trade; 1 keeps the original single-page BOX
prompt byte-identical. This was Customize's "Pages per box request" until
2026-08-23; see the knob removal below.
Question regions are always stamped with the ref's code-known owner page; only
figure pages come from the model, validated against the batch.
*(2026-07-20, owner-approved; the knob removed 2026-08-23:)* INDEX window size
was Customize's **"Pages per index request"** (1–10), threaded to `planWindows`;
it is now pinned at `INDEX_WINDOW_PAGES` = `DEFAULT_WINDOW_PAGES` = 10, which
is the value it always defaulted to. **Lowering it was measured to LOSE
questions and fix nothing** — on
the embryology document, 10 pages/window found 64 questions with 9 answered
and 3 pages/window found 57 with 9 answered, because more window boundaries
means more rows dropped in reconciliation (12 duplicate-label drops vs 7). The
knob is retained as a diagnostic, not a recommended remedy; a run that lost
questions should try RAISING it.

*Correction (2026-07-20).* This setting was first shipped on the theory that
INDEX's per-question observations "degrade to a constant partway down a long
response," citing `evidence_state` reading `inline` for refs 1–9 then `none`
for 10–57, with `visible_year` collapsing at the same point. **That diagnosis
was wrong** and is recorded here so it is not re-derived. Rendering the actual
document showed every question carries a printed answer letter in a dedicated
right-hand table column, including the ones marked `none`; and the
`visible_year` collapse was *correct* — the document's Arabic exam-year tags
genuinely stop after question 9. Two unrelated facts coinciding on one page
were misread as one signal. The real defect: `evidence_state`'s vocabulary
(`none`/`inline`/`separate`/`ambiguous`/`illegible`) has no slot for an answer
printed in its own column beside the question — it is not a mark on an option
(`inline`) nor another document (`separate`) — so the model falls back to
`none`, BOX is never asked for an evidence region, and the row ships blank with
a crop that excludes the answer. **Lesson: render the source document before
theorising from model output.**

*Per-page INDEX repair (owner-approved 2026-07-21):* raising the window size
only shrinks the number of tail boundaries where INDEX can under-enumerate — it
never removes the last one, and a normal page (verified by rendering it: seven
plain MCQs, no figure) was dropped at a 3-page window's tail on an IM exam,
lost silently from the output. So after the first reconcile, any page a
manifest said holds questions but that no window owned — a reconcile gap, or
every core page of a window that failed to parse — is re-indexed on its own:
core `[p]`, context `[p-1,p,p+1]` (`repairTargetPages` + the repair loop in
`executor.ts`). A single-page request carries none of the long-response fatigue
that dropped the page, and merges back through the same `reconcileIndexWindows`,
so its page-`p` questions are recovered while any neighbour it re-reads dedups
against the original windows — safe whether the page was omitted or mislabeled.
Gated on INDEX having mostly worked (a run that emitted nothing still falls to
the legacy path, never a call per page); a page still empty after its repair
stays flagged `unreadable_page`; nothing is invented. The
three pinned prompts and the output contract are untouched: repair reuses the
INDEX prompt on a narrower page set. The repair is the real remedy for a lost
page — which is why "Pages per index request" was removed as a knob on
2026-08-23 rather than kept as a diagnostic.

*Worker output split + code-owned assembly (owner-approved 2026-07-15):* the
worker no longer assembles the `question` string. It returns the shared case
stem and the individual prompt as two separate verbatim fields (`case_stem`,
`question`); deterministic code (`merge.ts`) strips each part's printed number
and fills the code-owned `final_format`. This honors "code owns all formatting"
(the worker is the weakest model) and lets the case format change without
touching a prompt. The assembled format itself changed from
`Case stem: {case_stem}\nQuestion: {question_prompt}` to
`{case_stem}\n\n{question_prompt}` — the printed case identity in the stem
("Case 10 …") is kept, the `Case stem:`/`Question:` labels are dropped, and a
blank line separates the two. This edited the WORKER prompt and §2.2's block
(and, at the time, re-pinned its SHA — those pins were removed 2026-08-02); the
legacy format is still accepted on blueprint input so pre-change checkpoints
resume unchanged. 

*Worker chunk split-retry (owner-approved 2026-07-18):* §1.3's "worker chunk
retry is exactly one, then stop" no longer stops the run. A chunk that fails
both attempts bisects into smaller requests (fewer rows, fewer page images —
a genuinely different request) down to single rows; a row that still fails
degrades to an all-blank placeholder row that the existing merge gates flag
(`empty_question`/`incomplete_options`) for Review. `worker_chunk_invalid`
now fires only when **every** row failed (systemic, not "one bad page").
Motivation: an EMLE run lost all 89 clean rows because one chunk drew an
empty (likely safety-blocked) Gemini response twice — an abnormal finish
reason bypasses the controller's transient empty-response retry, and the
old path had no fallback. The WORKER prompt and output contract are
untouched; failure diagnostics now record the finish reason.

*WORKER prompt edit — answer extraction (owner-approved 2026-07-30):* the
second edit ever to a pinned prompt (after the 2026-07-15 output split). The
worker was dropping `correct_index` for an ENTIRE request at a time: on two
answered surgery exams (`EOR SUR MCQ 2025-194`, 65 questions each, a large
handwritten answer letter beside every question) 8 of 22 chunks returned all
six answers blank with perfect question text, at normal speed, no retry, no
truncation, no model fallback — while rows in the SAME call reading the SAME
page image were answered. Cause: the prompt only ever *forbade* answering.
Nothing told the worker an answer existed to look for or where it lives, so
whether a response filled answers at all was decided once per response. The
answer paragraph now adds a positive instruction — find the mark (option mark,
or the letter in an answer column/cell/margin), return its 0-based index, "for
every row in the chunk, not only the first few" — closing with ONE clause
permitting blank when the mark genuinely cannot be read. Doc block §2.2 updated
byte-identically and the prompt re-pinned (SHA pins removed 2026-08-02).

**Deliberately calibrated, not maximal:** a first attempt appended a
hedging-heavy directive (three separate sentences on returning empty) and
the owner measured the result as **worse** — pressure to leave blanks is
itself a failure mode, and the engine's real guarantee lives in code, not in
prompt hedging (`forceAnswer` still forces blanks per policy, still rejects a
non-numeric or out-of-range index, and still discards the worker's
`needs_review`). One clause, once. Do not re-add hedging to this prompt.

**Open:** unmeasured whether the instruction raises answer recall without
raising wrong answers. Judge it on real documents.

*`answer_present` demoted from gate to observation (2026-07-30):* INDEX's
per-question `answer_present` no longer decides whether a row may carry an
answer. `assemble.ts` gives every on-page row the whole-page permission region
and `extract_visible_evidence`; `defaultEvidence` is `inline_marks`
unconditionally (otherwise `forceAnswer`'s document veto re-imposes the gate one
level up). A **separate answer key is untouched** — EVIDENCE's per-ref state
still governs those rows, `illegible` still blanks as `key_unclear`.

*Why.* It was a SECOND perceptual judgement made by the stage least able to make
it. INDEX emits ten fields for every question in one long enumeration and never
needs to look at the margins; the worker reads the page and, since the
2026-07-30 prompt edit, is told to find the mark and to leave `correct_index`
empty only when it genuinely cannot read one. Measured on
`EOR IM MCQ 2025-194-2nd (2) 1.pdf` — a large handwritten answer letter in the
margin beside every question, correct and legible — INDEX returned
`answer_present: false` for **49 of 50**, so 49 rows were blanked before the
worker was allowed to look. The same model, same prompt, same page image, asked
about ONE page at a time returned true for every question on it (page 3: 7/7
three times; page 1: 0/6 with the shipped wording, 5/6 with a relaxed one —
exactly the five questions that have a letter). Multi-page requests collapse to
one verdict for the whole response at any window size tested (3 pages: 0/19
twice; 8 pages: bimodal). So the number was never a per-question observation,
and gating on it discarded readable answers.

*Nothing is guessed by removing it.* `forceAnswer` still forces blanks per the
document policy, still rejects a non-numeric or out-of-range index, and still
discards the worker's `needs_review`; a worker that reads no mark produces the
identical `no_visible_answer` flag the gate produced, so Review is unchanged. An
exam with no answers anywhere still ends all-blank and all-flagged — reached by
looking rather than by guessing. The NEVER-GUESS doctrine this gate predates was
retired the same day (`9675f54`). `answer_present` is still parsed, checkpointed,
and still feeds `keepIndexObservedMarks` as a **positive** signal only (it can
turn an unreadable key into `mixed`, never the reverse). No prompt was edited and
no call was added — this removes a gate, it does not add a pass.

*The model is not the variable.* Both selectable models behave identically on
the shape axis: `gemini-3.1-flash-lite` also returns 1/50 on the 8-page window,
7/7 on page 3 alone and 0/6 on page 1 alone. So this is not fixable by the
per-step `index` model choice in Customize — it is the task shape, and removing
the gate is the fix.

*The shipping gate — whether the worker invents answers on a genuinely
UNANSWERED exam once nothing upstream stops it — was measured and cleared*
(`scripts/probe-worker-answer.mjs`, the pinned WORKER prompt with post-change
row policy, on unanswered vs red-margin-answered scans of the SAME exam):
answered 5/6 and 7/7 filled, unanswered **0/6 and 0/7**. The worker reads marks
when they exist and abstains completely when they do not. Six of the seven
page-3 picks are exactly the printed letters; the seventh is Q19, whose fourth
option is on the next page — the page-boundary defect, which
`options_cut_at_page_break` catches. Without that guard `forceAnswer` would have
accepted the in-range index and shipped a wrong answer, so the two 2026-07-30
fixes depend on each other. Details in `workflows/Gold/ANSWER_LAYOUTS.md`. **Still open:** a
full conversion of an unanswered exam at production chunk size (10 rows, several
page images per worker call) — the probe isolates one page at a time.

*Mixed evidence: an unreadable key no longer blanks the whole document
(2026-07-30):* the EVIDENCE stage only ever reads the **attached key pages**,
yet its parsed `type` became the whole document's `answer_policy`, and
`forceAnswer`'s document-level veto blanks EVERY row on `uncertain` /
`no_answer_key` before any per-row logic runs. So a PDF carrying both a key
file *and* answers marked on its own pages lost every answer INDEX had
correctly read whenever the key itself came back unreadable — reported on a
folder mixing keyed and inline-marked exams. (Per-PDF key pairing,
`putAnswerKeyPdf`/`answerKeyFor`, was verified sound and is not the cause.)
`keepIndexObservedMarks` (`executor.ts`, pure, called only in `runEvidence`)
now reconciles the two observations: when the key reads `uncertain` or
`no_answer_key` **and** INDEX saw marks on the exam pages, the document type
becomes `mixed`. That is the honest label for "some answers here, a key over
there", it permits extraction, and it hands the decision back to each row's own
policy — a row with no observed evidence still blanks `no_visible_answer`, an
illegible per-ref key state still blanks `key_unclear`, and every worker value
is still range-checked. The veto itself is kept; only the label it acts on got
honest. Fixing the label also fixes the worker, which is told the document
policy and would otherwise read `uncertain` and leave answers blank. Per-ref key
evidence passes through untouched, and a run where this fires logs
`engine.evidence.mixed`. **Measured 2026-07-30** on `IM Final MCQ 6th 2025.pdf`
with a deliberately unreadable one-page key attached: the log recorded
`{keyPolicy: "no_answer_key", documentPolicy: "mixed"}`, the blueprint carried
`mixed`, and 11 of 47 rows kept an answer that the pre-fix path would have
blanked — all 47 of them. **Still open:** the separate-key path has no
end-to-end verification on a REAL key document (`workflows/Gold/ANSWER_LAYOUTS.md`, *Still
uncovered*) — treat a keyed run's output as unproven, not as a regression.

*Options split across a page break (2026-07-30):* a question's prompt and first
options print at the bottom of page N and the rest continue at the top of page
N+1; only the page-N part was transcribed (confirmed on three questions across
two documents — one lost option d, one lost c and d). Nothing caught it:
`extendClippedOptionBoxes` is bounded within one page by
`OPTIONS_FOOTER_LIMIT`, `regions.options` is ONE `Region` on ONE page and
cannot express a spanning list, and `underTranscribedRowIds` only re-asked rows
with **fewer than 2** options — a row that came back with 2 of 4 looked like a
legitimate True/False. The fix is deterministic, no prompt change:
`pageBoundaryOptionRowIds` (`assemble.ts`) names the rows whose options are the
last thing on their page with a page after it, and `underTranscribedRowIds`
re-asks such a row only when it ALSO came back with fewer options than the
document's own `modalOptionCount`. Both signals are required — geometry alone
fires on every complete last-question-on-a-page, a low count alone fires on
every genuinely short question. A row the re-ask does NOT recover is flagged
`options_cut_at_page_break`, which is the real guarantee: a truncated question
never ships as if it were whole. A document with no dominant option count
(`modalOptionCount` returns null) keeps only the old <2 rule.

**Measured 2026-07-30** across three live runs of `IM Final MCQ 6th 2025.pdf`
(every page of it ends with a question that continues overleaf). Detection was
exact — 7 suspects, one per page, zero false positives, correctly skipping the
last page and correctly leaving the genuinely-3-option rows 15 and 45 alone.
Recovery is real but not reliable: rows 11 (3→4) and 41 (2→4) were recovered,
row 23 failed three times and was flagged. The flag earned itself immediately —
row 23 came back with 2 of 4 options AND a filled `correct_index`, i.e. a
question that would have exported looking complete while missing the right
answer.

*The `source_pages` widening is NOT the operative fix* — measured, do not
re-derive. Chunks already contained the continuation page every time (chunk 2 =
rows 21–30, pages [4,5]), and row 41 was transcribed correctly from those same
images while row 23 was not. The worker follows the single-page
`regions.options` and stops; the image was never missing. The widening is kept
only because a boundary row that is last in its chunk can genuinely lack the
next page, and it is confined to the re-ask because widening every chunk would
add a page image to every worker request of every run, out of the tutor's own
free-tier quota. **Open:** the AUDIT checks options against the same
single-page regions, so an option correctly recovered from page N+1 reads to it
as an invention (observed: *"Option 'Rigidity' was added by worker"* — it is
printed at the top of page 3) and contributes to `notSafeToImport`. Not worked
around: the AUDIT prompt is pinned, and suppressing "options added" failures in
code would also suppress genuine invention reports. Owner call.

*Review shows the continuation page (2026-07-31):* the flag is only half the
guarantee — when the re-ask fails, the tutor is the fix, and review showed them
the crop of the page the question was cut on, where the missing options are by
definition not printed. A row flagged `options_cut_at_page_break` now carries a
`continuation` (`review-data.ts`): the top of page N+1 down to the first
question boxed there (floor 25% of the page, whole page when none), cropped from
the same stored page image and shown beside the question with a notice naming
the page. Nothing else changes — no engine authority, no extra call, and the
extra page is decoded only for a flagged row, so the normal path is untouched.
Verified by click-through (`scripts/drive-options-cut.mjs`).

*FIGURE DETECT's findings now reach BOX (2026-07-31):* the FIGURE DETECT stage
ran a Gemini call per index window, parsed the response, and **discarded the
result** — `parseFigureDetection(response.text)` was a bare expression whose
value went nowhere. Blueprint assets were built only from figures BOX
volunteers (`assemble.ts` reads `input.boxes.figures` and nothing else), and a
`FigureCandidate` carries no `box_2d`, so the stage could not have produced a
crop whatever it found. It was a per-window call for zero effect on output —
while being a model-selectable step in Customize.

That silently lost pictures. FIGURE DETECT's prompt tells it to be "extremely
aggressive"; BOX only volunteers figures alongside its real job of boxing
question text, and under-reports plain clinical images. Measured on
`Example-of-MCQ-questions.pdf` (22 pages, one ECG/echo per case): FIGURE DETECT
found the rhythm strip on page 4 and the echo still on page 5 — both confirmed
by rendering the pages — and BOX emitted neither, so "Which of the following
will be the first recommended intervention?" shipped with no image and no way
to answer it.

`runFigureDetect` now returns its candidates and BOX consumes them, passed as a
**code-owned hint block** appended alongside the existing `PAGE TASKS:` payload
(`withFigureHints`, `BoxFigureHint` in `calls.ts`). The pinned `BOX_PROMPT` /
`BOX_BATCH_PROMPT` text is untouched and `prompts.test.ts` still passes. Page
numbers had to be converted: FIGURE DETECT returns the **image** number, so the
same figure window 0 called "page 10" window 1 called "p1"; a figure naming an
image its window never received is dropped, never guessed at.

The two stages are now **ordered rather than parallel** — the cost is one call's
latency and **no extra calls at all**, which is why chaining beat the obvious
alternative (a repair pass re-boxing pages whose figure BOX missed would have
cost one extra call per such page, ~15 on that document, out of the tutor's own
free-tier quota). Measured before → after on the same document: rows carrying an
image **6 → 11**, asset pages `2,7,10,15,16,17` → `2,4,5,7,10,12,13,14,15,16,17`,
identical call count, no slower. **Still open:** the remaining gap is FIGURE
DETECT's own recall — it never reported pages 3, 8 or 9, whose questions ("What
is the likely diagnosis?") almost certainly depend on an image. Closing that
means editing a pinned prompt; not done.

*INDEX owner pages are verified against the page text layer (owner-approved
2026-07-31):* INDEX numbers its response against the images it is handed, and on
a window with a leading context page it sometimes numbers from the first **core**
page instead — shifting every page reference in that response by one. Nothing
checked. Worse, reconciliation's `twin` rule tolerates a ±1 page difference (so a
straddling question's misread label still dedups), which meant the two
observations were correctly recognised as the same question, one was dropped, and
**whichever window was seen first won the page** — a coin flip, silently.

*Measured 2026-07-31* over four stored runs: **22 of 30 twinned questions
disagreed about their page by exactly 1**, and rendering the pages settled it
both ways — EMLE questions 70-72 kept p24 (correct, while the *manifest* claimed
p25), Family Medicine questions 19-21 kept p22 but are printed on p21. Single-
window documents had zero disagreements, as expected: no leading context page, no
ambiguity.

The cost is not lost questions — the worker sees several page images per chunk
and still transcribed them (that EMLE run ended 108/109 clean). It is that the
owner page decides **which image BOX is asked to draw on**: the three
`no box region after retry` flags on EMLE "page 14" are exactly the three
questions printed on page 13. Plus false `unreadable_page` issues, which set
`notSafeToImport` for the whole run, and `repairTargetPages` spending a Gemini
call re-indexing a page that was never empty.

The fix needs no call and no prompt change: the `anchor` INDEX returns is
verbatim visible text, and every page's text layer is already extracted at render
(`page-text`). `verifyOwnerPages` (`enumerate.ts`, pure) searches it and corrects
the page. Deliberately narrow so it can only repair the observed defect — only
pages `ownerPage ± 1` are candidates, the anchor must hit **exactly one** of them
(a formulaic stem matching several is left alone, never resolved arbitrarily),
and `source_pages` shifts with the owner so a straddling question keeps its span.
Replayed against the real EMLE run it corrected **30 of 109 rows** — pages 12
through 21, every one by −1, the signature of one shifted window — and positively
confirmed 107 of 109.

A **scan has no text layer** (Family Medicine: 0 characters across 30 pages), so
verification is a strict no-op there — never a downgrade. Those documents get the
other half: reconciliation now records a `PageDisagreement` instead of absorbing
it, and any disagreement the text layer could not settle becomes an
`uncertain_page` planning issue naming both candidate pages, so a coin-flip page
is shown to the tutor rather than shipped silently. Manifest-derived
`unreadable_page` issues are recomputed after verification, so a page that was
only "empty" because its questions sat one page over stops being flagged and
stops drawing a repair call. **Open:** on a scan the disagreement is still
resolved by first-observed-wins; only the flag is new.

*Matching-question policy (owner-approved 2026-07-18):* a true matching
question — one row whose answer is a set of pairings — cannot be carried by a
single-`correct_index` Triviadox row. Customize's **"Matching questions"**
setting picks what happens to it: `split` (**default** — one MCQ per
left-column item, options = the right column verbatim) or `skip` (drop the
row). There is deliberately **no "ship it as printed" mode** (owner call): a
matching row can never be imported as it stands, so leaving it intact was
never a real outcome. Cost: one extra request per run, and only when some
row's text actually mentions matching or pairing — the keyword gate keeps
ordinary exams free. `src/engine/matching.ts` is new
surface **outside the engine path**, solver-style: it runs *after* the audit
gate, so `validateFinalRows` and the audit still see the engine's rows 1:1
against the pinned blueprint — only post-audit rows are reshaped. The three
pinned prompts, the blueprint, and the output contract are untouched. The
model's only job is to name the matching rows and separate the two columns;
deterministic code writes every word of the split row's wrapper and **rejects
any span that is not verbatim in the source row** (`verbatimIn`), so this is
re-shaping, never authorship. Split rows always ship a blank `correct_index`
with a review flag: the pairing was never read off the page, so it is not
invented. Any failure (no candidates, dead call,
unusable response) returns the engine's rows untouched. Split ids are
`{parentId}~m{n}`; `parentRowId` lets Review resolve a split row back to its
parent's source region. Extended-matching stems (one stem, shared option
bank) are explicitly *not* matching questions and are left alone.

*Export projection (owner-approved 2026-07-14):* exported CSVs are a
column projection of the pinned format (`src/export/export-csv.ts`,
OUTPUT_CONTRACT §3.1): `id` never leaves the device;
`topic`/`subtopic`/`year` are conditional per the Customizations settings.
The in-run `csv` artifact keeps the internal format — the 9-column
`CSV_SCHEMA` as of the 2026-08-02 note below.
The topic matcher (`src/engine/topic-matcher.ts`) and
topics-document reader (`src/engine/topic-extract.ts`) are new surface
outside the engine path, solver-style: they never modify `merged-rows`,
deterministic code validates every pick against the user's list, and
unsure stays blank — a wrong topic is worse than a blank one.
*Model pin (owner decision 2026-07-22):* both stay on
`gemini-3.1-flash-lite`, not the newer `gemini-3.5-flash-lite` primary the
engine's vision roles moved to — the owner found 3.1 matched questions to
topics more accurately, and this is a text-only reasoning task where that
judgement is the whole job. Only this post-audit topic feature pins the
older model; the engine roles are unaffected.

*Per-row match validation + post-run editor (owner-approved 2026-07-21):*
the matcher validated a whole 20-row chunk atomically and blanked all 20
if any single row's pick failed — on a 50-question run this silently lost
19 good matches when one row in the first chunk came back bad (rows 1–20
blank, 21–50 matched). `validateMatchChunk` is now **per-row**: a blank
pick is a valid "unsure", a listed topic is accepted, and only genuinely
bad or omitted rows are retried alone; only structural garbage (not JSON,
no `matches` array) still fails the whole response. The one retry re-sends
just the offending rows, and a row still bad after it stays honestly blank
— its neighbours survive. Separately, TOPIC_EXTRACT now
strips count badges beside a topic name (`Cardiology 167` → `Cardiology`),
which cleaned exported labels and was the likely trigger of the chunk
failures. New `RunTopicsPanel` (review) lets a tutor rename/remove a run's
topics and re-match every row against the edited list without re-running
the conversion (`rematchRunTopics` = write `topics-list` + clear
`topic-matches` + `matchRunTopics`); still outside the engine path,
`merged-rows` untouched. `TopicsEditor` also gained **reparenting**
(owner-approved 2026-07-21): a "Make a subtopic of…" picker demotes a
top-level topic (and its own subtopics) under another, and "Make topic"
promotes a subtopic back — so a flat extraction the tutor knows should be
nested can be restructured by hand before converting, not just retyped.

*Post-run topic matching from scratch (owner-approved 2026-07-22):*
`RunTopicsPanel` no longer hides when a run finished with no topic list. A
run converted without topics (topics mode off, or no list supplied) now
shows an **"Add topic matching"** entry in review: the tutor supplies a list
— **either** dropping a topics document (PDF/image), read in place by the
same `extractTopicsFromDocument` the setup screen uses, **or** typing it in
`TopicsEditor` — and matches every extracted row against it, no re-run. The
engine already supported this — `rematchRunTopics`'s `writeRunTopics`
creates the `topics-list` snapshot on first save — so the match side is a
pure UI unlock (the old `runTopics === undefined` early-return is gone). The
document read is the setup extraction reused: the dropped file's bytes go
straight to `extractTopicsFromDocument` (no job PDF stored), and read
failures map to the same bad-key ≠ quota ≠ unreachable notes. Still outside
the engine path with `merged-rows` untouched (unsure rows stay blank). Export already keys its topic columns off the per-run
`topics-list` artifact (`hasTopics` in `exporter.ts`), not the global topics
setting, so an added-after-the-fact list flows straight into the exported
`topic`/`subtopic` columns.

## Workflows (mineral-named conversion strategies)

**Full reference: [workflows/README.md](workflows/README.md)** — the three
tiers, the output contract, and how to add a mineral. The notes below are the
binding rules and the reasoning behind them.

**Any change to a workflow's behavior increments that workflow's `version`** —
`workflow.ts` and its README's `**Version:**` line, in the same commit as the
change. Prompt edits, merge and validation rules, window sizes and model
defaults are all behavior; only edits that cannot change an output row
(comments, docs, tests, renames) may leave it alone. Results files are keyed by
workflow AND version, so a behavior change that leaves the number still
re-labels the old measurements as describing the new code. A change that CAN
alter output also records what it measured in `benchmarks/results/`; one that
provably cannot (a knob removed at its shipped default) says why in the
workflow's version history instead.

*Workflow split (2026-08-02):* the single conversion pipeline became a set of
named strategies under `workflows/`. **Gold** is the original, verified one and
its behavior is unchanged; `workflows/Gold/engine/` is the former `src/engine/`
verbatim. Three tiers, and the boundary is the point:

1. **Workflow-owned.** `workflows/<Mineral>/workflow.ts` declares the strategy's
   render policy (`dpi`, `reinitEvery`), its request-making steps with each
   step's default model AND the Customize picker grouping, and a `run()` entry
   point. Customize renders whatever the selected workflow declares, so a new
   mineral needs no screen edit. `workflow.ts` must load its engine **lazily**
   inside `run` — `registry.ts` is reachable from the widely-imported settings
   module, and a static engine import there drags every prompt string and the
   pdfium WASM into the main bundle.
2. **Shared device/account plumbing, deliberately NOT per-workflow.** The pdfium
   binding, the measured JPEG encoder probe, the one on-device Gemini key, the
   per-model quota tally, IndexedDB, backup. These are facts about the machine
   and the user's Google project, not strategy. A workflow sets render *policy*;
   the shared rasteriser applies it. Copying the rasteriser per mineral would
   mean the next Android encoder fix has to land in every copy — the failure
   "ship everywhere or nowhere" exists to prevent.
3. **Shared output contract.** `ExamQuestion[]` written to `merged-rows`, plus
   `crop` records for anything a row names in `image_urls` and `page-jpeg` for
   Review's source view. That is what earns every mineral ONE Review screen and
   ONE "Export to Triviadox" instead of a fork per workflow. Note it is
   deliberately wider than "just the CSV": export never reads the `csv`
   artifact — `exporter.ts` re-projects columns from `merged-rows` — and Review
   works on `ExamQuestion`, so a CSV-only contract would leave Review nothing to
   render. Gold's own checkpoints (`blueprint-raw`, `index-window`,
   `index-reconcile`, `figure-window`, `chunk-request`, `chunk-response`) are
   private; nothing outside Gold reads them, and `backup.ts` already archives
   every shared kind and none of these.

*`MergedRow` → `ExamQuestion` (2026-08-02):* the old name described the pipeline
step that produced the row rather than the thing itself, which is wrong for what
is now a cross-workflow contract. (`PlannedRow`/`WorkerRow` keep their
stage names — those genuinely ARE "the row as that stage made it".) The
`merged-rows` artifact KIND is deliberately unchanged: it is a persisted key,
and renaming it would orphan every stored run.

*The whole `group_id` concept removed — third and fourth pinned-prompt edits
(owner-approved 2026-08-02):* `group_id` was a **derived label nothing read**.
`assemble.ts` minted it from `caseStemKey ?? ref`, `linked_group_id` was always
`''`, `group_count` was a statistic, and case assembly keys off `caseStemKey`,
never the group — so removing it is behaviourally inert. It was never exported
and no downstream consumer touched it.

Removed from the PLANNER prompt (`csv_schema`, the `planned_rows` example,
`group_count`, `linked_group_id`, `may_change_grouping`, and the "a group is a
real shared case stem" rule) and from the WORKER prompt (its output example and
the copy-through list, since the planner no longer supplies it). The AUDIT
prompt was **not** touched — its one mention of "grouping" is a word in a prose
list, not a field reference, and leaving it saves a third re-pin. New SHAs:
planner `5807f59f…` (was `550503d8…`), worker `ab4798fd…` (was `274e8002…`),
audit unchanged at `7bedae91…` — which is the proof only two prompts moved.

`CSV_SCHEMA` is now the **9-column** list, and it is again the single source for
both the blueprint handshake and the in-run `csv` artifact (the brief
`QUESTION_CSV_COLUMNS` split existed only to hold `group_id` back from the CSV
and is gone). `assemble.ts` now spreads `CSV_SCHEMA` instead of re-typing the
list, so the two can no longer drift. Also gone: `PlannedRow.group_id`,
`WorkerRow.group_id`, `DocumentProfile.group_count`,
`BlueprintAsset.linked_group_id`, `WorkerConstraints.may_change_grouping`, the
`group_id must be non-empty` blueprint rule, `windows.ts`'s cross-window group
renumbering, and the agent bundle's `groupId` (dropping it from the schema is
backward compatible — an older bundle that still carries the key is ignored, not
rejected). Split matching rows relate to their parent through the
`{parentId}~m{n}` id and `parentRowId`, which is what Review always used.

**Two tests were deleted, not adapted** — the `group_id must be non-empty`
validation test and `windows.test.ts`'s group-renumbering test — because the
behaviour they covered no longer exists. Suite: 577 → 575.

*Prompts moved into the workflow (2026-08-02):* the three big prompt blocks left
the former `Docs/CODOX_MIGRATION.md` §2 for **`workflows/Gold/PROMPTS.md`**. A repo-level
doc asserting "this file contains exactly three prompt blocks" was a
Gold-specific claim in a shared place; another mineral has its own steps and
prompts and need not have three. The §2.1/2.2/2.3 subheadings moved WITH the
blocks so the ~15 code comments citing "§2.2" still resolve. The move was
byte-exact — all three hashes were identical before and after, which is how it
was verified (the hashes still existed at that point).

*The rest of the migration doc followed, and the docs were pruned
(2026-08-02):* the prompt move left the job half done. §1 (engine semantics)
was the **same** Gold-specific claim in a shared place — four roles, a planner,
a blueprint, an 8-step sequence, none of which a second mineral need have. It
is now **`workflows/Gold/ENGINE.md`**, beside the prompts it implements, and
`Docs/ANSWER_LAYOUTS.md` went with it as `workflows/Gold/ANSWER_LAYOUTS.md` —
its findings are about INDEX/EVIDENCE/WORKER, Gold's stages.

The split followed the **tier boundary, not the section numbering**, because
citation counts showed §1 was not purely Gold's: §1.5/1.6/1.7/1.9/1.10 are
cited 20 times, every one from inside Gold, but §1.8 (the 0–1000 box
convention) is cited by `src/pdf/`, §1.3 by `src/state/`, and §1.4 by
`src/agent-import/` — the shared tier. So §1.8, the shared render parameters,
and all of §3 became **`Docs/OUTPUT_CONTRACT.md`**, which is the honest name
for them: the thing every workflow must satisfy to earn one Review screen and
one Export button. Original section numbers are preserved in both files so
existing comments still resolve; the file *names* in those comments were
updated.

Deleted outright as historical: `Docs/BUILD_PLAN.md` (phases 0–9, last dated
2026-07-13, describing none of the work since, while CLAUDE.md sent every agent
to it "for the current phase"), `Docs/TECHSTACK_RESEARCH.md` (a dated research
snapshot whose multi-provider chain was superseded by the Gemini-only rule
within two days of being written — its still-binding parts, the AGPL/paid PDF
library traps, moved into CODOX_CONTEXT §6), and CODOX_CONTEXT's own §6–13
(the v2 PRD stack table, the pre-build spike list, the old research repo's
evidence log, the resolved BLIND-SPOTS — all written to decide a rebuild that
finished a month ago). Nothing measured was lost: the numbers that still matter
already live in this file, and the answer-layout measurements live in Gold.

*SHA-256 pins removed (owner call 2026-08-02):* `PROMPT_SHA256` and its
assertions are gone. They restated what the byte-equality check already proves,
while turning every prompt edit into a three-place ritual — and a checksum never
indicated whether a prompt was *better*. The freeze made sense when there was
one pipeline and the archived research was the only evidence; workflows now
exist so alternative prompt strategies can be tried, and `benchmarks/` is what
compares them. What SURVIVES in `prompts.test.ts`, and is worth keeping: three
blocks present, each constant byte-equal to its block (the generated file is
stale otherwise — a real, silent bug), plus two content spot-checks a retyped
prompt tends to lose (the literal backslash-n in `final_format`, the
image-discovery clauses). It resolves PROMPTS.md relative to ITSELF, so a second
workflow is independent. Suite 575 → 574.

Gold's OTHER prompts — INDEX, EVIDENCE, FIGURE_DETECT, BOX, BOX_BATCH,
REFERENCE_RESOLVER, and the post-audit matching/solver/topic prompts — were
never generated or pinned and are edited directly in `engine/prompts.ts`.

## Ship everywhere or nowhere (non-negotiable)

A fix is not done until it is **committed and pushed to `main`** — that one
push is what ships every channel (auto-release.yml deploys the web app and
cuts the GitHub release the Windows auto-updater feeds from). Channels
update at different speeds: web is automatic within minutes, Windows
auto-updates silently on launch, and Android checks on launch too — it
shows an in-app update banner that downloads the new APK and opens the
system installer, but that needs the user to tap through (and allow
"install from unknown sources" once), so it is **not silent** and can lag
until they accept it. A "works on web, broken on phone" report is usually
an APK whose update the user has not accepted yet — or, across the
pre-v0.0.51 signing-key boundary, one that must be uninstalled once before
it can upgrade (`/releases/latest` is the manual APK fallback) — not a code
fork. Never deliver
a fix as a local-only `wrangler deploy`, a hot edit on one machine, or a
change to one device's stored data: that repairs a single installation and
leaves every other device broken. If a fix genuinely cannot ship through
`main` (e.g. it requires clearing per-device state like the service-worker
cache or IndexedDB), say so explicitly and list which devices remain
affected and what the user must do on each.


## Stack & conventions

- TypeScript, strict mode. One web codebase; Tauri/Capacitor are pure
  wrappers — **no per-platform UI forks or behavior forks.**
- The running app is the only design artifact; UI approval means owner
  click-through in the app, never a standalone HTML mockup. Every visual
  value comes from `tokens.css`, and every shared pattern is one class in
  `components.css`.
- Real DOM, keyboard-navigable, accessible UI (the Review screen especially).
  Prefer headless accessible primitives (Radix/React Aria).
- **The JPEG encoder is measured, never assumed.** Page encoding is the
  dominant render cost and no single route wins everywhere — measured
  2026-07-19, ms per A4 page at 200 DPI: OffscreenCanvas 174 / DOM canvas 95
  / MozJPEG-WASM 432 on desktop web; 83 / 204 / 417 on the Windows app;
  **8500 / 4109 / 331 in the Android APK**. Canvas is ~4x faster than WASM
  where it works and 26x slower inside Capacitor's Android WebView (a Skia
  bitmap/readback cost, not JPEG maths), and the two canvas flavours trade
  places between the two desktop shells. `src/pdf/encoder-select.ts` therefore
  runs a small sub-second probe once per session and keeps the winner. This is
  deliberately **not** a platform check — there is no `if (android)` anywhere,
  so the no-behavior-forks rule holds, an Android WebView that fixes canvas is
  picked up automatically, and an unmeasured device is never guessed at. The
  probe must warm every candidate before timing any of them: each has one-off
  first-call costs, and warming only some picks the wrong encoder.
- Mobile memory discipline is law: pages render one at a time
  (render → send → release), canvases destroyed immediately after use;
  design target is a ~100 MB working set (iPhone-SE-class).
- Export-early is law: the app must never be the sole holder of a user's
  work; loud or automatic export when review completes.
- **Stored work is protected and backed up** (owner-approved 2026-07-31):
  IndexedDB is *evictable by default* — a browser short of disk may drop the
  whole origin without asking, which is how a tutor loses history and folders
  "after an update". Two defences, both outside the engine path.
  (1) `src/state/persist.ts` requests `navigator.storage.persist()` the first
  time work is stored (`addStoredPdf`, `createRun`, `createFolder`) rather than
  at cold start, so Firefox's prompt arrives with a visible reason; the History
  panel reports the state and can re-ask, since Chrome grants on engagement.
  (2) `src/state/backup.ts` is a single-zip backup/restore. Two scopes: `work`
  (rows, CSV, review resolutions/edits/deletions/additions, approved AI
  answers, topics, crops — small) and `everything` (plus page images and the
  original PDFs). The Gemini key is **never** in a backup — it stays
  on-device and a backup file travels. Restore is additive and idempotent
  (`bulkPut` by id), never writes the `current` workspace, and **demotes rather
  than repairs**: a record that fails validation is skipped and counted, so a
  damaged archive never yields an invented row. `src/state/auto-backup.ts`
  writes a `work` backup into a folder the tutor picks once (File System
  Access, **feature-detected not platform-detected**) after each batch and at
  launch when stale, keeping five; pruning only ever touches files carrying
  the automatic name prefix, never a hand-saved backup.
- **Never let a shell kill the app mid-write.** The Windows NSIS updater kills
  the process to swap the binary; a hard kill with IndexedDB writes in flight
  leaves the leveldb journal and the on-disk blob tree disagreeing, and
  WebView2's recovery is to destroy the whole origin database. Observed
  2026-07-24: the IndexedDB store was recreated minutes after an auto-update
  while Local Storage — which has no blob tree — survived from Jul 14
  untouched. `updater.ts` therefore closes Dexie before
  `downloadAndInstall()`. Any future shell-driven restart must do the same.
- One bad page never crashes a job — flag it and continue. There is no
  answer-source declaration: the planner's evidence-based policy is the only
  authority on where answers live; the answer-key drop zone is optional and
  a present key PDF is always attached.
- Provider errors must be distinguishable in the UI: bad key ≠ provider
  unreachable ≠ quota exhausted (quota reads as "paused," not broken).
