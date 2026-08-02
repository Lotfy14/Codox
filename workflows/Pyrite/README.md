# Pyrite

**Version:** 0.1.0  
**Status:** experimental

Pyrite is Codox's low-request conversion workflow. It is intended for clear,
ordinary multiple-choice exam PDFs where a fast, economical first-pass draft is
more useful than Gold's independent confirmation and audit coverage.

It must produce the same shared output contract as every workflow: rendered
source pages, `ExamQuestion[]` in `merged-rows`, and a CSV artifact. It does
not produce question crops or attempt to detect figures. Review therefore uses
the source page, and rows that appear to need a figure are explicitly flagged.

## Request budget

Pyrite makes one extraction request for each window of up to four exam pages,
plus one request for each window of a separate answer key when one is supplied.
There is no planner, evidence, figure, box, worker repair, inline-answer
confirmation, matching, or audit request.

| Document | Pyrite target | Gold's strategy |
|---|---:|---|
| 20-page exam, no separate key | 5 requests | Multiple planning, crop, worker, and audit passes |
| 20-page exam + 2-page key | 6 requests | Gold's full independent pipeline |

The target is a budget, not a reason to omit data: when a window cannot be
read safely, Pyrite keeps a flagged draft row or stops with an honest reason.

## Intended use

- Text-forward MCQ papers with clear question numbering and choices.
- Quick conversion drafts that a tutor will review.
- PDFs without essential diagrams, tables, or complex cross-page layout.

Pyrite is not the default and is not appropriate when answer correctness,
diagram capture, or unattended import safety matters. Use Gold for those.

## Safety rules

- Never invent a correct answer. If the answer is not plainly visible in the
  current exam window or supplied key window, emit `correct_index: ''` and a
  review reason.
- Every returned row is deterministically validated: non-empty id and question,
  at least two options when options are present, and an answer index within the
  option range.
- Windows overlap by one page. Deduplication uses the printed question label
  when available and otherwise a normalized question prefix. A duplicate is
  flagged rather than silently merged when the text conflicts.
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
