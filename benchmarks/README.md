# Conversion benchmarks

This top-level directory is shared by every workflow. It is deliberately not
owned by a workflow: a result is meaningful only when every candidate is scored
against the same corpus and acceptance rules.

## Layout

- `corpus/` — source-document registry and case metadata. PDFs stay in the
  existing approved sample locations unless they are intentionally copied here.
  [`corpus/ANSWER_LAYOUTS.md`](corpus/ANSWER_LAYOUTS.md) records how real exams
  show their answers and which layouts are structurally hard — facts about
  paper, inherited by every workflow. What a *particular* workflow measured on
  those documents stays with that workflow.
- `truth/` — human-verified expected extraction and answer data.
- `results/` — versioned, reproducible run summaries; never API keys or raw
  user documents.

Every benchmark result must name the workflow id and version, source case,
request count, elapsed time, row completeness, answer precision/recall, flags,
and audit outcome.

Gold 1.0 is the initial baseline. No workflow becomes selectable until its
results are non-inferior to Gold on the shared required cases.
