---
name: convert
description: "Convert exam PDFs into a Codox-importable bundle. Renders every page, extracts every question, option, answer and figure into exam.json, crops and visually verifies each picture, and validates the result. Use when asked to convert an exam, process a folder in agent-conversion/input, or produce a bundle for Codox's Folders import."
---

# Convert an exam into a Codox bundle

Runs the agent-conversion workflow end to end. The full protocol is
[agent-conversion/AGENTS.md](../../../agent-conversion/AGENTS.md), the contract
is [FORMAT.md](../../../agent-conversion/FORMAT.md), and the extraction rules
are [QUALITY.md](../../../agent-conversion/QUALITY.md) — **read all three
before starting**; this file is the operating procedure, not a replacement.

## Argument

`/convert <folder>` — a folder under `agent-conversion/input/`, or a path to
one, or a bundle already prepared under `agent-conversion/output/`.

With no argument: list what is in `agent-conversion/input/` and
`agent-conversion/output/`, then ask which to convert. Never guess.

## Procedure

### 1. Prepare (skip if the bundle already exists)

```
node scripts/agent-prepare.mjs agent-conversion/input/<folder>
```

Renders every page at 200 DPI into `agent-conversion/output/<folder>/<exam>/pages/`
and scaffolds `exam.json`. If the output folder already has `pages/`, do not
re-run it — pick up where the bundle stands.

### 2. Survey before extracting

Read `exam.json` for the page list, then **open the page images** — all of
them, in order. Do not start writing questions off page 1.

State to the user, in two or three lines, what you found:
- how many questions, and on which pages
- **where the answers live** (a mark on the options / a letter in a column or
  margin / separate key pages / nowhere) — QUALITY.md's table, this decides
  whether the exam exports at all
- any figures, and any non-MCQ formats (matching, true/false grids)

### 3. Extract, page by page

Work in page order and write `questions[]` incrementally — do not hold a
100-question document in your head and write it at the end.

For every question: text and options **verbatim** with the printed numbering
stripped, the 1-based `page`, and an `answer` whose `source` is honest:

When the document prints no option list — the choices are rows of a table
("Which row is correct?") or lettered items in a drawing — emit
`["A","B","C","D"]` and crop the table or drawing as the figure. Never flatten a
table's rows into option text; see QUALITY.md.

- `extracted` — you saw it, and `evidence` says where
- `reasoned` — you worked it out; safe, the tutor approves it in Codox
- `none` — absent, conflicting, or illegible

Never invent an `extracted` answer. Never skip a question you cannot read —
emit it with a `flag`.

### 4. Figures: crop, then LOOK

```
node scripts/agent-crop.mjs <exam-dir> <page> <ymin> <xmin> <ymax> <xmax> --out images/fig-01.jpg
```

Boxes are `[ymin, xmin, ymax, xmax]`, 0–1000, **y first**.

**Read the image file back every time.** Check the whole figure is inside it,
with its label and lettering, and nothing from the next question. If it is
clipped, widen and re-crop. Only reference a figure from `exam.json` once you
have seen a good crop. This is the step that makes an agent worth more than
the built-in engine — never skip the looking.

### 5. Validate until green

```
node scripts/agent-validate.mjs agent-conversion/output/<folder>
```

Fix every error. Read every warning and fix what is fixable. Re-run until it
reports zero errors.

### 6. Report

Write `NOTES.md` in each exam folder: what the document was, where answers came
from, what you were unsure about, what you left for the tutor. Codox stores it
with the import.

Then tell the user, briefly:
- questions extracted, answers read from the document, answers reasoned
  (awaiting their approval), questions flagged
- anything you could not resolve
- that they import it via **Codox → Folders → Import agent folder**, picking
  `agent-conversion/output/<folder>`

## Rules that override convenience

- **Finish the whole document.** Every question on every exam page. If it is
  long, keep going — a partial bundle is worse than a slow one.
- **Transcribe, never paraphrase.** No tidying, translating, or reordering.
- **Never fabricate an answer.** `reasoned` exists precisely so you never have
  to; it costs the tutor one click and costs nothing if you are wrong.
- **Look at the pages and the crops.** Do not reason about a document from its
  filename, its text layer, or the shape of its other pages.
