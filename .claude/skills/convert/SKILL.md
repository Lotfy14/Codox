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

### 2. One exam, or many?

A folder often prepares into several exam directories (`output/<folder>/<exam>/`).
Each exam is completely independent — its own pages, `exam.json`, images and
validation — so convert them **in parallel**.

- **One exam dir** — do it yourself, continue at step 3.
- **Two or more** — dispatch one `general-purpose` subagent per exam, **at most
  5 running at once**; queue the rest and start a new one as each finishes.

Give each subagent the exam directory only, and tell it to invoke the `convert`
skill on that single directory (`/convert agent-conversion/output/<folder>/<exam>`)
— it then follows steps 4–7 below for its own exam. Do not paste the procedure
into the prompt; the skill is the procedure. Never give two subagents the same
exam directory, and never let one touch a sibling's folder.

While they run, do nothing else in those folders. When all have returned,
re-run the validator on the **whole folder** yourself (step 6) — a subagent's
green run only proves its own exam — and write the step 7 report by combining
what each returned, per exam.

The rest of this procedure describes converting **one** exam directory.

### 3. Survey before extracting

Read `exam.json` for the page list, then **open the page images** — all of
them, in order. Do not start writing questions off page 1.

State to the user, in two or three lines, what you found:
- how many questions, and on which pages
- **where the answers live** (a mark on the options / a letter in a column or
  margin / separate key pages / nowhere) — QUALITY.md's table, this decides
  whether the exam exports at all
- any figures, and any non-MCQ formats (matching, true/false grids)

### 4. Extract, page by page

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

Give every question a **`box`** too: a rectangle around that question's whole
block — first line of text, its own diagram and option table, down to its last
option — and nothing of a neighbouring question, not its stem, options, or
figure. It is what Review shows beside the question, so the picture belongs
inside it; the separate figure crops are the close-up, not a substitute. Omit
the box only for a question you cannot bound (crosses a page break, interleaved
with another) and say so in NOTES.md; omitting it falls back to showing the
tutor the whole page.

### 5. Figures: crop, then LOOK

```
node scripts/agent-crop.mjs <exam-dir> <page> <ymin> <xmin> <ymax> <xmax> --out images/fig-01.jpg
```

Boxes are `[ymin, xmin, ymax, xmax]`, 0–1000, **y first**.

**One picture, one figure.** A question showing a diagram *and* an option table
gets two separate crops and two entries in `figures[]`, both ids listed on the
question in printed order. Never one crop spanning both — it swallows the
question text between them and halves the size of each picture in Review.

**Read the image file back every time.** Check for both failures:

- **Clipped** — a label, letter, or part of the diagram is cut off → widen.
- **Bleeding** — any part of the next question shows, even one trailing line of
  its stem → lower `ymax` until it is gone.

Bleeding is the one that slips through, because the figure itself is complete
and the crop looks fine. Re-crop and re-open after every adjustment. Only
reference a figure from `exam.json` once you have seen a good crop. This is the
step that makes an agent worth more than the built-in engine — never skip the
looking.

### 6. Validate until green

```
node scripts/agent-validate.mjs agent-conversion/output/<folder>
```

Fix every error. Read every warning and fix what is fixable. Re-run until it
reports zero errors.

### 7. Report

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
- **A crop that is "good enough" is not good.** A figure carrying a line of the
  next question, or a question with no `box`, ships a defect the tutor sees on
  every review. Re-crop it instead of accepting it.
