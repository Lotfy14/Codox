# Gypsum

**Version:** 0.1.0
**Status:** experimental

Gypsum is Codox's IGCSE multiple-choice workflow. It exports MCQs only and is
tuned for numbered A-D questions and scientific visuals whose labels are easy
to confuse with question or option labels.

Its engine is implemented from scratch and imports no code from Gold, Pyrite,
or another workflow. It shares only app-level PDF rendering, provider transport,
and artifact storage.

Each exam page is the sole image in its own extraction request. That request
independently emits the page manifest, complete MCQ rows, question geometry,
and required visual geometry. Gypsum validates and merges these records itself,
crops the exact rendered JPEGs, reads attached mark schemes page by page, and
performs a separate four-page audit pass with focused missing-visual repair.
Its final blueprint records every crop as a shared Review asset and links it to
the same rows that name the path in `image_urls`.

## Image policy

A visual is extracted whenever removing it would make a question or choice
incomplete or ambiguous. This includes diagrams, photographs, graphs, tables,
maps, flowcharts, chemical structures, apparatus, circuits, and graphical A-D
option panels. Crops retain axes, units, legends, captions, arrows, labels, and
table edges. Decorative page furniture is excluded.

## Safety

- Instructions, formula sheets, answer sheets, and structured/free-response
  items never become rows.
- Unmarked papers never receive reasoned answers. Answers come only from visible
  marks or an attached mark scheme/answer key.
- Missing questions, incomplete choices, missing visuals, or clipped crops fail
  the audit and keep the run in Review.
- Gypsum remains experimental until its multi-paper benchmark is complete.

See [ENGINE.md](ENGINE.md) for the benchmark gate and stage semantics.
