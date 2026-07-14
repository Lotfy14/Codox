# Planner test migration follow-up

Urgent staged-planner release shipped on 2026-07-14 with the legacy
single-PLANNER executor suite removed. Rebuild src/engine/executor.test.ts
before the next planner change; do not restore its old request assumptions.

Required coverage:

- INDEX window schema, core-page ownership, page manifests, and resumed window
  checkpoints.
- RECONCILE duplicate identity, conservative section restarts, numeric gaps,
  targeted retry issues, and unnumbered shifted-pass union.
- Separate answer-key pages mapped globally by stable question refs.
- FIGURE DETECT independent of index observations; one-page BOX geometry and
  crop linking.
- source_pages causes a worker chunk to receive every page of a
  page-spanning question.
- Semantic BOX/INDEX failures become visible planning issues and retain clean
  rows; provider failures still use normal pause/stop behavior.
- Worker retry, merge forcing, audit safety, cancellation, resume, and
  Flash-Lite model pinning under the staged request count.
- One real 30-page multi-exam regression plus the external CodoxSandbox gold
  gate (appendicitis 127/127).

The old single-call planner tests are intentionally not a migration template:
their scripted prompt order, count shortfall gate, and repair behavior no
longer describe the engine.
