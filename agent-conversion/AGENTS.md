# Convert an exam into a Codox bundle

You are converting exam documents into a folder Codox can import. Work through
this file in order. It applies to any agent — Claude, GPT, Gemini — and needs
nothing beyond reading files, viewing images, and running `node`.

Read [FORMAT.md](FORMAT.md) for the exact `exam.json` contract and
[QUALITY.md](QUALITY.md) for how to read an exam page well. Both are short.

*In Claude Code, `/convert <folder>` runs this as a skill
(`.claude/skills/convert/`). It follows this same file — every other agent
gets the identical protocol by reading it here.*

## Why you are doing this by hand

Codox's built-in engine runs on the smallest Gemini models — the only ones a
free key can drive at volume. You are a much stronger model, and you can do
one thing the engine structurally cannot: **crop a figure, look at the crop,
and fix it**. Use that. It is the single biggest quality difference available
here.

## The five non-negotiables

1. **Transcribe, never paraphrase.** A question's text and its options are
   copied from the page as printed. Do not tidy grammar, expand abbreviations,
   translate, or reorder options. Strip only the printed numbering/lettering
   (`12.`, `A)`), because Codox adds its own.
2. **Never invent an answer.** Every answer carries a declared `source`.
   `extracted` means you SAW it on the page — you can say where. `reasoned`
   means you worked it out from knowledge, which is fine and safe: it does not
   fill the answer, it waits in Codox for the tutor to approve it. `none` means
   there is no answer. Guessing under the label `extracted` is the one thing
   that actually damages a tutor's exam.
3. **Never silently drop a question.** A question you cannot read still gets a
   row, with whatever you could read and a `flag`. A missing question is
   invisible; a flagged one gets fixed in thirty seconds.
4. **Look before you conclude.** Open the page images. Do not infer what a
   document contains from its filename, its text layer, or the shape of the
   other pages. (This repo has been burned by exactly that.)
5. **Finish the whole document.** Every question on every exam page, not the
   first twenty. If the document is long, work page by page and keep going.

## The loop

### 1. Prepare

```
node scripts/agent-prepare.mjs agent-conversion/input/<folder>
```

Renders every page at the same 200 DPI Codox uses, copies each PDF, and writes
an `exam.json` skeleton per exam under `agent-conversion/output/<folder>/`.
Answer-key pages are appended after the exam's pages and marked
`"role": "answer-key"`.

### 2. Look at every page

Open `pages/page-001.jpg`, `page-002.jpg`, … in order. Before writing anything,
answer for yourself:

- How many questions are on each page, and where does the numbering restart?
- **Where do the answers live?** On the options (a tick, a strike, a
  highlight)? In a column or margin beside the question? On separate key
  pages? Nowhere at all? See QUALITY.md — this is the question most often got
  wrong, and getting it wrong blanks the whole exam.
- Which questions have figures, and does a figure belong to one question or to
  a shared stem?
- Is there anything that is not a plain multiple-choice question (matching
  questions, extended-matching stems, true/false grids)?

### 3. Write the questions

Fill `questions[]` in `exam.json`, in document order. Per question: the text,
the options verbatim, the answer with its `source`, the 1-based `page` it sits
on, and its `topic`/`subtopic`/`year` if the document states them.

`box` is optional. Give one when you can — it is the crop the tutor sees beside
the question while reviewing — but the whole page is used when you omit it, and
a whole page is far better than a wrong box.

### 4. Crop each figure, then LOOK at it

```
node scripts/agent-crop.mjs <exam-dir> <page> <ymin> <xmin> <ymax> <xmax> --out images/fig-01.jpg
```

Boxes are `[ymin, xmin, ymax, xmax]`, normalized 0–1000 against the rendered
page. **y comes first** — swapping x and y produces a wrong crop that looks
plausible.

**Open the file the script wrote.** Is the whole figure inside it, with its
label and any lettering, and nothing from the neighbouring question? If not,
widen the box and run it again. Repeat until it is right. Only then add it to
`figures[]` and reference its `id` from the question.

This step is why an agent is worth the effort. Do not skip the looking.

### 5. Validate until green

```
node scripts/agent-validate.mjs agent-conversion/output/<folder>
```

Errors mean the exam will not import — fix them. Warnings mean it will import
with those questions flagged for the tutor; read them and fix what you can.
This runs the exact validator the app runs, so green here means green there.

### 6. Write NOTES.md

A short report in the exam's folder: what the document was, where the answers
came from, anything you were unsure about, and anything you left for the tutor.
Codox stores it with the import so the tutor can read what you did.

## Then the tutor imports it

In Codox → **Folders** → **Import agent folder**, they pick
`agent-conversion/output/<folder>`. Every question, picture, and answer you
produced lands in the normal Review screen. Your `reasoned` answers appear as
AI suggestions for them to approve one by one or in bulk.
