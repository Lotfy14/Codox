# Codox — Migrate-As-Is Artifacts

_Audience: AI agents working in the new Codox repository. This file carries
the artifacts that migrate from CodoxSandbox **unchanged in meaning**: the
Planner-Worker-Audit engine (steps and semantics, no code), its three prompts
(verbatim), and the Triviadox output contract. Extracted 2026-07-08 from
`docs/LLM_ONLY_PIPELINE_TEST_2026-07-08.md`,
`docs/PLANNER_WORKER_PIPELINE_TEST.md`, and
`docs/TRIVIADOX_COMPATIBILITY.md` in CodoxSandbox._

_Companion file: [CODOX_CONTEXT.md](CODOX_CONTEXT.md) — the product context and
prior decisions. That file describes; this file prescribes._

## 0. Scope and authority

- **§1 (engine semantics) and §3 (output contract) migrate as binding
  design.** Reimplement them in any language; do not change their meaning
  without explicit human approval.
- **§2 (prompts) migrate byte-for-byte.** Do not tune them per document, per
  provider, or "for clarity." They were deliberately written to run
  identically across every document with zero per-document hints; any edit
  invalidates comparability with the archived CodoxSandbox results.
- Model *names* in §1.2 are the intended assignments at time of writing, not
  contract — quota, availability, and provider choice may change them. The
  **role split** (strong planner / weak worker / deterministic code / read-only
  audit) is the contract.
- Nothing here includes the test harness. Scoring, gold CSVs, and the
  execution protocol stay in CodoxSandbox (see §5).

---

## 1. The engine — Planner-Worker-Audit pipeline

### 1.1 The four roles

The engine separates thinking, transcribing, enforcing, and checking:

- **Planner (strong model, brain):** analyzes rendered page images and emits a
  structured JSON **blueprint** — document profile, answer policy, one planned
  row slot per question, grouping/case structure, image bounding boxes,
  text-region anchors, and worker constraints. It does **not** produce the
  final CSV and does not fully transcribe questions.
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

Core principle enforced at every layer: **wrong answers are worse than blank
answers.** No model may answer from subject knowledge. If answer evidence is
absent or uncertain, answers stay blank and flagged.

### 1.2 Intended model assignments (as of 2026-07-08)

| Role | Intended model | Note |
|---|---|---|
| Planner | `gemini-3.5-flash` | no lower-quality fallback; an invalid blueprint gets one repair attempt with the same model |
| Worker | `gemini-3.1-flash-lite` | matches the audit model; each chunk still receives its own worker request and reduced blueprint |
| Audit | `gemini-3.1-flash-lite` | deliberately the weakest model doing the hardest verification job; its accuracy is a *measured output*, never an assumption |

> **Superseded — per-role selection (owner-approved 2026-07-22).** The table
> above is historical intent, not the live assignment. Each role now defaults to
> `gemini-3.5-flash-lite` and the tutor may override its **primary** in
> Customize → Advanced from the two selectable models
> (`gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`); the model not picked is
> that role's runtime fallback under the **same one key**. Planner covers
> INDEX/EVIDENCE/FIGURE/BOX (one shared model). The engine never swaps a role's
> model mid-run; the one paired-fallback swap lives in the controller. See
> CLAUDE.md "Per-role model selection" for the binding rule.

### 1.3 Step sequence (each step writes its inputs and outputs to disk before the next step starts)

1. **Render pages.** Rasterize every PDF page to a fixed-scale image (reference:
   200 DPI). All model calls use *these exact images* — bounding boxes are
   only meaningful relative to them. Gate: every page renders non-empty.
   Failure → stop (`render_failed`).
2. **Planner call.** All rendered pages + the planner prompt (§2.1). Output:
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
   those rows' regions reference, the referenced crops, and the worker prompt
   (§2.2). Record per chunk exactly what was sent, so every call is
   reconstructable. Gate per chunk: valid JSON; a `rows` array; exactly the
   requested row IDs, no additions/removals/reordering; no changed
   planner-owned field values. Failure → retry the same chunk once with the
   validation error appended; still failing → stop (`worker_chunk_invalid`).
   Chunking is mandatory — long exams do not fit one worker response.
