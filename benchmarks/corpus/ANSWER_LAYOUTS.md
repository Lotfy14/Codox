# Answer layouts — what real exam documents do

Corpus metadata, shared by every workflow. This file records **how real exam
documents show their answers**, and which of those layouts are structurally
hard to read. These are facts about paper, not about any pipeline — a new
mineral inherits every one of them, so it inherits this list too.

What a *particular* workflow measured on these documents belongs with that
workflow. Gold's results are
[workflows/Gold/ANSWER_LAYOUTS.md](../../workflows/Gold/ANSWER_LAYOUTS.md).

**Look at the source before theorising about a model's output.** This repo has
been burned by exactly that — a day spent on a diagnosis that rendering one
page would have refuted.

```
node scripts/render-pdf-pages.mjs <file.pdf> <page> [page...]
```

Writes `scripts/out/page-N.png` using the same renderer the engine uses.

## Known layouts

| Source | Capture | How the answer is shown | Where it sits |
|--------|---------|-------------------------|---------------|
| Embryo Lecture (Dr. Noaman) | Native digital | Printed letter in a dedicated right-hand **table column** | beside |
| Family Medicine 2022/2023 | Photo of paper | Handwritten **strike** through the chosen option's letter | on-option |
| photo 01-57 | Photo of paper | Faint handwritten **tick/check** beside the chosen option | on-option |
| photo 02-00-43 | Photo of paper | Handwritten **answer letters in the red margin** | beside |
| photo 02-00-48 | Photo of paper | **Green highlighter** over the correct option text | on-option |
| EOR SUR MCQ 2026-195-1st [Answers] | Photo of paper | **Highlighter** over the correct option, sometimes with a competing pen circle on another option | on-option |
| EOR IM MCQ 2025-194-2nd (2) 1 | Photo of paper | Large **sideways red letters** down the right margin — see below | beside, unaligned |
| EOR IM MCQ 2025-194-2nd | Photo of paper | **Nothing** — the unanswered twin of the row above, an exact A/B | none |

## The axis that matters

Not typed-vs-handwritten, and not column-vs-highlighter. It is:

- **on-the-option** — a mark placed on a choice (tick, strike, circle,
  highlight, underline).
- **beside-the-question** — the answer written somewhere near the question but
  not on any option: a table column, an answer cell, the margin.

The second kind is the one that gets mislabelled "unanswered," because the
usual vocabulary for describing answer evidence has no slot for it — it is
neither a mark on an option nor a separate key document. A workflow that only
looks at the options will read a fully-answered exam as blank.

## Structurally hard layouts

Two document properties break extraction regardless of how good the model is.
Both are confirmed by rendering the pages.

### The unaligned margin column

`EOR IM MCQ 2025-194-2nd (2) 1.pdf` writes its answers as very large letters
rotated 90°, running down the right edge, one per question in reading order,
each about 1.5 question-heights tall.

- **Position does not attribute a letter to a question; order does.** The
  letters drift out of register — page 1's first `d` overlaps the printed text
  of BOTH Q1 and Q2, and by Q4 the column has slid clear of its own question.
  Only ordinal position (letter *n* ↔ question *n*) maps them.
- **A page's letter count is not its question count.** Page 1 shows 6
  questions but 5 letters, because Q6's options continue onto page 2 and so
  does its letter. The two counts disagreed on **4 of 8 pages**.

The consequence is not a model weakness: on a document laid out this way, "is
this question's answer visible?" is a question the page **cannot answer** for a
single question in isolation. Any per-question perceptual field will be wrong
here, at any prompt wording and any window size. Reading it correctly means
reading the whole column and mapping by order, which in turn means tracking
where each question's options *end*, not where it starts.

### Options split across a page break

`IM Final MCQ 6th 2025.pdf` — **every** page ends with a question whose options
continue at the top of the next page (Q41's "c) Erythropoietin, d) Hepcidin" is
literally the first line of page 8; Q11's "d- Rigidity" opens page 3).

This is dangerous rather than merely lossy: a question can come back looking
complete — 2 of 4 options, indistinguishable from a genuine True/False — while
carrying an answer index into an option list that no longer contains the right
answer. Detecting it needs geometry (the options are the last thing on a page
that has a page after it) **and** a count signal (fewer options than the
document's own modal count); either alone false-positives.

## Still uncovered

Do not claim a workflow generalises until these exist in the corpus:

- **A real separate answer-key document**, verified end to end. Every keyed run
  so far used an improvised or deliberately-unreadable key.
- **A True/False question.** The output contract defines their shape
  (`options=["True","False"]`) but no corpus document contains one.
