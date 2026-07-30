# Answer-layout corpus

Real exam documents vary in HOW the correct answer is shown. INDEX makes ONE
perceptual call per question — `answer_present` (boolean, owner-approved
2026-07-21) — "is exactly one answer clearly indicated on this question's own
page?" It does NOT classify how the answer is shown (no inline / column /
margin taxonomy); a present answer is simply read off the page.

The pipeline (on-page):

- `answer_present: true` → document policy becomes `inline_marks`, the row's
  policy permits extraction, and the **worker reads the answer off the full
  page** into `correct_index`. The answer is NEVER read from a BOX region.
- `answer_present: false` → blank + review, never guessed. False absorbs "no
  answer marked" AND conflicting/unreadable marks (not a clean single answer
  ⇒ not present). A document with no marks is all-false ⇒ every row blank.

**BOX is display-only.** It bounds the question and options for the Review
crop; it is never asked to box the answer, and the Review crop deliberately
excludes `answer_evidence` so the question preview never reveals the answer.
The on-page `answer_evidence` region is the whole page (a permission/validation
placeholder — the worker sees the whole page), not a located mark.

**Separate answer key** is the one case that is NOT `answer_present`: its
answer is on other pages. It keeps the richer `EvidenceState` vocabulary in
the EVIDENCE stage, which can still report a key mark as `ambiguous` or
`illegible`. On-page = binary; separate key = its own path.

## Known layouts

| Source | Capture | How the answer is shown | answer_present |
|--------|---------|-------------------------|----------------|
| Embryo Lecture (Dr. Noaman) | Native digital | Printed letter in a dedicated right-hand **table column** | `true` |
| Family Medicine 2022/2023 | Photo of paper | Handwritten **strike** through the chosen option's letter | `true` |
| photo 01-57 | Photo of paper | Faint handwritten **tick/check** beside the chosen option | `true` |
| photo 02-00-43 | Photo of paper | Handwritten **answer letters in the red margin** (not on the options) | `true` |
| photo 02-00-48 | Photo of paper | **Green highlighter** over the correct option text | `true` |
| (needed) | — | **Separate answer-key page/PDF** | n/a — EVIDENCE stage |
| (needed) | — | **Unanswered exam** — the negative case | `false` (all rows) |

The axis that first broke INDEX was not typed-vs-handwritten or
column-vs-highlighter; it was **on-the-option** (a mark on a choice) vs
**beside-the-question** (an answer in a column/cell/margin, previously
mislabelled unanswered). Both are `answer_present: true` — the answer is
visible on the question's own page either way, and the worker reads it off the
page regardless of how it is shown.

## Still uncovered (do not claim the prompt generalises until these exist)

- A real separate answer-key document, verified end-to-end.
- A genuinely **unanswered** exam, to prove `answer_present` stays false and no
  row gets an invented answer.

## Seeing a document

`node scripts/render-pdf-pages.mjs <file.pdf> <page> [page...]` renders pages
to `scripts/out/page-N.png` with the same engine renderer. Look at the source
before theorising about the model's output.
