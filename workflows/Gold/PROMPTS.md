# Gold — the pinned prompts

These three prompts belong to the **Gold** workflow and to nothing else. A
different mineral has its own steps and its own prompts; it does not inherit
these, and it does not need to keep three of them.

This file is the SOURCE; `engine/prompts.ts` is GENERATED from it.

**To edit a prompt: change the block here, then run
`node scripts/sync-workflow-prompts.mjs Gold`.** That is the whole procedure.
Record what changed and why in CLAUDE.md, and judge it on a benchmark run over
real documents — that is what tells you an edit was good.

`engine/prompts.test.ts` guards exactly one thing: that the generator was
actually run. It re-reads this file and requires each block to equal its
constant byte-for-byte, so "edited the doc, forgot to regenerate" fails loudly
instead of silently shipping the old prompt. It also spot-checks two details a
retyped prompt tends to lose (the literal backslash-n in `final_format`, and the
image-discovery clauses).

SHA-256 pins lived here until 2026-08-02. They were removed: they only restated
what the byte-equality check already proves, while making every prompt edit a
three-place ritual. A checksum never told anyone whether a prompt was *better*.

Gold's other prompts — INDEX, EVIDENCE, FIGURE DETECT, BOX, BOX_BATCH,
REFERENCE_RESOLVER, and the post-audit matching / solver / topic prompts — are
**not** pinned and are edited directly in `engine/prompts.ts`.

Historical note: these blocks were migrated as-is from the former `Docs/CODOX_MIGRATION.md`
§2, which remains the record of where the engine's semantics came from. They
moved here on 2026-08-02 when workflows became separable; the text did not
change in the move (the pinned hashes were identical before and after). The
§2.1/2.2/2.3 subheadings are kept deliberately — about fifteen code comments
cite "§2.2" to mean "the worker prompt", and renumbering would strand them.

---


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
      "linked_row_ids": ["1"],
      "anchor": "short visible cue near the figure"
    }
  ],
  "planned_rows": [
    {
      "id": "1",
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
    "may_change_image_assignments": false,
    "may_change_answer_policy": false,
    "may_flag_planner_disagreement": false
  }
}

Rules:
- Emit one planned row per visible question in reading order.
- Use printed question IDs where visible. If unnumbered, assign sequential IDs
  as strings in reading order.
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

When the policy does point to visible answer evidence, the answer is marked on
the page for that row. Find it and fill correct_index. Look for a mark on one
option -- a tick, check, circle, strike, underline, highlight, or bold text --
or the answer letter written beside the question, in an answer column, an
answer cell, or the margin next to it. Read that mark and return its 0-based
index into that row's own options. Do this for every row in the chunk, not only
the first few; each row has its own answer to read. Leave correct_index empty
only when the mark genuinely cannot be read.

Output:
{
  "rows": [
    {
      "id": "1",
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
- Copy planner-owned fields exactly as provided: id, topic, subtopic,
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
