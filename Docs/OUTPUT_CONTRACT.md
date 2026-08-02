# The shared output contract

_What every conversion workflow must produce, and the coordinate rule the
shared render tier enforces. This is **not** any one workflow's to change: it
is what earns every mineral ONE Review screen and ONE "Export to Triviadox"
instead of a fork per workflow._

_Gold's own pipeline semantics are [workflows/Gold/ENGINE.md](../workflows/Gold/ENGINE.md).
The tier boundaries — what is workflow-owned, what is shared plumbing, what is
this contract — are in [workflows/README.md](../workflows/README.md) and
CLAUDE.md._

Section numbers are preserved from the original `CODOX_MIGRATION.md`, because
code comments cite them.

---

## What a workflow must write

Wider than the CSV, deliberately:

- **`ExamQuestion[]`** into the `merged-rows` artifact. Review renders these,
  and `exporter.ts` re-projects export columns from them — export never reads
  the `csv` artifact, so a CSV-only contract would leave Review nothing to
  show.
- **`crop` records** for anything a row names in `image_urls`.
- **`page-jpeg`** for Review's source view.

A workflow's own intermediate checkpoints are private. Gold's
(`blueprint-raw`, `index-window`, `index-reconcile`, `figure-window`,
`chunk-request`, `chunk-response`) are read by nothing outside Gold, and
`backup.ts` archives every shared kind and none of them.

## §1.8 Bounding boxes and crops

- Convention: `[ymin, xmin, ymax, xmax]`, normalized **0–1000**, relative to
  the **exact rendered page image** the model saw. This is the #1 place a
  pipeline breaks: render each page once at a fixed scale, send those exact
  images to the models, and map boxes back onto those same rasters. Never
  re-render at a different scale between planning and cropping.
- The model owns all boxes; code crops them; **the cropper never adjusts
  them.** If the box is wrong, the crop is wrong and validation must catch it.
- A worker receives both full page images (for transcription) and the crops
  (as focused visual reference and as the final `image_urls` assets).

## §1.11 Shared runtime parameters

| Parameter | Value |
|---|---|
| Render DPI | 200 (the pinned reference scale) |
| Temperature | 0, all calls |

A workflow declares its own render policy (`dpi`, `reinitEvery`) in
`workflow.ts`; the shared rasteriser applies it. Per-role timeouts, token
ceilings, and chunk sizes are the workflow's, not this contract's.

Temperature 0 does **not** guarantee identical behavior across runs.
Repeatability is measured, never assumed.

---

## §3 The Triviadox output contract

The product is a CSV Triviadox imports. "Correct output" is defined here. The
Triviadox schema is ours to change and these decisions are already resolved
with the import side — do not re-negotiate them.

### §3.1 Schema

Core 8 columns, in this exact order:

```
id,topic,subtopic,year,question,options,correct_index,image_urls
```

(`group_id` was the 2nd column until 2026-08-02, when the grouping concept was
removed as a derived label nothing read — see CLAUDE.md's Workflows section.)

The engine emits a 9th column, `needs_review`, carrying the flag *reason*
(e.g. `no_answer_key`, `no_visible_answer`, `key_unclear`, `mark_illegible`,
`conflicting_marks`, `index_out_of_range`, `options_cut_at_page_break`), blank
when clean. This is legal because the importer ignores unknown extra columns; a
blank `correct_index` remains the hard review signal, the column only explains
it. This 9-column form is `CSV_SCHEMA`, the single source for both a
workflow's blueprint handshake and the in-run `csv` artifact.

**Exported projection (owner-approved 2026-07-14).** The 9-column list above is
the *internal* working format. The CSV that leaves the device in an export
bundle is a *projection* of it (`src/export/export-csv.ts`):

- `id` is never exported (internal keying only).
- `topic`, `subtopic`, `year` are conditional columns, omitted entirely
  (header included) when not provided. `topic`/`subtopic` appear only when
  the user supplied a topic list for the run, and their values come from
  export-time AI matching against that list — blank when unsure, never
  planner heading text. `year` appears per the run's year mode: the
  user-typed value, or the document-evidence value, or not at all.
- The always-present columns keep this exact relative order:
  `question,options,correct_index,image_urls,needs_review`.

### §3.2 Parsing contract (exact)

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

### §3.3 Semantics

- **`id`** — unique per PDF / per import, never globally; it links rows
  within one upload. Batch imports namespace per file. *Since 2026-07-14
  internal only:* it still keys review resolutions, AI answers, and topic
  matches inside Codox, but is no longer emitted in exported CSVs.
- **`group_id`** — *removed 2026-08-02.* It marked questions sharing an image
  or case stem, was internal-only from 2026-07-14, and was ultimately a derived
  label no consumer read. Rows that share a figure still do so through
  `image_urls`; a case stem still reaches the question text through
  `question_assembly`. Nothing downstream needed the grouping key itself.
- **Blank `correct_index` = needs review** — the single most important
  semantic. The row lands in a review queue / editable draft; it is never
  dropped and never defaulted.
- **`image_urls` are relative paths** into the bundle's `images/` folder
  (e.g. `images/q14_lichen-planus.png`), human-readable filenames, resolved
  relative to the CSV's location at import time; the importer reads the local
  files and re-hosts them (confirmed with the Triviadox side 2026-07-03).
  Missing files are flagged gracefully, never a whole-import crash.
- **`topic`/`subtopic`** — subject-agnostic free text, displayed as-is,
  never mapped to a hardcoded taxonomy. *Exported* values come only from
  the user's topic list via AI matching (§3.1 projection), blank when
  unsure. `year` optional; blank is normal.
- **True/False questions** — `options=["True","False"]` with a normal 0-based
  `correct_index`. No dedicated question-type column. (Pinned 2026-07-03.)
  Still untested — no corpus document contains one.
- The old 5-column schema (`question,options,correct_index,year,image_url`)
  is dead — hard-cut to the 9-column header; nothing emits the legacy shape.

### §3.4 The bundle

Output is a **bundle, not a bare file**: `<pdf-name> Cx/` holding a matching
`<pdf-name> Cx.csv` + a sibling `images/` folder, one bundle per PDF. The
bundle must survive being moved (hence relative paths). Delivery: zip
(universal) or direct folder write where the platform supports it. Variant
exports (without answers, with AI answers) suffix the **zip name only** —
bundle folder and CSV names stay contract-exact.

### §3.5 Definition of "perfectly compatible"

A CSV that satisfies this contract imports into Triviadox with every question,
option, answer, and image preserved, and every blank `correct_index` surfaced
for review — no row dropped, no answer defaulted, no JSON cell mangled. This
column contract *is* the integration contract: keep it and compatibility holds
by construction.
