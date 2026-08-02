# Gold — engine semantics

_Gold's conversion strategy: the Planner-Worker-Audit pipeline, its steps, and
the rules deterministic code enforces around it. This is **Gold's** design, not
the repo's — another mineral has its own steps and need not have a planner, a
blueprint, or an audit at all._

_Companion files: [PROMPTS.md](PROMPTS.md) is Gold's three big prompts;
[ANSWER_LAYOUTS.md](ANSWER_LAYOUTS.md) is what real documents do with answers
and what Gold's stages measured on them. The **shared** output contract every
workflow must satisfy — the CSV schema, and the coordinate rule the render
tier owns — is [Docs/OUTPUT_CONTRACT.md](../../Docs/OUTPUT_CONTRACT.md)._

Section numbers `§1.x` are preserved from the original `CODOX_MIGRATION.md`,
because ~50 code comments cite them. §1.8 (coordinates) and §3 (output
contract) moved to `Docs/OUTPUT_CONTRACT.md` and are cited from there.

## 0. Scope and authority

- These semantics migrated as binding design from CodoxSandbox (extracted
  2026-07-08). Change their meaning with explicit human approval; the
  reasoning behind a change belongs in CLAUDE.md, where the engine's
  decision history lives.
- The **role split** — strong planner / weak worker / deterministic code /
  read-only audit — is the contract. Model *names* are not; quota and
  availability move them, and per-step model selection (CLAUDE.md,
  owner-approved 2026-07-22) put the choice in the tutor's hands.
- Prompts are **not frozen**. The original rule — migrate byte-for-byte, never
  tune — held while there was one pipeline and archived research was the only
  evidence. It has been overtaken: the prompts have been edited four times on
  measured evidence, and workflows exist precisely so alternative strategies
  can be compared. What replaced the freeze is [`benchmarks/`](../../benchmarks/),
  which scores strategies on real documents instead of asserting a checksum.
  Still binding: **no document-specific facts, counts, mark-type hints, or
  grouping hints ever go into a prompt.**
- Correctness is judged on real documents, never on a test harness.

---

## 1. The engine — Planner-Worker-Audit pipeline

### 1.1 The four roles

The engine separates thinking, transcribing, enforcing, and checking:

