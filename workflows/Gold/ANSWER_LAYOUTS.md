# Gold — how it reads answers, and what that measured

**What real exam documents do with answers** — the layout table, the
on-the-option vs beside-the-question axis, and the two structurally hard
layouts — is corpus metadata shared by every workflow:
[benchmarks/corpus/ANSWER_LAYOUTS.md](../../benchmarks/corpus/ANSWER_LAYOUTS.md).
Read that first. This file is **Gold's** side: which stage makes which call,
and what each was measured to do on those documents.

## How Gold decides

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

## What `answer_present` returned per layout

Every corpus layout reads `true` — the answer IS on the question's own page in
all of them, however it is shown, and the worker reads it off the page
regardless. The one that broke the field:

**`EOR IM MCQ 2025-194-2nd (2) 1`** — `true` per page, but **`false` 49 of 50
in an 8-page window.** That is the measurement that demoted `answer_present`
from a gate to an observation. The corpus file explains why it is not a model
weakness: on a document whose answers are an unaligned margin column, the
per-question question has no answer.

The two corpus entries Gold has no path for are the **separate answer-key
document** (EVIDENCE's own path, still unverified end to end) and the
**unanswered exam**, which is now decided by the WORKER rather than INDEX —
both measured below.

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

## The unaligned margin column — probed 2026-07-31

The layout itself is described in
[the corpus file](../../benchmarks/corpus/ANSWER_LAYOUTS.md#the-unaligned-margin-column):
sideways letters down the right edge, drifting out of register, with a page's
letter count not matching its question count.

That is the honest explanation for INDEX's `answer_present` returning false on
page 1 of `EOR IM MCQ 2025-194-2nd (2) 1.pdf` while returning true for all of
page 3 — superseding the earlier theory that hedged prompt wording drove it
toward `false`. Page 3 scores 7/7 because seven evenly-sized questions happen
to keep the column in register, not because the stage judged each question.
Rewording cannot fix a field the document cannot answer, and neither can one
page per call.

`scripts/probe-margin-letters.mjs` tests the well-posed alternative — ask ONE
page for two short lists (the letters top-to-bottom, and the question labels
starting on that page) and let code do the mapping. Deliberately two list fields,
not ten per-question fields, since collapse-to-a-constant is a property of long
enumerations.

**What works.** Where the read could be checked against the printed answers it
was exactly right, including glyphs a human could not call from the render:

| Page | Read | Truth |
|---|---|---|
| 1 | `d c d d c` → Q1–Q5 | all 5 correct |
| 3 | `c b d b b c d` → Q13–Q19 | all 7 correct |

Page 3's rotated `b`/`d` pair is genuinely ambiguous to the eye at render
resolution; the model resolved every one. And on the unanswered twin
(`EOR SUR MCQ 2025-194-1st.pdf`) it returned **0 letters on all 5 pages tested** —
no fabrication, against the 33-of-65 rows the current path answers from subject
knowledge on that same document.

**What does not work — the read is not stable.** Repeating pages 1–8 gave a
different answer on **5 of 8 pages**: page 2's last letter `d`→`c`, page 4
`d a d d a a a` (7) → `a b d c a` (5), page 5's last two transposed, page 6's
sixth `d`→`a`, page 7 six letters → seven. Page 4 alone, run four times
sequentially, produced three distinct readings, one containing **`g`** — not a
valid option letter on that page. Total letters across the document came to
exactly 50 (matching a 50-question exam) on the first pass and 49 on the second,
so that global check is luck, not a property.

Concurrency is **not** the cause: page 4 varies identically at
`PROBE_CONCURRENCY=1`. This is ordinary run-to-run variance, consistent with the
~5% answer flakiness recorded for the highlighter exam above, but far worse on
this document's rotated glyphs.

**Still open.**
- *Attribution.* The count check (`MAP` only when letters == questions) refuses
  the 4 pages where a question spans a page break, discarding 5 correct answers
  on page 1 alone; and it is not sufficient either — two page-4 runs agreed on a
  7-letter reading that would have mapped. Doing this properly means tracking
  where each question's options **end**, not where it starts.
- *Stability.* Pages 1, 3 and 8 repeat byte-identically; 2, 4, 5, 6, 7 do not.
  Nothing here distinguishes a trustworthy read from an untrustworthy one at
  runtime, which is what a shipping design would need.

Treat this as a measured layout finding and a probe, **not** a validated design.
