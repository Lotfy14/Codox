# Pyrite engine

## Pipeline

1. **Render** every exam page at 200 DPI and persist the shared `page-jpeg`
   artifacts. Render a separate answer-key PDF after the exam pages when one
   was supplied.
2. **Extract** windows of two core pages with a one-page look-ahead. One model
   call returns all visible question rows: printed label, printed section
   heading, source pages, question, options, and only plainly visible inline
   answers. The call also declares any rows that need a diagram, table, or
   continuation review, and reports the mappings printed on any answer-key page
   that falls inside the window.
3. **Read a separate key**, if supplied, in the same windows. One call returns
   printed-label-to-answer mappings. No answer is ever inferred from subject
   knowledge — only read off a page.
4. **Assemble locally**: stitch page-break continuations, deduplicate overlap
   rows, attach key answers by section and label, validate fields, and flag
   uncertainty. No model call is made for repair, reconciliation, matching,
   crops, or audit.
5. **Emit** `merged-rows` and CSV. The run is always `notSafeToImport` because
   Pyrite deliberately has no independent audit.

## Extraction response shape

```json
{
  "rows": [
    {
      "label": "12",
      "section": "Section A",
      "source_pages": [3],
      "question": "...",
      "options": ["...", "..."],
      "correct_index": "",
      "needs_review": ""
    }
  ],
  "key_answers": [{ "section": "Section A", "label": "12", "answer": "b" }]
}
```

`correct_index` is a zero-based string or empty. `needs_review` is mandatory
when text, options, an answer mark, or a continuation is unclear. The parser
rejects values outside the output contract rather than repairing them with an
extra request.

## Local assembly

Every rule below is deterministic and costs no request. Each was written
against a real failure on `IM MCQ Exams 2024-193.pdf`, a 45-question paper in
two sections with its answer key bound in as the last page.

**Page numbers are checked against the window that produced them.** The prompt
names the window's absolute page range, but roughly one response in three
numbers its rows against the images it was handed instead — a window over pages
13-15 comes back saying 1, 2, 3. Nothing checked, and the damage was silent:
deduplication recognizes a re-read only when two sightings sit within one page,
so every question on a renumbered window read as a section restarting twelve
pages away and shipped twice. It also kept the *weaker* reading as the primary
row, because the better one now sat under a suffixed id. A window starting at
page 1 numbers alike either way, so only a later window is renumbered, and only
when every page it named fits inside its own image count; a response naming any
page beyond that span is describing document pages and is left alone.

**Labels are normalized.** One window reads `15` off a page and the next reads
`15)` off the same page. Trailing punctuation is stripped so the two key alike;
without it one question became two rows and a key entry matched neither.

**Section headings are carried forward.** A heading is printed once, so only
the window that renders that page reports it and later windows come back with
an empty section. Each page inherits from the nearest earlier page that
declared one. A row that read its own heading always keeps it.

**A printed label identifies a question only inside its section.** Section B
restarting at "1" gave 20 of the paper's 45 questions a label Section A had
already used; a document-wide label key discarded every one of them silently.
Two observations are one question when the sections agree (or one is unknown)
and either the labels or the exact normalized content match. Failing a heading,
the page distance decides: a look-ahead re-read is at most one page from the
neighbouring window's reading, while a section restart is many pages away. The
first section keeps the plain label as its id; a later reuse takes a `#2`
suffix, because ids are unique per import.

**A stem that already carries the paper's usual choice count is complete.** The
model's own `options_cut_at_page_break` flag is its guess; the choice count is
the paper's fact. Trusting the flag welded question 115's four choices onto
question 114, which had all four of its own — an eight-option hybrid whose
answer index pointed into the wrong half, and merging then stripped the very
flag that had admitted it, so the row shipped unflagged with a confident wrong
answer. The count decides whenever the paper stated one clearly enough to
judge against: a mode is only trusted from at least four measured rows that
actually agree, since three rows of a two-choice window would otherwise make a
genuinely cut question look whole.

**An orphaned continuation is reunited with a stem another window read.** The
per-response rule below is deliberate, but a continuation's owner is genuinely
often in the neighbouring window — choices at the top of page 3 belong to a stem
on page 2, which the window whose core starts at page 3 never sees. Those
fragments shipped as empty-question rows carrying an answer the real question
then lacked. This pass is safe where proximity was not because it matches only a
stem whose choices *already end* with the fragment's, exactly, on an adjacent
page: identity, not nearness. It may then take only the answer, at the offset
where those choices sit, and drop the fragment as the duplicate it is. It never
lengthens a question, and a fragment matching nothing stays flagged for Review.

**A continuation attaches only to a stem that is missing choices.** The choices
are printed on the *last* page the row names — the model reports the stem's
page beside it — and the owner must either declare that it runs onto that page
or be genuinely short of choices by the rule above.
The search covers one response's rows in both directions, since the prompt
emits the continuation before that page's own questions. An option list the
stem already carries is dropped rather than doubled, and a continuation with no
owner is kept as a flagged fragment — never welded to whichever question
happened to sit nearby.

**A key answer attaches only when section and label both resolve.** A key
listing "Section A 3: B" and "Section B 3: A" holds two answers for the label
"3"; an unresolved label is flagged `key_ambiguous_label`, never assigned. Key
letters are read as letters only — a digit is refused rather than guessed at,
because nothing on the page says which base it counted from.

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