6. **Deterministic merge.** Code merges worker rows into planner row
   skeletons under the ownership rules of §1.4/§1.7. Gate: merged rows match
   blueprint row IDs and obey answer policy. Failure → stop
   (`merge_validation_failed`).
7. **Final validation and export.** Gate: CSV columns exactly match the
   contract column list (§3); required text fields non-empty unless the row is
   explicitly flagged; options present for MCQ rows; `correct_index` blank or
   a valid 0-based index into that row's options; every `image_urls` path
   exists; every referenced crop was produced. Failure → still write the CSV
   when possible, but mark the run `not_safe_to_import`. Validation failures
   are never sent back to the worker to "fix."
8. **Audit call (read-only).** Rendered pages + validated blueprint + crops +
   merged rows + the audit prompt (§2.3). Gate: audit JSON parses and contains
   `audit_pass`, `failed_rows`, `global_failures`, `risk_class`. If the audit
   call itself fails → mark `audit_unavailable`; **never infer a pass.** An
   audit fail does not block export: the CSV and the audit report both ship,
   with run status **not safe to import** and the report explaining why. The
   audit is a gate, not a fixer.

Post-pipeline, deterministic normalization owned by code (not by any model):
strip leading enumeration labels ("A.", "b)") from option text — the worker
transcribes labels verbatim (§2.2) precisely so that the *code*, not the
weakest model, decides what is a label.

Operational note (quota): distinguish per-minute rate limits (recoverable —
wait the server-provided retry delay and continue) from per-day quota
exhaustion (not recoverable — fail distinctly and stop rather than burning
retries). Pace calls by the provider's published per-minute limits.

### 1.4 Field ownership (who may write what)

| Field | Owner | Notes |
|---|---|---|
| `id` | Planner/code | printed question number, or sequential strings in reading order if unnumbered |
| `group_id` | Planner/code | stable case/group assignment; worker cannot change it |
| `topic` | Planner/code | from visible document headings only, else blank |
| `subtopic` | Planner/code | same |
| `year` | Planner/code | from visible document evidence only |
| `question` | Worker fills, code formats if needed | must include shared case context when applicable (§1.10) |
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
- `csv_schema` equals exactly:
  `["id","group_id","topic","subtopic","year","question","options","correct_index","image_urls","needs_review"]`
- `planned_rows` count equals `document_profile.question_count`.
- Row IDs are unique; row order is deterministic.
- Group IDs are non-empty and stable.
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

- Planner/code wins for: `id`, `group_id`, `topic`, `subtopic`, `year`,
  `image_urls`, `needs_review`, row count, and row order.
- Worker supplies only: `question`, `options`, and `correct_index` where the
  planner policy explicitly permits visible answer extraction.
- Answer-policy forcing per §1.5.
- If `question_assembly.mode` is `case_stem_plus_question_prompt`, the product
  CSV keeps the `Case stem:` / `Question:` labels. If it is
  `plain_question_prompt`, the product CSV contains no case labels added by
  code.

### 1.8 Bounding boxes and crops

- Convention: `[ymin, xmin, ymax, xmax]`, normalized **0–1000**, relative to
  the **exact rendered page image** the planner saw. This is the #1 place the
  pipeline breaks: render each page once at a fixed scale, send those exact
  images to the models, and map boxes back onto those same rasters. Never
  re-render at a different scale between planning and cropping.
- The planner owns all boxes; code crops them; the cropper never adjusts them.
- The worker receives both full page images (for transcription) and the crops
  (as focused visual reference and as the final `image_urls` assets).

### 1.9 Chunking

- Default chunk size: 10 planned rows (configurable).
- Reduced blueprint per chunk (§1.3 step 5) — never the full row set.
- One retry per failed chunk, with the validation error included.
- Known risk to guard: chunking can introduce cross-chunk row or grouping
  errors — the merge and final validation must catch these.

### 1.10 Case-stem assembly

For grouped/case-based questions, each row's `question` must be
self-contained — the final CSV must be directly usable with no sidecar group
file. Format (exact):

