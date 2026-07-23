# Reading an exam well

Everything here is something this project has already got wrong once. It is
cheaper to read than to rediscover.

## Where the answer lives

This is the question most often answered wrongly, and getting it wrong blanks
the entire exam. Real documents show the answer in at least these ways — every
one of them counts as `"source": "extracted"`:

| How it looks | Example |
|---|---|
| A mark **on** the chosen option | a tick, a strike through the letter, a green highlight over the option text |
| A letter **beside** the question | a printed answer in a dedicated right-hand table column; a handwritten letter in the margin |
| A **separate key** | key pages appended after the exam (`"role": "answer-key"`), or a key document in the same input folder |

The axis that broke the built-in engine was not typed-vs-handwritten. It was
**on-the-option** versus **beside-the-question**: an answer printed in its own
column was repeatedly read as "no answer given", and a whole exam exported
blank. If a column of single letters runs down the side of the page, that is
the answer key. Read it.

Say what you saw in `answer.evidence`. If you cannot write that sentence, the
answer is not `extracted`.

### When it is not `extracted`

- Two marks on one question, or a mark you cannot resolve → `none`. Conflicting
  marks are not an answer.
- A mark you cannot make out → `none`.
- You know the medicine and the page says nothing → `reasoned`. This is the
  right and useful call; the tutor approves it in one click.

## Question text

- **Verbatim.** Copy what is printed, including odd phrasing. Fix nothing.
- **Drop the printed number or letter.** `12. A 54-year-old man…` becomes
  `A 54-year-old man…`. Codox numbers questions itself.
- **Shared case stems**: when several questions hang off one scenario, repeat
  the stem in each question, a blank line, then that question's own prompt:

  ```
  Case 10: A 54-year-old man presents with chest pain…

  Which investigation is most appropriate first?
  ```

  No `Case stem:` or `Question:` labels — the blank line is the separator.
  Keep the printed case identity ("Case 10") if the document shows one.
- **Right-to-left documents** (Arabic and similar): copy the text as printed.
  Do not reorder, transliterate, or translate.

## Options

- Verbatim, in printed order, with the `A)` / `1.` labels stripped.
- Keep `All of the above` / `None of the above` as ordinary options in place.
- Do not merge, split, or deduplicate options.
- Fewer than two options is not a multiple-choice question: emit it with what
  you read and `"flag": "not_mcq"`. The tutor turns it into one or deletes it.

## Not-quite-MCQ formats

- **Matching questions** (a left column paired to a right column) cannot be one
  row. Emit **one question per left-column item**, its options being the right
  column verbatim, and leave the answer `none` unless the document shows the
  pairing. Give each a distinct id (`q014a`, `q014b`, …).
- **Extended-matching stems** — one option bank serving several questions — are
  ordinary MCQs. Repeat the option bank in each question.
- **True/false grids** become one question per statement, options
  `["True", "False"]`.

## Figures

- Crop what the question needs to be answerable: the image, its label, and any
  lettering pointing into it. Not the question text, not the neighbouring
  question.
- **Look at every crop you make.** A clipped label is the most common defect
  and it is invisible unless you open the file.
- One figure serving several questions is declared once in `figures[]` and
  referenced by each question's `figures` array.
- A figure you cannot cleanly separate from its neighbour: crop wider rather
  than tighter. Too much context is a nuisance; a missing limb of a diagram is
  a broken question.

## Topics and years

- Only from the document. If it prints a topic heading or an exam year, carry
  it. If it does not, leave the field `""` — the tutor has their own topic list
  in Codox and can match against it after import.
- `topics[]` is the document's own taxonomy, if it states one. Do not invent a
  classification.

## Before you say you are done

- Every exam page accounted for — no page silently skipped.
- Question count matches what the document claims, if it claims one.
- Every figure crop opened and checked.
- `node scripts/agent-validate.mjs …` reports zero errors.
- `NOTES.md` written, including anything you were unsure about.
