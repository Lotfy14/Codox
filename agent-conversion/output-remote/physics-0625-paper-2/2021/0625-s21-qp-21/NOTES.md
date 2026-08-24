# 0625_s21_qp_21 — Cambridge IGCSE Physics, Paper 2 Multiple Choice (Extended)

**Source:** `0625_s21_qp_21.pdf` — Cambridge Assessment International Education,
Cambridge IGCSE Physics 0625/21, May/June 2021, 45 minutes, 40 marks.
Converted by `claude-opus-5`.

## What the document is

16 exam pages (page 1 is the instructions cover, questions run on pages 2–16)
followed by the **published mark scheme** for the same paper, rendered as pages
17–19 and marked `role: answer-key`. The paper states "There are **forty**
questions on this paper" and forty is what was extracted — questions 1–40, no
gaps, no restarts in numbering.

Every question is a four-option A–D multiple choice. No matching questions, no
extended-matching stems, no true/false grids.

## Where the answers came from

All 40 answers are `"source": "extracted"`, read off the mark-scheme table on
key pages 18 (questions 1–28) and 19 (questions 29–40). That table prints one
letter per question in a "Question | Answer | Marks" grid; each question's
`answer.evidence` names the key page and the row. Nothing is marked on the exam
pages themselves — the paper is a clean, unmarked question paper — so the key is
the only answer source, and it is unambiguous and fully legible.

No answer was reasoned or guessed. Nothing is flagged.

## Options that are not printed as a list

Twelve questions print no option list on the page; the choices are rows of a
table or letters inside a drawing. Per QUALITY.md those carry
`["A","B","C","D"]` as their options and the table/drawing is cropped as the
figure, so the tutor picks a letter and reads the row off the picture exactly as
a candidate does:

- **Table rows ("Which row is correct?")** — 2, 4, 14, 21, 23, 27, 32, 35, 37, 38
- **Letters inside a drawing** — 3 (four balls labelled A–D above the ground),
  13 (points A–D on a mercury barometer)

The tables were **not** flattened into option text.

Questions whose stem contains a numbered statement list (10 and 26) keep each
item on its own line with blank lines around the list.

## Figures

31 figures, all cropped with `agent-crop.mjs` and **opened and checked
individually** for clipping and for bleed from the neighbouring question. Three
were re-cropped after looking: fig-03 (a descender from its own stem at the top),
fig-08 (same), and fig-21 (the label "metal sphere" was clipped at the right
edge — widened).

Where a question has a diagram **and** an option table they are two separate
figures listed in printed order, never one crop spanning both:

- Q23 → fig-14 (glass–air boundary diagram) + fig-15 (yes/no table)
- Q27 → fig-17 (loudspeaker/materials diagram) + fig-18 (materials table)
- Q32 → fig-22 (LDR potential-divider circuit) + fig-23 (light-level table)
- Q35 → fig-26 (generator diagram) + fig-27 (a.c./d.c. table)

Q28 prints two labelled panels side by side; they are cropped separately as
fig-19 ("diagram 1", the compass) and fig-20 ("diagram 2", the bar magnet with
point P), each keeping its own printed caption.

## Boxes

Every one of the 40 questions has a `box` — none omitted, so the tutor never gets
a whole page beside a single question. Each box spans that question's own block
from its first line down to its last option, including its own diagram and option
table, and stops short of the neighbouring question. Boxes were spot-checked by
re-cropping and viewing them, including the tightest stacks (page 4 carries five
questions, page 12 three long ones).

## Topics and year

`year` is `"2021"` on every question, taken from the printed "May/June 2021" on
the cover and the `0625/21/M/J/21` footer. The paper prints no topic
classification, so `topic` and `subtopic` are left blank and `topics[]` is absent
— the tutor can match against their own list in Codox after import.

## Left for the tutor / unresolved

Nothing. Zero errors, zero warnings from `agent-validate.mjs`; no question is
flagged and no answer is awaiting approval.

One transcription note worth knowing: question 39's nuclide symbols are printed
with superscript mass numbers and subscript proton numbers. They are transcribed
with Unicode superscript/subscript characters (e.g. `²¹⁵₈₄Po`), which preserves
the printed values but renders in a plainer style than the original typesetting.
The same applies to the powers of ten in questions 22 and 25 and the units in 5,
7, 12 and 17 (`cm³`, `m/s²`, `N/m²`). If any of those render oddly in the tutor's
font, the source is the cropped page image beside the question.