```
Case stem: <shared case stem transcribed from the PDF>
Question: <individual question prompt text>
```

The duplication of the stem across the group's rows is intentional.
Standalone rows carry only the individual prompt text. The planner decides the
mode per row; the worker assembles exactly per mode; code never adds case
labels to plain rows.

### 1.11 Reference runtime parameters (starting values, not dogma)

| Parameter | Value |
|---|---|
| Render DPI | 200 |
| Temperature | 0 (all calls) |
| Planner / worker / audit timeout | 300 s (worker: per chunk) |
| Planner max output tokens | 65,536 |
| Worker max output tokens | 32,768 per chunk |
| Audit max output tokens | 32,768 |
| Worker chunk size | 10 rows default |
| Planner repair rounds | exactly 1 |
| Worker chunk retries | exactly 1 |

Note: temperature 0 does **not** guarantee identical behavior across runs —
repeatability is something you measure (CodoxSandbox does, across 3 runs per
document), never assume.

### 1.12 Engine-wide safety rules

- The worker is weaker and must not think structurally.
- The planner defines the plan; the worker fills it.
- The final CSV must be usable by itself (no sidecar files).
- Crops are deterministic products of planner boxes.
- No model may answer from subject knowledge.
- Wrong answers are worse than blank answers.
- If answer evidence is absent or uncertain, leave answers blank.
- Audit reports failures but never edits data.
- Never infer an audit pass when the audit is unavailable.
- Validation failures are investigated, never papered over; nothing is ever
  fabricated to make a count or a check pass.

---

## 2. The prompts (verbatim — do not edit, do not tune per document)

Usage notes that travel with them:

- All three run at temperature 0, JSON-only responses.
- **Planner:** send the prompt text, then append all rendered page images.
- **Worker:** send the prompt text, then append the chunk package JSON, the
  referenced page images, and the referenced crop images. Same prompt for
  every chunk.
- **Audit:** send the prompt text, then append rendered pages, validated
  blueprint, crops, and merged rows.
- No document-specific facts, counts, mark-type hints, or grouping hints are
  ever added. The planner must discover everything from the pages, every run.

### 2.1 Planner prompt