- **Planner (strong model, brain):** analyzes rendered page images and emits a
  structured JSON **blueprint** — document profile, answer policy, one planned
  row slot per question, case structure, image bounding boxes, text-region
  anchors, and worker constraints. It does **not** produce the final CSV and
  does not fully transcribe questions. *(Since 2026-07-14 the single planner
  call is staged into INDEX / EVIDENCE / FIGURE DETECT / BOX — see CLAUDE.md,
  "Planner redesign". The role's authority is unchanged.)*
- **Worker (weaker/cheaper vision model, muscle):** fills the planned rows
  with transcription only, in chunks, with **no structural freedom**. If the
  planner is wrong, the worker still follows the planner (a wrong planner is a
  planner failure, caught by validation/audit — never silently "fixed" by the
  worker).
- **Deterministic code (guardrail):** renders pages, validates the blueprint,
  crops images from planner boxes, batches worker chunks, merges
  planner-owned fields over worker output, enforces answer policy, validates
  the final rows, and writes the CSV. Code never infers content; it enforces
  structure.
- **Audit (cheap model, read-only gate):** compares the merged rows against
  the source pages, blueprint, and crops, and emits a binary
  safe/not-safe-to-import verdict. It never edits data.

Design note: no model answers from subject knowledge — the engine reads the
answer off the page. Where the evidence is absent, `forceAnswer` leaves the
row blank and flagged for Review. *(Ask AI and agent-conversion `reasoned`
answers are separate, post-audit paths that reach a row only through tutor
approval — CLAUDE.md, "How answers flow".)*

### 1.2 Model assignment

Every request-making step is independently selectable in Customize → Advanced;
each defaults to `gemini-3.5-flash-lite`, and the selectable model **not**
picked becomes that step's runtime fallback under the same one key. The engine
never swaps a step's model mid-run. The binding rule and its history are in
CLAUDE.md, "Per-step model selection" and "Runtime model fallback".

The original 2026-07-08 intent — `gemini-3.5-flash` planner, `flash-lite`
worker and audit — is superseded; it is recorded here only because the
**audit** assignment was a deliberate choice worth keeping in view: the
weakest model does the hardest verification job, and its accuracy is a
*measured output*, never an assumption.

### 1.3 Step sequence (each step writes its inputs and outputs before the next starts)

1. **Render pages.** Rasterize every PDF page to a fixed-scale image (reference:
   200 DPI). All model calls use *these exact images* — bounding boxes are
   only meaningful relative to them. Gate: every page renders non-empty.
   Failure → stop (`render_failed`).
2. **Planner call.** All rendered pages + the planner prompt. Output:
   raw blueprint JSON. Gate: valid JSON, no truncation finish-reason, required
   top-level fields present. Failure → stop (`planner_unparseable`), keeping
   the raw response.
3. **Blueprint validation (deterministic).** Full rule list in §1.6. On
   failure: exactly **one** planner repair round — resend the original pages,
   the invalid blueprint, and the validation errors; validate the repaired
   blueprint. Still invalid → stop **before any worker call**
   (`planner_invalid_after_repair`).
4. **Deterministic crops.** Code crops every planner-defined image asset from
   the rendered pages using the planner's bounding boxes. The cropper never
   adjusts or reinterprets boxes — if the box is wrong, the crop is wrong and
   the audit/validation must catch it. Gate: every asset referenced by any
   planned row exists, lies inside page bounds after clipping, and has
   non-degenerate pixel dimensions. Failure → continue (worker still gets
   available crops and full pages) but mark the run `not_safe_to_import`.
5. **Chunked worker calls.** Split planned rows into chunks (default 10 rows).
   Each chunk receives a **reduced blueprint** — the CSV schema, the document
   profile (including answer policy), the worker constraints, and ONLY that
   chunk's planned rows plus the asset entries those rows reference — never
   the complete blueprint (resending all rows wastes tokens and invites the
   worker to fill rows outside its chunk). Also sent: the full page images
   those rows' regions reference, the referenced crops, and the worker prompt.
   Record per chunk exactly what was sent, so every call is reconstructable.
   Gate per chunk: valid JSON; a `rows` array; exactly the requested row IDs,
   no additions/removals/reordering; no changed planner-owned field values.
   Chunking is mandatory — long exams do not fit one worker response.

   **Failure handling, changed 2026-07-18 (owner-approved).** The original rule
   was "retry once, then stop". A chunk that fails both attempts now **bisects**
   into smaller requests (fewer rows, fewer page images — a genuinely different
   request) down to single rows; a row that still fails degrades to an all-blank
   placeholder the merge gates flag for Review. `worker_chunk_invalid` fires
   only when **every** row failed. Motivation: a run lost all 89 clean rows
   because one chunk drew an empty (likely safety-blocked) response twice.
6. **Deterministic merge.** Code merges worker rows into planner row
   skeletons under the ownership rules of §1.4/§1.7. Gate: merged rows match
   blueprint row IDs and obey answer policy. Failure → stop
   (`merge_validation_failed`).
7. **Final validation and export.** Gate: CSV columns exactly match the
   contract column list (OUTPUT_CONTRACT §3); required text fields non-empty
   unless the row is explicitly flagged; options present for MCQ rows;
   `correct_index` blank or a valid 0-based index into that row's options;
   every `image_urls` path exists; every referenced crop was produced. Failure
   → still write the CSV when possible, but mark the run `not_safe_to_import`.
   Validation failures are never sent back to the worker to "fix."
8. **Audit call (read-only).** Rendered pages + validated blueprint + crops +
   merged rows + the audit prompt. Gate: audit JSON parses and contains
   `audit_pass`, `failed_rows`, `global_failures`, `risk_class`. If the audit
   call itself fails → mark `audit_unavailable`; **never infer a pass.** An
   audit fail does not block export: the CSV and the audit report both ship,
   with run status **not safe to import** and the report explaining why. The
   audit is a gate, not a fixer.

Post-pipeline, deterministic normalization owned by code (not by any model):
strip leading enumeration labels ("A.", "b)") from option text — the worker
transcribes labels verbatim precisely so that the *code*, not the weakest
model, decides what is a label.

Operational note (quota): distinguish per-minute rate limits (recoverable —
wait the server-provided retry delay and continue) from per-day quota
exhaustion. Both are now fallback triggers, and per-day is the **strongest**
one, because Gemini meters requests-per-day **per model** — see CLAUDE.md,
"Daily quota is per MODEL, not per key".

### 1.4 Field ownership (who may write what)

| Field | Owner | Notes |
|---|---|---|
| `id` | Planner/code | printed question number, or sequential strings in reading order if unnumbered |
| `topic` | Planner/code | from visible document headings only, else blank |
| `subtopic` | Planner/code | same |
| `year` | Planner/code | from visible document evidence only |
| `question` | Worker fills, code formats | code assembles the case format (§1.10) |
| `options` | Worker | transcribed option text in visible order |
| `correct_index` | Planner policy/code; worker only when policy allows | blank when no visible answer evidence exists |
| `image_urls` | Planner/code | paths to deterministic crops; worker cannot change them |
| `needs_review` | Planner policy/code | the worker's `needs_review` value is **always discarded** at merge |
| row count & row order | Planner/code | worker may never add, remove, or reorder |

### 1.5 Answer policy (planner-owned, code-enforced)

Exactly one of five types, chosen by the planner from document evidence alone:

| Type | Meaning | Worker behavior |
|---|---|---|
| `no_answer_key` | no visible answers or markings anywhere | leave `correct_index` blank, `needs_review=no_answer_key` |
| `separate_key` | a visible printed/handwritten answer key exists | read only planner-specified key regions, join by printed IDs |
| `inline_marks` | answers marked on the question pages | inspect only planner-specified mark regions |
| `mixed` | multiple evidence sources | follow explicit per-row planner instructions |
| `uncertain` | planner cannot safely classify the evidence | leave answers blank and flag review |

Enforcement rules (deterministic, applied at merge regardless of what the
worker emitted):

- Policy `no_answer_key` or `uncertain` → code **forces** `correct_index=""`
  and `needs_review` to the policy reason, even if the worker filled answers.
  *(This document-level veto is why the policy label must be honest about a
  document carrying both an attached key and on-page marks —
  `keepIndexObservedMarks` resolves that to `mixed`. CLAUDE.md, "Mixed
  evidence".)*
- Policy permits extraction but the worker left a row blank → keep it blank,
  set `needs_review="no_visible_answer"` — never fill it by any other means.
- When evidence exists (`separate_key`, `inline_marks`, `mixed`), the planner
  must supply a non-null `answer_evidence` region for every governed row; a
  policy pointing at evidence with a null region is an invalid blueprint.
- The same answer-mark form appearing on two or more options of one question
  is genuine ambiguity → blank + flag, never a confidence pick (incidental
  scribbles are noise and are ignored; the mark form itself duplicated is the
  flag condition).

### 1.6 Blueprint validation rules (deterministic, pre-worker)

- JSON is valid and matches the expected schema.
- `csv_schema` equals exactly the 9-column `CSV_SCHEMA`
  (OUTPUT_CONTRACT §3.1).
- ~~`planned_rows` count equals `document_profile.question_count`.~~
  **Superseded 2026-07-14 (owner-approved):** this no longer runs as a
  validation rule. `question_count` must still BE a number (the contract
  shape), but code emits `rows.length` — the rows are the product. Only a
  *shortfall* is a signal, owned by `isUnderExtracted`, which splits the page
  window instead of repairing. Rejecting a surplus once threw away 17
  fully-specified rows over a profile field reading 15.
- Row IDs are unique; row order is deterministic.
- Answer policy type is one of the five allowed values (§1.5).
- Bounding boxes are numeric four-part `[ymin, xmin, ymax, xmax]` arrays.
- Page references are valid for the rendered page set.
- Every planned image path has a source bbox.
- Every row has all planner-owned fields.
- Every row has enough regions or anchors for worker transcription.
- If answer policy is `separate_key`, `inline_marks`, or `mixed`, every row
  governed by that policy has a non-null `answer_evidence` region.
- Worker constraints are present and forbid structural changes.
- `question_assembly.mode` is `plain_question_prompt` unless the planner
  identifies a real shared case stem for that row.

One repair round maximum (§1.3 step 3).

### 1.7 Merge rules (deterministic)

- Planner/code wins for: `id`, `topic`, `subtopic`, `year`,
  `image_urls`, `needs_review`, row count, and row order.
- Worker supplies only: `question`, `options`, and `correct_index` where the
  planner policy explicitly permits visible answer extraction.
- Answer-policy forcing per §1.5.
- If `question_assembly.mode` is `case_stem_plus_question_prompt`, code
  assembles the stem and the prompt into the row's `question` per §1.10. If it
  is `plain_question_prompt`, the product CSV contains no case labels added by
  code.

### 1.8 Bounding boxes and crops

Moved to [Docs/OUTPUT_CONTRACT.md §1.8](../../Docs/OUTPUT_CONTRACT.md) — the
convention binds the shared render/crop tier, which every workflow uses, not
Gold alone.

### 1.9 Chunking

- Default chunk size: 10 planned rows (configurable).
- Reduced blueprint per chunk (§1.3 step 5) — never the full row set.
- Failure handling per §1.3 step 5 (bisect, then degrade, since 2026-07-18).
- Known risk to guard: chunking can introduce cross-chunk row errors — the
  merge and final validation must catch these.

### 1.10 Case-stem assembly

For case-based questions, each row's `question` must be self-contained — the
final CSV must be directly usable with no sidecar file. Format (exact),
**changed 2026-07-15, owner-approved**:

```
<shared case stem transcribed from the PDF>

<individual question prompt text>
```

The original format carried explicit `Case stem:` / `Question:` labels; those
were dropped and a blank line separates the two parts. The printed case
identity inside the stem ("Case 10 …") is kept. The duplication of the stem
across the case's rows is intentional. Standalone rows carry only the
individual prompt text.

**Who assembles it also changed.** The worker returns `case_stem` and
`question` as two separate verbatim fields and **code** (`merge.ts`) strips
each part's printed number and fills the code-owned `final_format` — the
worker is the weakest model and must not own formatting. The planner still
decides the mode per row; code never adds case labels to plain rows. The
legacy labelled format is still accepted on blueprint input so pre-change
checkpoints resume unchanged.

### 1.11 Reference runtime parameters (starting values, not dogma)

| Parameter | Value |
|---|---|
| Planner / worker / audit timeout | 300 s (worker: per chunk) |
| Planner max output tokens | 65,536 |
| Worker max output tokens | 32,768 per chunk |
| Audit max output tokens | 32,768 |
| Worker chunk size | 10 rows default |
| Planner repair rounds | exactly 1 |

Render DPI (200) and temperature (0, all calls) are **shared** render policy —
OUTPUT_CONTRACT §1.11. Note that temperature 0 does **not** guarantee
identical behavior across runs; repeatability is something you measure, never
assume. Measured on a clean marked scan, two runs of the same 80-question
document disagreed on 4 answers — see ANSWER_LAYOUTS.md.

### 1.12 Engine-wide safety rules

- The worker is weaker and must not think structurally.
- The planner defines the plan; the worker fills it.
- The final CSV must be usable by itself (no sidecar files).
- Crops are deterministic products of planner boxes.
- No model in the engine path answers from subject knowledge.
- Wrong answers are worse than blank answers.
- If answer evidence is absent or uncertain, leave answers blank.
- Audit reports failures but never edits data.
- Never infer an audit pass when the audit is unavailable.
- Validation failures are investigated, never papered over; nothing is ever
  fabricated to make a count or a check pass.

---

## 2. Prompts

Gold's three big prompts live in [PROMPTS.md](PROMPTS.md) and `engine/prompts.ts`
is generated from it (`node scripts/sync-workflow-prompts.mjs Gold`).
Gold's other prompts — INDEX, EVIDENCE, FIGURE_DETECT, BOX, BOX_BATCH,
REFERENCE_RESOLVER, and the post-audit matching/solver/topic prompts — were
never generated and are edited directly in `engine/prompts.ts`.

## 3. Output contract

Moved to [Docs/OUTPUT_CONTRACT.md](../../Docs/OUTPUT_CONTRACT.md). It is what
earns every mineral one Review screen and one Export button, so it is not
Gold's to change.

## 4. Known blind spots (keep with the design)

Recorded with the original design and still worth watching. Where a later
measurement settled one, it says so; the measurement records live in
ANSWER_LAYOUTS.md and CLAUDE.md.

- Worker fidelity: planner constraints fix structure, not character-level
  vision. Two 2026-07-30 defects were exactly this — an entire chunk's answers
  dropped, and options truncated at a page break.
- The audit is the weakest model doing the hardest verification task; its
  accuracy — especially audit PASS on ground-truth FAIL — is measured, never
  assumed. It is also known to false-positive on options legitimately
  recovered from the next page.
- Planner bbox errors propagate into crops; the cropper never fixes them.
- Temperature 0 does not guarantee repeatability (~5% answer flakiness
  measured on a clean marked scan).
- Chunking can introduce cross-chunk row errors; validators must catch them.
- A wrong planner can corrupt a perfect worker; the audit is the only model
  backstop.
- **True/False questions remain untested** — the contract defines their shape
  (`options=["True","False"]`) but no corpus document contains one.
- **A real separate answer-key document has never been verified end-to-end**
  (ANSWER_LAYOUTS.md, *Still uncovered*).
