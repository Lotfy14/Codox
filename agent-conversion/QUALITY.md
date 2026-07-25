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
- **Keep the line breaks the layout depends on.** A newline in `question` is
  content, not whitespace — Codox renders it. When a stem introduces a numbered
  or lettered list of statements and then asks about them, put each item on its
  own line and separate the three parts with blank lines:

  ```
  The list shows some processes that take place in a human body.

  1 production of new red blood cells
  2 transmission of nerve impulses from the eyes to the brain
  3 diffusion of gases into and out of the lungs

  Which processes use energy released by respiration?
  ```

  Run together as one paragraph — `…human body. 1 production of new red blood
  cells 2 transmission of…` — the item boundaries vanish and the tutor cannot
  tell where statement 1 ends and 2 begins. This is not a figure: the document
  printed a list of text, so it stays text (the options are the real printed
  `1 and 2 only` / `1, 2 and 3` list). Crop it as a picture only when the items
  are rows of a table or parts of a drawing, per the section above.
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

### When the options are lettered entries in a table or a picture

Some questions print no option list at all. The choices are rows of a table
("Which row is correct?"), or lettered items inside a drawing — four test-tubes
labelled A–D, four farms on a map, arrows into a diagram of the kidney. There
the letter *is* the option.

**Emit `["A", "B", "C", "D"]` and crop the table or the drawing as the figure.**
The tutor picks a letter and reads the row off the picture, exactly as a
candidate does.

Do **not** flatten a table's rows into option text. Writing row B as
`movement of water: yes, energy from respiration used: no, …` invents a layout
the document never used, and it is the one shape of paraphrase that is easy to
talk yourself into — every word is still the document's, so it feels verbatim.
It isn't: the table is a picture, and it belongs in `figures[]`.

- Crop the **whole** table, including any key beside it (`✓ = yes`, `✗ = no`) —
  without the key the crop is unreadable.
- When the question has a diagram **and** an option table, they are **two
  figures**, not one. Crop the diagram on its own, crop the table on its own,
  declare both in `figures[]`, and list both ids on the question in printed
  order. See "One picture, one figure" below.
- A question that *does* print a real option list keeps it as text, even when
  the options are terse (`1` / `2` / `4` / `6`, `P, Q and Z`, `1 → 3 → 2`). The
  test is whether the document printed a list, not how short the entries are.

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
- **One picture, one figure.** A question showing a diagram *and* an option
  table gets **two** entries in `figures[]` — the diagram cropped alone, the
  table cropped alone — both listed on the question in printed order. Do not
  let one crop span both. A combined crop drags in the question text between
  them, and in Review it shows as one wide image where each picture is half the
  size it should be. Same rule for any other pairing: two graphs, a map and a
  key, a photo and a data table — crop each, list each.
- **Look at every crop you make.** A clipped label is the most common defect
  and it is invisible unless you open the file.
- **A crop that shows any part of the next question is wrong — re-crop it.**
  Even one trailing line ("The diagram shows a type of plant cell.") is a
  defect, not a nuisance: it puts a second question's text inside this
  question's picture and the tutor sees it in Review. It is tempting to accept
  because the figure itself is complete and the crop looks fine at a glance —
  accept it anyway and you have shipped the bug. Lower `ymax` until the next
  question's first line is gone, then look again. The two failure directions
  are opposite and both real: **clipped** means widen, **bleeding** means
  tighten. Fix whichever you see, re-run, and re-open the file.
- One figure serving several questions is declared once in `figures[]` and
  referenced by each question's `figures` array.
- Two pictures of this same question that genuinely overlap — a label sitting
  between them, an axis shared — are the one case where a single crop is right.
  Crop wider rather than clip a limb: too much context is a nuisance, a missing
  limb of a diagram is a broken question. This is an exception you can point at
  on the page, not a default.

## The question's own box

Separate from `figures[]`, each question carries a `box` — the region Review
shows beside it while the tutor works. **Give every question one.** It is a
tight rectangle around that question's whole block: its first line of text,
**its own diagram and option table**, down to its last option — everything a
candidate needs to answer it, and nothing of the questions above or below.

Omit it only when the question genuinely cannot be bounded — it runs across a
page break, or its parts are interleaved with another question — and say so in
NOTES.md. Omitting `box` is not free: the tutor then gets the **whole page**
beside a single question and has to find it themselves, on every question on
that page. A page-sized box is the fallback for the rare unbounded question,
never the default for a whole paper.

The question's figures ship *as well*, cropped and on their own — that is not a
reason to leave them out of the box. A box that stops above the diagram shows
the tutor a question with its picture cut away, which is exactly the thing they
need to see. Include them; the crops are the close-up, the box is the question
as printed.

What the box must never contain is **another question's anything** — its stem,
its options, its figure. That is the only line to hold when a question and its
neighbour sit close together: stretch the box to cover this question's own
figure, then pull `ymin`/`ymax` in until the neighbour is gone.

## Topics and years

- Only from the document. If it prints a topic heading or an exam year, carry
  it. If it does not, leave the field `""` — the tutor has their own topic list
  in Codox and can match against it after import.
- `topics[]` is the document's own taxonomy, if it states one. Do not invent a
  classification.

## Before you say you are done

- Every exam page accounted for — no page silently skipped.
- Question count matches what the document claims, if it claims one.
- Every numbered statement list inside a stem still has its line breaks — no
  question collapsed into one run-on paragraph.
- No option text that the document never printed as a list — every
  "Which row is correct?" is `["A","B","C","D"]` with the table cropped.
- Every figure crop opened and checked — nothing clipped, and **no crop showing
  any part of the next question**.
- Every picture is its own figure — no crop spanning a diagram and its option
  table together.
- Every question has its own `box`, covering its own figures and none of its
  neighbour's, except any you listed in NOTES.md as unbounded.
- `node scripts/agent-validate.mjs …` reports zero errors.
- `NOTES.md` written, including anything you were unsure about.
