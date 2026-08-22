# Gold

**Version:** 1.1.0  
**Status:** verified

Gold is Codox's original Planner → Worker → Audit conversion workflow. It
preserves the current production behavior exactly: full-page reading, focused
review crops, independent inline-answer confirmation, deterministic validation,
and the read-only audit gate.

## Version history

- **1.1.0** — pipeline shape moved out of Customize and into this workflow:
  `INDEX_WINDOW_PAGES` (10), `BOX_PAGES_PER_CALL` (1) and `WORKER_CHUNK_ROWS`
  (6) are now executor constants, and review crops are always drawn. Each
  constant is exactly the value Customize shipped and always passed, so a run
  on default settings is byte-identical and no benchmark was needed. A tutor
  who had changed one of those four knobs converts differently from now on —
  which is the whole reason the version moved. The removal also deleted the
  no-crops figure-geometry path, which only the crops toggle could reach.
- **1.0.0** — the migrated production pipeline.

## Ownership

Gold owns its **strategy**, end to end:

- `workflow.ts` is Gold's identity *and its policy* — its render settings
  (200 DPI, pdfium re-init every 8 pages), its six request-making steps, each
  step's default model, and how Customize groups them into pickers. These are
  Gold's values to change, not shared defaults it inherits. A new mineral
  supplies its own and needs no edit to any screen.
- `PROMPTS.md` is the source of Gold's three big prompts (planner, worker,
  audit); `engine/prompts.ts` is generated from it by
  `scripts/sync-workflow-prompts.mjs`. They are **Gold's**, not the repo's —
  another mineral has its own steps and prompts, and need not have three.
  `engine/prompts.test.ts` resolves this file relative to itself, so a second
  workflow is entirely independent.
- `engine/` is Gold's complete conversion implementation: its prompts, window
  planning, reconciliation, deterministic guards, orchestration, and tests.
- `run()` is the only entry point the app calls. It loads `engine/` lazily, so
  the registry stays importable from the settings module without dragging the
  prompt strings and the pdfium WASM into every bundle.

Gold does **not** own two things, deliberately:

1. **Device and account plumbing** stays shared in `src/` — the pdfium binding,
   the measured JPEG encoder probe, the one on-device Gemini key, the per-model
   quota tally, and IndexedDB. These are facts about the machine and the user's
   Google project, not conversion strategy. Gold sets the render *policy* and
   the shared rasteriser applies it; copying the rasteriser per workflow would
   mean the next Android encoder fix has to land in every copy.
2. **The output contract** — `MergedRow` plus the run artifacts Review, export,
   backup, folders, and agent-import read. Producing that contract is what
   earns a workflow one Review screen and one working "Export to Triviadox".

A Gold behavior change increments `version` and must record benchmark results
in `benchmarks/results/` before it is released. That rule is not Gold's alone —
see [Versioning](../README.md#versioning-applies-to-every-mineral).

## Benchmark contract

Gold must remain non-inferior on the shared marked, unmarked, figure-heavy,
and separate-key benchmark cases. It may not trade answer confirmation or audit
coverage for fewer requests without an explicitly versioned experimental
workflow.