```text
You are the PLANNER for an exam-to-CSV pipeline.

Return ONLY valid JSON. No markdown, no commentary.

You analyze the rendered page images and produce a blueprint. You do not create
the final CSV. You do not fully transcribe every question. You identify the
document structure, row slots, answer policy, text regions, image regions, and
worker constraints.

No document-specific facts are provided. Discover everything from the visible
pages. Do not assume question counts, grouping, answer style, image placement,
or subject matter. Do not use medical or subject knowledge to answer questions.

Output this top-level JSON shape:
{
  "csv_schema": [
    "id",
    "group_id",
    "topic",
    "subtopic",
    "year",
    "question",
    "options",
    "correct_index",
    "image_urls",
    "needs_review"
  ],
  "document_profile": {
    "page_count": 0,
    "question_count": 0,
    "group_count": 0,
    "question_pages": [],
    "answer_policy": {
      "type": "no_answer_key",
      "answer_key_present": false,
      "marking_style": "none",
      "worker_rule": "leave correct_index blank and set needs_review=no_answer_key"
    }
  },
  "assets": [
    {
      "asset_id": "asset01",
      "kind": "case_image",
      "page": 1,
      "box_2d": [0, 0, 100, 100],
      "output_path": "images/asset01.png",
      "linked_group_id": "group01",
      "linked_row_ids": ["1"],
      "anchor": "short visible cue near the figure"
    }
  ],
  "planned_rows": [
    {
      "id": "1",
      "group_id": "group01",
      "topic": "",
      "subtopic": "",
      "year": "",
      "question_assembly": {
        "mode": "plain_question_prompt",
        "final_format": "{question_prompt}"
      },
      "regions": {
        "case_stem": null,
        "question_prompt": {
          "page": 1,
          "box_2d": [0, 0, 100, 100],
          "anchor": "short beginning of prompt"
        },
        "options": {
          "page": 1,
          "box_2d": [0, 0, 100, 100],
          "anchor": "first visible option"
        },
        "answer_evidence": null
      },
      "image_urls": [],
      "correct_index_policy": {
        "type": "blank_no_answer_key",
        "value": "",
        "needs_review": "no_answer_key"
      },
      "worker_task": {
        "case_stem_required": false,
        "read_regions_only": false,
        "must_follow_planner_structure": true
      }
    }
  ],
  "worker_constraints": {
    "may_add_rows": false,
    "may_remove_rows": false,
    "may_change_grouping": false,
    "may_change_image_assignments": false,
    "may_change_answer_policy": false,
    "may_flag_planner_disagreement": false
  }
}

Rules:
- Emit one planned row per visible question in reading order.
- Use printed question IDs where visible. If unnumbered, assign sequential IDs
  as strings in reading order.
- A group is a real shared case stem, shared figure, or other visible shared
  context. Standalone questions may use one stable group per row.
- Set question_assembly.mode to "case_stem_plus_question_prompt" only when a
  row depends on a visible shared case stem. In that mode, set final_format to
  "Case stem: {case_stem}\nQuestion: {question_prompt}" and provide a non-null
  case_stem region.
- Set question_assembly.mode to "plain_question_prompt" for standalone rows.
  In that mode, set final_format to "{question_prompt}" and do not require a
  case stem.
- box_2d is [ymin, xmin, ymax, xmax], normalized 0-1000 relative to the exact
  page image.
- Before returning the blueprint, inspect every page specifically for visual
  material that belongs to a question: clinical photographs, radiographs,
  scans, diagrams, charts, maps, specimens, microscopy, and multi-panel
  figures. If such a visual is needed to understand or answer one or more
  questions, it MUST appear once in assets and its output_path MUST appear in
  every linked row's image_urls. Shared visuals use one asset linked to all
  dependent rows.
- Do not create assets for logos, watermarks, decorative graphics, page
  furniture, answer marks, or ordinary text-only question boxes.
- For every asset, re-check the page and draw box_2d tightly around the visual
  itself, with a small margin so meaningful edges, labels, legends, arrows, and
  panels are not cut off. Exclude surrounding question text, options, headers,
  footers, page numbers, and unrelated neighboring visuals. Never reuse a
  question_prompt or options box as an image asset box.
- Verify every asset's page, box_2d, linked_row_ids, and row image_urls before
  returning JSON. If the PDF has no question-linked visuals, return assets: []
  and keep every row's image_urls empty.
- Anchors must be short visible cues only, not full row transcriptions.
- Answer policy is document evidence only. Allowed types are no_answer_key,
  separate_key, inline_marks, mixed, and uncertain.
- When answer evidence exists (separate_key, inline_marks, or mixed), provide a
  non-null answer_evidence region for every affected row: the key region that
  contains that row's printed answer, or the mark region on the question
  itself. A row with answer policy pointing at evidence but a null
  answer_evidence region is invalid.
- Sometimes the answer-marking form you identified (a highlight, a tick, a
  circle) is used on more than one option within a single question. Ignore
  incidental student scribbles or stray pencil marks -- those are noise. But
  when the actual answer mark itself appears on two or more options for the same
  question, the answer is genuinely ambiguous: do not answer it with confidence.
  Leave that row's answer blank and flag it (set needs_review) so a human can
  decide. A single clear answer mark is the answer; the answer form used more
  than once is a flag for review, not a guess.
- If answer evidence is absent or uncertain, choose a blank-answer policy.
- Never derive answers from subject knowledge.
- Do not include facts that are not visible in the page images.
```

### 2.2 Worker prompt

*Worker output split + code-owned assembly (owner-approved 2026-07-15):* the
worker no longer assembles the `question` string. It transcribes the shared
case stem and the individual prompt into two separate verbatim fields
(`case_stem`, `question`); deterministic code strips the printed
question/stem numbers and assembles the final text. This moves formatting off
the weakest model and onto code (per CLAUDE.md "code owns all formatting"), and
lets the case format change without a prompt edit. The assembled format itself
changed from `Case stem: {case_stem}\nQuestion: {question_prompt}` to
`{case_stem}\n\n{question_prompt}` — the printed case identity in the stem text
(e.g. "Case 10 …") is kept, the `Case stem:`/`Question:` labels are dropped, and
a blank line separates the two. §1.10 / §2.1's `final_format` string and the
blueprint validation are updated to match; the legacy `Case stem:` format is
still accepted on input so pre-change checkpoints resume unchanged.

