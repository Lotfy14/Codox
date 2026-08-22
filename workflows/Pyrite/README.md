# Pyrite

**Version:** 0.2.0  
**Status:** experimental

Pyrite is Codox's low-request conversion workflow. It is intended for clear,
ordinary multiple-choice exam PDFs where a fast, economical first-pass draft is
more useful than Gold's independent confirmation and audit coverage.

It must produce the same shared output contract as every workflow: rendered
source pages, `ExamQuestion[]` in `merged-rows`, and a CSV artifact. It does
not produce question crops or attempt to detect figures. Review therefore uses
the source page, and rows that appear to need a figure are explicitly flagged.

## Request budget

Pyrite makes one extraction request for each window of up to two exam pages,
plus one request for each window of a separate answer key when one is supplied.
There is no planner, evidence, figure, box, worker repair, inline-answer
confirmation, matching, or audit request.

| Document | Pyrite target | Gold's strategy |
|---|---:|---|
| 20-page exam, no separate key | 10 requests | Multiple planning, crop, worker, and audit passes |
| 20-page exam + 2-page key | 11 requests | Gold's full independent pipeline |

An answer key bound into the exam PDF itself costs **nothing extra**: its page
is already rendered and already inside a window, so the extraction request that
covers it returns its mappings alongside that window's questions.

The target is a budget, not a reason to omit data: when a window cannot be
read safely, Pyrite keeps a flagged draft row or stops with an honest reason.

## Intended use

- Text-forward MCQ papers with clear question numbering and choices.
- Quick conversion drafts that a tutor will review.
- PDFs without essential diagrams, tables, or complex cross-page layout.

Pyrite is not the default and is not appropriate when answer correctness,
diagram capture, or unattended import safety matters. Use Gold for those.

## Version history

- **0.2.0** — section-scoped deduplication, normalized printed labels, carried
  section headings, a continuation that only feeds a stem missing choices, and
  answers read from a key page bound into the exam PDF at no extra request.
  Measured in `benchmarks/results/pyrite-0.2.0-im-mcq-exams-2024-193.json`.
- **0.1.0** — first implementation.

## Safety rules

- Never invent a correct answer. If the answer is not plainly visible in the
  current exam window or supplied key window, emit `correct_index: ''` and a
  review reason. An answer read off a key page is evidence; an answer supplied
  from subject knowledge is not, and is never requested.
- Every returned row is deterministically validated: non-empty id and question,
  at least two options when options are present, and an answer index within the
  option range.
- Windows overlap by one page. Deduplication uses the printed section heading
  and label when available, exact normalized content otherwise, and requires
  the two sightings to be within one page of each other. Papers restart their
  numbering at each section, so a label alone never identifies a question.
- A response that is invalid or truncated is not retried. Its affected page is
  recorded for review, preserving Pyrite's bounded request count.
- Since there is no audit pass, every completed Pyrite run is marked
  `notSafeToImport: true`. Review remains the human safety gate.

## Current implementation

Pyrite is selectable in Customize as an experimental workflow. It renders and
checkpoints pages, extracts each four-page window, parses and validates rows
locally, optionally reads a separate answer key, and writes `merged-rows` and
CSV artifacts. It is deliberately not the default until benchmarked.

The detailed stage semantics and benchmark gate are in
[ENGINE.md](ENGINE.md).
