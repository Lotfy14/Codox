# Answer-layout corpus

Real exam documents vary in HOW the correct answer is shown. INDEX makes ONE
perceptual call per question — `answer_present` (boolean, owner-approved
2026-07-21) — "is exactly one answer clearly indicated on this question's own
page?" It does NOT classify how the answer is shown (no inline / column /
margin taxonomy); a present answer is simply read off the page.

The pipeline (on-page), **changed 2026-07-30**:

- Every on-page row permits extraction. The **worker reads the answer off the
  full page** into `correct_index`; the answer is NEVER read from a BOX region.
  A worker that finds no mark leaves it blank → `no_visible_answer` → review.
- `answer_present` is an **observation, not a gate**. It was measured
  unreliable in exactly the layout it was meant to catch: on a document with a
  correct handwritten letter beside every question it returned `false` for 49
  of 50, while the same model on ONE page at a time returned true for every
  question. It is still parsed and checkpointed, and still acts as a positive
  signal for `keepIndexObservedMarks`, but it can no longer blank a row.
- A document with no marks anywhere still ends all-blank and all-flagged —
  because the worker reads no mark, not because INDEX predicted there was none.

**BOX is display-only.** It bounds the question and options for the Review
crop; it is never asked to box the answer, and the Review crop deliberately
excludes `answer_evidence` so the question preview never reveals the answer.
The on-page `answer_evidence` region is the whole page (a permission/validation
placeholder — the worker sees the whole page), not a located mark.

**Separate answer key** is the one case that is NOT `answer_present`: its
answer is on other pages. It keeps the richer `EvidenceState` vocabulary in
the EVIDENCE stage, which can still report a key mark as `ambiguous` or
`illegible`. On-page = binary; separate key = its own path.

**A document can be BOTH** — an attached key PDF *and* answers marked on the
exam pages. EVIDENCE only ever reads the key pages, so it cannot see the
on-page marks; when it reports `uncertain` or `no_answer_key`,
`keepIndexObservedMarks` (executor) reconciles that with INDEX's on-page
observation and the document policy becomes `mixed`, not the key's verdict.
Without it, an unreadable key blanked every row in the document, including the
ones INDEX had read correctly (fixed 2026-07-30).

## Known layouts

| Source | Capture | How the answer is shown | answer_present |
|--------|---------|-------------------------|----------------|
| Embryo Lecture (Dr. Noaman) | Native digital | Printed letter in a dedicated right-hand **table column** | `true` |
| Family Medicine 2022/2023 | Photo of paper | Handwritten **strike** through the chosen option's letter | `true` |
| photo 01-57 | Photo of paper | Faint handwritten **tick/check** beside the chosen option | `true` |
| photo 02-00-43 | Photo of paper | Handwritten **answer letters in the red margin** (not on the options) | `true` |
| photo 02-00-48 | Photo of paper | **Green highlighter** over the correct option text | `true` |
| EOR IM MCQ 2025-194-2nd (2) 1 | Photo of paper | Large **red handwritten letter in the right margin**, one per question, overlapping the printed text | `true` per page; **`false` 49/50 in an 8-page window** — the measurement that demoted the field |
| (needed) | — | **Separate answer-key page/PDF** | n/a — EVIDENCE stage |
| (needed) | — | **Unanswered exam** — the negative case | now decided by the WORKER, not INDEX |

The axis that first broke INDEX was not typed-vs-handwritten or
column-vs-highlighter; it was **on-the-option** (a mark on a choice) vs
**beside-the-question** (an answer in a column/cell/margin, previously
mislabelled unanswered). Both are `answer_present: true` — the answer is
visible on the question's own page either way, and the worker reads it off the
page regardless of how it is shown.

## Still uncovered (do not claim the prompt generalises until these exist)

- A real separate answer-key document, verified end-to-end.

## The unanswered exam at production chunk size — covered 2026-07-31

The second item that stood here is now measured. A full headless conversion of
`EOR IM MCQ 2025-194-2nd.pdf` (the unanswered scan, 8 pages) through the real
app at production chunk size — 50 rows, 5 worker chunks of 10 rows with several
page images each — ended **1 of 50 answered, 49 flagged `no_visible_answer`**.
A larger chunk does NOT erode the worker's restraint.

The single filled row is not a false positive: row 28's option **b** carries a
hand-drawn circle (verified against the render), and the worker returned exactly
that index. So on a document whose marks are almost entirely absent it found the
one that exists and abstained everywhere else.

## Answer accuracy on a marked exam — measured 2026-07-31

The other half of the same question ("does the 2026-07-30 WORKER prompt edit
raise answer recall without raising WRONG answers", left open in CLAUDE.md).
`EOR SUR MCQ 2026-195-1st [Answers].pdf` — 10 photographed pages, 80 MCQs, the
correct option highlighted — converted twice. Ground truth read off the renders
for 22 questions lives in `scripts/truth/`.

- **43 of 44 graded answers correct** (run 1: 21/22, run 2: 22/22).
- It follows the **highlighter** over a competing pen circle on a different
  option (Q3, Q9, Q14, Q51, Q53, Q55 all carry both marks), and reads a pink
  highlight as readily as yellow.
- Q58 is struck through and hand-annotated "Cancelled". It came back **blank and
  flagged** — the only flagged row in either 80-row run.
- 80 of 80 questions extracted both times, zero truncation, audit
  `safe_to_import`.

**The instability is in reading, not extraction.** Diffing the two runs: option
counts identical on all 80 rows, question text near-identical, but **4 answers
disagreed (5%)**. Neither run is systematically better — run 1 is right on rows
22 and 37, run 2 on rows 11 and 71. Treat ~5% answer flakiness as the current
floor on a clean marked scan; it is why Review exists.

## The unanswered exam — covered 2026-07-30

The negative case that had been open since the corpus was written. Since
`answer_present` was demoted, nothing upstream stops the worker from trying, so
the worker's own restraint is the only thing between an unmarked exam and
invented answers. `EOR IM MCQ 2025-194-2nd.pdf` and
`EOR IM MCQ 2025-194-2nd (2) 1.pdf` are clean unanswered and red-margin-answered
scans of the SAME exam — an exact A/B.

Measured with `scripts/probe-worker-answer.mjs` (the pinned WORKER prompt, rows
carrying the post-change `extract_visible_evidence` policy,
`gemini-3.1-flash-lite`):

| Page | Answered copy | Unanswered copy |
|---|---|---|
| 1 (5 marks) | 5 of 6 filled | **0 of 6** |
| 3 (7 marks) | 7 of 7 filled | **0 of 7** |

The worker fills when marks exist and abstains completely when they do not — it
does not invent. Accuracy on page 3, whose letters are unambiguous: six of seven
exactly right (c,b,d,b,b,c). The seventh is Q19, whose option **d) Methyldopa is
printed on page 4** — the worker saw the mark but only three options, which is
the page-boundary defect, caught separately by `pageBoundaryOptionRowIds` and
`options_cut_at_page_break`. Without that guard `forceAnswer` would have accepted
the in-range index and shipped a wrong answer; the two fixes depend on each
other.

## Seeing a document

`node scripts/render-pdf-pages.mjs <file.pdf> <page> [page...]` renders pages
to `scripts/out/page-N.png` with the same engine renderer. Look at the source
before theorising about the model's output.