```text
You are the WORKER for an exam-to-CSV pipeline.

Return ONLY valid JSON. No markdown, no commentary.

You receive a validated planner blueprint and one chunk of planned rows. Fill
only those rows. You are a transcription worker, not a structural planner.

You must not add rows, remove rows, reorder rows, regroup rows, change image
assignments, change answer policy, or change planner-owned fields. If the
planner is wrong, still follow the planner structure. Do not flag planner
disagreement.

You must not answer from subject knowledge. correct_index may be filled only
when the planner's per-row policy explicitly points to visible answer evidence.
If the policy says no_answer_key, uncertain, or blank, leave correct_index empty
even if you think you know the answer.

Output:
{
  "rows": [
    {
      "id": "1",
      "group_id": "group01",
      "topic": "",
      "subtopic": "",
      "year": "",
      "case_stem": "",
      "question": "",
      "options": [],
      "correct_index": "",
      "image_urls": [],
      "needs_review": ""
    }
  ]
}

Rules:
- Emit exactly the requested row IDs in exactly the requested order.
- Copy planner-owned fields exactly as provided: id, group_id, topic, subtopic,
  year, image_urls.
- Transcribe visible question text and options. Do not summarize, paraphrase,
  improve grammar, or add missing medical facts.
- Do not include leading question numbers/labels (such as "26", "26.", "9)", etc.)
  or case prefixes (such as "Case 5", "Case 5:", etc.) at the start of the
  question text or case stem. Strip them so the transcribed question/stem begins
  directly with the actual text.
- Do not include leading option labels (such as "A.", "B.", "a.", "b.", "A ", "B ",
  etc.) at the start of options. Strip these letters/numbers and any following
  punctuation/spaces so only the option text itself is transcribed. However, if the
  option text consists ONLY of the label (e.g. it is just the letter "A" or "B"),
  transcribe it as "A", "B", etc., instead of leaving it empty.
- If a question depends on a linked figure that is an option table or comparison matrix (where the rows are labeled A, B, C, D, etc. and contain columns of values/answers), do not transcribe the cell contents of those rows as options. Instead, transcribe the options simply as "A", "B", "C", "D", etc.
- Preserve option order exactly.
- If a small local text span is illegible, write [unclear] only for that span.
- For case_stem_plus_question_prompt rows, transcribe the shared case stem
  into case_stem and the individual question prompt into question (stripping leading
  question/case numbers or identifiers from both). Do not merge the two, add
  "Case stem:" or "Question:" labels, or repeat the stem inside question.
- For plain_question_prompt rows, leave case_stem empty ("") and put only the
  individual prompt text (stripped of leading numbers/labels) in question.
- Exclude page furniture such as headers, footers, watermarks, page numbers, and
  general instructions unless the planner region explicitly includes them as
  part of a question.
- Return valid JSON even when some text is unclear.
```


### 2.3 Audit prompt

```text
You are the AUDIT model for an exam-to-CSV pipeline.

Return ONLY valid JSON. No markdown, no commentary.

You are read-only. Do not rewrite rows. Do not provide corrected CSV data. Check
whether the merged rows are safe to import when compared with the rendered page
images, the planner blueprint, and the crop images.

Output:
{
  "audit_pass": false,
  "risk_class": "not_safe_to_import",
  "failed_rows": [
    {
      "id": "1",
      "field": "options",
      "reason": "visible text does not match the row"
    }
  ],
  "global_failures": [],
  "answer_policy_violations": [],
  "crop_failures": [],
  "notes": []
}

Rules:
- Pass only if row count, row order, grouping, image assignments, question text,
  option text, and answer policy are consistent with the source evidence.
- Treat a confident wrong answer as dangerous.
- Treat a blank answer required by policy as safe.
- If answer evidence is absent or uncertain, any non-blank correct_index is a
  policy violation.
- Check crops only for whether the planned visual evidence is present in the
  crop. Do not adjust boxes.
- If you cannot verify a critical field, fail the audit.
- The only risk_class values are "safe_to_import" and "not_safe_to_import".
  Never report that you could not audit; if verification is impossible, emit
  "not_safe_to_import" with the reason in global_failures.
```

