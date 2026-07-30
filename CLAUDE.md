# CLAUDE.md — Codox

Codox converts exam PDFs into Triviadox-ready CSV bundles, entirely
client-side, for non-technical tutors. Read [Docs/CODOX_CONTEXT.md](Docs/CODOX_CONTEXT.md)
for the full product context, [Docs/BUILD_PLAN.md](Docs/BUILD_PLAN.md) for the
current phase, and [Docs/TECHSTACK_RESEARCH.md](Docs/TECHSTACK_RESEARCH.md)
for why each stack piece was chosen.

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
  `validateAgentExam`/`toMergedRow` demote rather than repair. The import makes
  no network request — no Gemini call, no key — so the provider/quota rule is
  untouched, and it writes the same artifacts a finished conversion does, so
  Review, edit mode, topic matching and export work on it unchanged. Import is
  a folder picker, so the button feature-detects `webkitdirectory` and says so
  where it is missing.

## Engine semantics

The Planner-Worker-Audit engine semantics, its three prompts, and the
Triviadox CSV output contract came **as-is** from
[Docs/CODOX_MIGRATION.md](Docs/CODOX_MIGRATION.md). Deterministic code owns all
formatting, IDs, and CSV emission — models only read pages, never format
output.

The three prompts are SHA-pinned by `prompts.test.ts`: the constant, the
`Docs/CODOX_MIGRATION.md` block, and the hash in `PROMPT_SHA256` must agree.
That is a speed bump, not a lock — editing a prompt means updating all three
together, which the 2026-07-15 output split and the 2026-07-30 answer
extraction both did.

*Model assignment (owner-approved 2026-07-14, superseded 2026-07-22):* the
2026-07-14 pin ran all roles on `gemini-3.1-flash-lite` (chosen over
CODOX_MIGRATION §1.2's `gemini-3.5-flash` planner because 3.5-flash's free-tier
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

*Question count is code-owned (owner-approved 2026-07-14):* CODOX_MIGRATION
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
a BOX_BATCH variant covers several pages per BOX call when the user raises
Customize's "Pages per box request" above 1 — an opt-in accuracy-for-quota
trade; 1 (the default) keeps the original single-page BOX prompt byte-identical.
Question regions are always stamped with the ref's code-known owner page; only
figure pages come from the model, validated against the batch.
*(2026-07-20, owner-approved:)* INDEX window size is Customize's **"Pages per
index request"** (1–10), threaded to `planWindows`; the default stays
`DEFAULT_WINDOW_PAGES` = 10, so engine behaviour is unchanged until a tutor
lowers it. **Lowering it is measured to LOSE questions and fix nothing** — on
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
INDEX prompt on a narrower page set. "Pages per index request" stays a
diagnostic knob; the repair is the real remedy for a lost page.

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
blank line separates the two. This edited the pinned WORKER prompt (new SHA in
`PROMPT_SHA256.worker`) and CODOX_MIGRATION §2.2; the legacy format is still
accepted on blueprint input so pre-change checkpoints resume unchanged. 

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
permitting blank when the mark genuinely cannot be read. New SHA in
`PROMPT_SHA256.worker` (`274e8002…`, previously `b2b42964…`), doc block §2.2
updated byte-identically, `prompts.test.ts` re-pinned.

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
fixes depend on each other. Details in `ANSWER_LAYOUTS.md`. **Still open:** a
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
end-to-end verification on a REAL key document (`ANSWER_LAYOUTS.md`, *Still
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
CODOX_MIGRATION §3.1): `id`/`group_id` never leave the device;
`topic`/`subtopic`/`year` are conditional per the Customizations settings.
The engine prompts, blueprint `csv_schema`, merge, the in-run `csv`
artifact are untouched — they keep the internal
10-column format. The topic matcher (`src/engine/topic-matcher.ts`) and
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
- One bad page never crashes a job — flag it and continue. There is no
  answer-source declaration: the planner's evidence-based policy is the only
  authority on where answers live; the answer-key drop zone is optional and
  a present key PDF is always attached.
- Provider errors must be distinguishable in the UI: bad key ≠ provider
  unreachable ≠ quota exhausted (quota reads as "paused," not broken).
