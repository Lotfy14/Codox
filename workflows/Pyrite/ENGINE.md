# Pyrite engine

## Pipeline

1. **Render** every exam page at 200 DPI and persist the shared `page-jpeg`
   artifacts. Render a separate answer-key PDF after the exam pages when one
   was supplied.
2. **Extract** windows of four core pages with a one-page look-ahead. One model
   call returns all visible question rows: printed label, source pages,
   question, options, and only plainly visible inline answers. The call also
   declares any rows that need a diagram, table, or continuation review.
3. **Read a separate key**, if supplied, in the same four-page windows. One
   call returns printed-label-to-answer mappings. No key is inferred from an
   exam page.
4. **Assemble locally**: deduplicate overlap rows, attach key answers by label,
   validate fields, and flag uncertainty. No model call is made for repair,
   reconciliation, matching, crops, or audit.
5. **Emit** `merged-rows` and CSV. The run is always `notSafeToImport` because
   Pyrite deliberately has no independent audit.

## Extraction response shape

```json
{
  "rows": [
    {
      "label": "12",
      "source_pages": [3],
      "question": "...",
      "options": ["...", "..."],
      "correct_index": "",
      "needs_review": ""
    }
  ]
}
```

`correct_index` is a zero-based string or empty. `needs_review` is mandatory
when text, options, an answer mark, or a continuation is unclear. The parser
rejects values outside the output contract rather than repairing them with an
extra request.

## Benchmark gate

Pyrite remains experimental until the shared corpus demonstrates all of the
following on ordinary, text-forward documents:

- at least 95% question recall against the marked corpus;
- no incorrect non-blank answer index introduced by key attachment;
- all diagram-linked and ambiguous rows flagged for Review;
- median request count at least 60% lower than Gold for the same document.

The figure-heavy and separate-key corpus cases are guardrails: failure there is
acceptable only when the affected rows are retained and flagged, never when
they are silently omitted or answered incorrectly.