---

## 3. The Triviadox output contract (platform-independent, binding)

The engine's product is a CSV Triviadox imports. "Correct output" is defined
here. The Triviadox schema is ours to change and these decisions are already
resolved with the import side — do not re-negotiate them.

### 3.1 Schema

Core 9 columns, in this exact order:

```
id,group_id,topic,subtopic,year,question,options,correct_index,image_urls
```

The engine emits a 10th column, `needs_review`, carrying the flag *reason*
(e.g. `no_answer_key`, `no_visible_answer`, `key_unclear`, `mark_illegible`,
`conflicting_marks`, `index_out_of_range`, `possible_merge`), blank when
clean. This is legal because the importer ignores unknown extra columns; a
blank `correct_index` remains the hard review signal, the column only explains
it. (The Planner-Worker-Audit pipeline's working column list is the 10-column
form — §1.6.)

**Exported projection (owner-approved 2026-07-14).** The 10-column list above
remains the engine's internal working format — the blueprint `csv_schema`,
merged rows, the in-run `csv` artifact, and the CodoxSandbox gold gate are
unchanged. The CSV that leaves the device in an export bundle is a
*projection* of it (`src/export/export-csv.ts`):

- `id` and `group_id` are never exported (internal keying only).
- `topic`, `subtopic`, `year` are conditional columns, omitted entirely
  (header included) when not provided. `topic`/`subtopic` appear only when
  the user supplied a topic list for the run, and their values come from
  export-time AI matching against that list (`src/engine/topic-matcher.ts`)
  — blank when unsure, never planner heading text. `year` appears per the
  run's year mode: the user-typed value, or the planner's document-evidence
  value, or not at all.
- The always-present columns keep this exact relative order:
  `question,options,correct_index,image_urls,needs_review`.

### 3.2 Parsing contract (exact)

- **Encoding:** UTF-8, read BOM-tolerant. (Real exams contain medical terms
  and Arabic headers.)
- **Dialect:** RFC-4180 CSV. Fields containing commas/quotes are
  double-quoted; a literal `"` inside a field is doubled (`""`). Always a real
  CSV parser, never string-splitting.
- **`options`:** a JSON array stored as one CSV field. Decode the CSV field
  first, then JSON-parse the result.
- **`correct_index`:** integer, **0-based**, validated against the row's
  option count — or the empty string. Empty ⇒ review queue. Never rejected,
  never defaulted to 0 (a defaulted 0 is a silently wrong medical answer).
- **`image_urls`:** JSON array of strings, possibly empty `[]`.

### 3.3 Semantics

- **`id`** — unique per PDF / per import, never globally; it links rows
  within one upload. Batch imports namespace per file. *Since 2026-07-14
  internal only:* it still keys review resolutions, AI answers, and topic
  matches inside Codox, but is no longer emitted in exported CSVs.
- **`group_id`** — shared by related questions (same image or same case
  stem); blank = standalone. **Mis-grouping is worse than no grouping** — when
  unsure, leave blank for all candidates; the importer must treat blank as
  standalone and never invent a group. Grouped rows render together. *Since
  2026-07-14 internal only:* no longer emitted in exported CSVs.
- **Blank `correct_index` = needs review** — the single most important
  semantic. The row lands in a review queue / editable draft; it is never
  dropped and never defaulted.
- **`image_urls` are relative paths** into the bundle's `images/` folder
  (e.g. `images/q14_lichen-planus.png`), human-readable filenames, resolved
  relative to the CSV's location at import time; the importer reads the local
  files and re-hosts them (confirmed with the Triviadox side 2026-07-03).
  Missing files are flagged gracefully, never a whole-import crash.
