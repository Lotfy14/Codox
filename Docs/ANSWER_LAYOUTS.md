# Answer-layout corpus

Real exam documents vary in HOW the correct answer is shown, and the INDEX
stage's `evidence_state` must recognise each so the answer flows through
BOX → worker → `correct_index`. This is the reference set the INDEX prompt's
`evidence_state` definition is worded against — expand it before rewording,
never narrow the prompt to one document again.

The pipeline maps `evidence_state` as follows (unchanged by the corpus):

- `inline` → BOX draws an evidence region, document policy becomes
  `inline_marks`, the worker reads the region into `correct_index`.
- `separate` → the answer lives in a separate answer-key PDF (the optional
  drop zone); the EVIDENCE stage locates it.
- `ambiguous` / `illegible` → blank + review (NEVER-GUESS).
- `none` → genuinely unanswered; blank + review. Must stay strict, or an
  unanswered exam starts inventing answers.

## Known layouts

| Source | Capture | How the answer is shown | evidence_state |
|--------|---------|-------------------------|----------------|
| Embryo Lecture (Dr. Noaman) | Native digital | Printed letter in a dedicated right-hand **table column** | `inline` |
| Family Medicine 2022/2023 | Photo of paper | Handwritten **strike** through the chosen option's letter | `inline` |
| photo 01-57 | Photo of paper | Faint handwritten **tick/check** beside the chosen option | `inline` |
| photo 02-00-43 | Photo of paper | Handwritten **answer letters in the red margin** (not on the options) | `inline` |
| photo 02-00-48 | Photo of paper | **Green highlighter** over the correct option text | `inline` |
| (needed) | — | **Separate answer-key page/PDF** | `separate` |
| (needed) | — | **Unanswered exam** — the negative case | `none` |

The axis that first broke INDEX was not typed-vs-handwritten or
column-vs-highlighter; it was **on-the-option** (a mark on a choice, always
recognised) vs **beside-the-question** (an answer in a column/cell/margin,
previously mislabelled `none`). Both are now `inline`: the answer is visible
on the question's own page either way.

## Still uncovered (do not claim the prompt generalises until these exist)

- A real `separate` answer-key document, verified end-to-end.
- A genuinely **unanswered** exam, to prove the widened `inline` does not push
  `none` questions into false answers.

## Seeing a document

`node scripts/render-pdf-pages.mjs <file.pdf> <page> [page...]` renders pages
to `scripts/out/page-N.png` with the same engine renderer. Look at the source
before theorising about the model's output.
