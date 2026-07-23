# `exam.json` — the bundle contract

One `exam.json` per exam, in that exam's folder. The validator
(`node scripts/agent-validate.mjs`) is the authority; this file explains it.

```
agent-conversion/output/<batch>/
  <exam-slug>/
    exam.json          ← you write this
    exam.pdf           ← copied by agent-prepare
    pages/page-001.jpg ← rendered by agent-prepare (200 DPI)
    images/fig-01.jpg  ← written by agent-crop
    NOTES.md           ← you write this
```

## Shape

```jsonc
{
  "codoxAgentBundle": 1,
  "sourceFile": "Cardio 2024.pdf",
  "producedBy": "claude-opus-4-8",     // which model did the work; free text

  // Written by agent-prepare. Leave it alone.
  "pages": [
    { "index": 0, "file": "pages/page-001.jpg",
      "width": 1652, "height": 2338, "role": "exam" },
    { "index": 2, "file": "pages/page-003.jpg",
      "width": 1652, "height": 2338, "role": "answer-key" }
  ],

  // One per picture you cropped. `page` is 1-based.
  "figures": [
    { "id": "fig-01", "file": "images/fig-01.jpg",
      "page": 1, "box": [395, 155, 655, 690] }
  ],

  // The document's own topic list, if it states one. Optional.
  "topics": [
    { "topic": "Cardiology", "subtopics": ["Arrhythmia", "Valvular disease"] }
  ],

  "questions": [ /* see below */ ]
}
```

## One question

```jsonc
{
  "id": "q001",                    // unique in this exam; no "~"
  "question": "Which structure is outlined in the figure?",
  "options": ["Aortic arch", "Left atrium", "Right ventricle"],
  "answer": {
    "source": "extracted",         // extracted | reasoned | none
    "index": 1,                    // 0-based into options; null when none
    "confidence": "likely",        // reasoned only: certain | likely | unsure
    "evidence": "key page 3 row 1" // extracted only: what you saw
  },
  "figures": ["fig-01"],           // ids from figures[], in display order
  "topic": "Cardiology",
  "subtopic": "Valvular disease",
  "year": "2024",
  "page": 1,                       // 1-based, required
  "box": [80, 100, 700, 900],      // optional; omit for the whole page
  "flag": "",                      // "not_mcq" etc. when something is wrong
  "groupId": ""                    // shared stem grouping; "" is fine
}
```

### `answer.source` — the important field

| Value | Meaning | What Codox does |
|---|---|---|
| `extracted` | You saw the answer on the page: a mark on an option, a letter in an answer column or margin, a row on a key page. | Fills the answer. The question exports. |
| `reasoned` | You worked it out from knowledge. Nothing on the page says so. | Offered to the tutor as an AI suggestion. The row stays blank and flagged until they approve it. |
| `none` | There is no answer, or the marks conflict, or you cannot read them. | Blank and flagged for the tutor. |

`reasoned` is always safe — it never becomes an answer without a human. Use it
freely. Do not stretch `extracted` to cover a confident guess.

An `extracted` or `reasoned` answer whose `index` names no option is demoted to
`none` with a warning, never repaired into a different option.

### Boxes

`[ymin, xmin, ymax, xmax]`, normalized 0–1000 against the **rendered page**, y
first. `ymax` must exceed `ymin` and `xmax` must exceed `xmin`.

## What makes an exam fail to import

- `codoxAgentBundle` is not `1`
- a duplicate, empty, or `~`-containing question `id`
- empty question text
- a `page` that is not in `pages[]`
- a figure or page `file` that is not actually in the folder, or is not a `.jpg`
- a degenerate box

## What only produces a warning

The exam still imports; these questions arrive flagged for the tutor.

- fewer than two options → flagged `not_mcq`
- an answer index that names no option → blanked
- a question linking a figure id that `figures[]` never declared → link dropped
