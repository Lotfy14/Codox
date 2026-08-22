# Gypsum engine

## Pipeline

Gypsum is a fresh engine with no imports from another workflow. It shares only
the app's device/account plumbing: PDF rasterisation, Gemini transport, and run
artifact storage.

1. Render the exam and optional mark scheme at 200 DPI.
2. Read every exam page independently as the only supplied page. One strict
   response contains an independent label manifest, complete MCQ transcription,
   question box, and every required visual box. Invalid or internally
   inconsistent responses get two focused retries; an unreadable page stops
   instead of producing a short PDF.
3. Read each attached mark-scheme page independently and merge only visible
   numeric-label → printed-letter pairs.
4. Merge rows in page order, validate sequential labels and the question count
   printed on the cover, then crop visuals directly from the exact core-page
   JPEG. Emit matching `image_urls`, crop artifacts, and Review asset links.
   Gypsum owns its boxes, parser, crop mapping, blueprint projection, and CSV
   writer.
5. Audit independent four-page windows against rows and the figure inventory.
   Missing visuals receive one focused detection/crop pass and are audited again.
   Model failures and deterministic count/crop failures make the run unsafe.

## Benchmark gate

Before `status` may become `verified`, version 0.1.0 must be run on at least
three official IGCSE MCQ papers with human-checked truth:

1. Biology 0610/02 — biological drawings, micrographs, graphs, and tables.
2. Chemistry 0620/02 — structures, apparatus, particle diagrams, equations,
   and data tables.
3. Physics 0625/02 — circuits, ray/force diagrams, graphs, and graphical A-D
   choices.

For each paper the result must contain every one of the 40 questions exactly
once, all printed choices in order, every required visual with a readable crop,
no decorative crop, no unsupported answer, and no unflagged audit discrepancy.
Benchmark summaries belong in `benchmarks/results/` and raw PDFs/runs remain in
ignored scratch directories.