- **`topic`/`subtopic`** — subject-agnostic free text, displayed as-is,
  never mapped to a hardcoded taxonomy. Internally the planner still fills
  these from the document's own headings; *exported* values come only from
  the user's topic list via AI matching (§3.1 projection), blank when
  unsure. `year` optional; blank is normal.
- **True/False questions** — `options=["True","False"]` with a normal 0-based
  `correct_index`. No dedicated question-type column. (Pinned 2026-07-03.)
- The old 5-column schema (`question,options,correct_index,year,image_url`)
  is dead — hard-cut to the 9-column header; nothing emits the legacy shape.

### 3.4 The bundle

Output is a **bundle, not a bare file**: `<pdf-name> Cx/` holding a matching
`<pdf-name> Cx.csv` + a sibling `images/` folder, one bundle per PDF. The
bundle must survive being moved (hence relative paths). Delivery: zip
(universal) or direct folder write where the platform supports it.

### 3.5 Definition of "perfectly compatible"

A CSV that passes the CodoxSandbox gold grader imports into Triviadox with
every question, option, answer, group, and image preserved, and every blank
`correct_index` surfaced for review — no row dropped, no answer defaulted, no
JSON cell mangled. The gold suite *is* the integration contract: keep it green
and compatibility holds by construction.

---

## 4. Evidence status and known blind spots (honesty section — keep with the design)

**Status as of 2026-07-08:** the Planner-Worker-Audit pipeline is a designed
and hardened specification, **not yet executed** as a full protocol run (the
4-PDF × 3-run matrix in CodoxSandbox has no results yet). What *is* measured,
from its direct precursor (two-model planner/worker runs on the hardest gold
input, a photo-of-screen dermatology exam, 2026-07-05):

- **Proven:** row-slot planning (20/20 rows), case grouping (10/10 groups
  matched the gold pairing), and vision-bbox → deterministic crops (10/10
  valid crops) all work on the worst input in the corpus.
- **Not yet solved, and the reason this design exists:** option-text
  transcription drift (dropped/substituted option strings) and one observed
  case of a model hallucinating that an answer key existed and filling
  answers — including one wrong answer. The §1.5 policy forcing, §1.7 merge
  ownership, and §2.3 audit gate were written specifically against those two
  failure modes; their effectiveness is what the pending protocol run
  measures.

Blind spots recorded with the design (watch these when reimplementing):

- Worker fidelity is unproven; planner constraints fix structure, not
  character-level vision.
- The audit is the weakest model doing the hardest verification task; its
  accuracy (especially the dangerous quadrant: audit PASS on ground-truth
  FAIL) is measured, never assumed.
- Planner bbox errors propagate into crops; the cropper never fixes them.
- Temperature 0 does not guarantee repeatability.
- Chunking can introduce cross-chunk row/grouping errors; validators must
  catch them.
- `may_flag_planner_disagreement: false` means a wrong planner can corrupt a
  perfect worker; the audit is the only model backstop.
- **True/False questions are an untested gap** — none of the four control
  PDFs contain T/F rows, though the contract (§3.3) defines their shape.

## 5. Deliberately NOT migrated (stays in CodoxSandbox)

- The gold suite (4 PDF↔gold pairs + manifest), degraded-input corpus, and
  all graders/eval tooling — the new repo's candidate CSVs are scored there.
- The execution protocol around the engine (run-directory layout, 3-runs-per-
  PDF matrix, repeatability fingerprints, safety/audit-accuracy tables,
  summary format) — that is test harness, not engine.
- The v1 Python engine (reference implementation / eval oracle) and its
  six-step profile→read→resolve→enrich→verify→emit design, superseded as the
  engine of record by §1 but kept there as history and oracle.
- All Python scripts, including page-render and crop implementations — the
  new repo reimplements §1 semantics in its own stack.
- Every earlier prompt generation (Phase 0 raw prompt, the Phase 0b staged
  9-stage single-call "Gemini-First Pipeline Prompt", the universal extraction
  prompt, the derm testing prompt) — superseded by §2 for the product; kept in
  CodoxSandbox as experiment records.
