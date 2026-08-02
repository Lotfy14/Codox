# Workflows

A **workflow** is a complete, named strategy for turning an exam PDF into
Codox questions. Workflows are named after minerals. **Gold** is the original,
verified one.

The point of the split is that a workflow can differ in *how it reads a
document* — how many pages it renders and at what fidelity, how many model
calls it makes and in what order, what its prompts say, how it decides an
answer — while everything downstream of it stays the same. One Review screen,
one Export button, one backup format, for every mineral.

## The three tiers

Getting a change into the right tier is the whole design. When adding
something, ask which of these it is.

### 1. Workflow-owned — put strategy here

`workflows/<Mineral>/` owns:

- **Render policy** — DPI, pdfium re-init cadence, which pages, page order.
- **Steps and models** — which steps make requests, each step's default model,
  and how Customize groups them into pickers.
- **Prompts** — its own, in whatever number it wants.
- **The pipeline** — stages, reconciliation, guards, merge, audit, and the
  stop reasons it invents.
- **`run()`** — the single entry point the app calls.

A new mineral needs **no edit to any screen**. Customize renders the steps and
pickers the workflow declares.

### 2. Shared plumbing — do NOT copy this per workflow

These are facts about the machine and the user's account, not strategy:

| Thing | Where | Why it stays shared |
|---|---|---|
| pdfium binding, JPEG encoder probe | `src/pdf/` | The encoder choice is a *measured device fact* (see CLAUDE.md's numbers). Copying it means the next Android fix has to land in every copy. |
| The one Gemini key | `src/state/credentials.ts` | One key per installation is a hard rule. |
| Per-model quota tally | `src/state/quota.ts` | The free tier is per Google project per model. Separate counters would both under-report the same budget. |
| IndexedDB, backup/restore | `src/state/` | One storage schema, one backup format. |

A workflow sets render *policy*; the shared rasteriser applies it.

### 3. The output contract — what every workflow must produce

Written out in full, with the CSV schema and the coordinate rule, in
[Docs/OUTPUT_CONTRACT.md](../Docs/OUTPUT_CONTRACT.md). In short:

- **`ExamQuestion[]`** written to the `merged-rows` artifact. This is the unit
  Review, editing, topic matching, export, and backup all operate on.
- **`crop`** artifacts for anything a row names in `image_urls`.
- **`page-jpeg`** artifacts, so Review can show the source page.

That is the whole contract. Everything else a workflow writes
(`blueprint-raw`, `index-window`, `chunk-request`, …) is its own private
checkpoint — nothing outside it reads those, and `backup.ts` already archives
only the shared kinds.

Note it is deliberately wider than "just the CSV". Export never reads the
`csv` artifact — `export-csv.ts` re-projects columns from `merged-rows` per the
tutor's Customize settings — and Review works on `ExamQuestion`. A CSV-only
contract would leave Review nothing to render.

Also **not** a workflow's output: `review-resolutions`, `review-edits`,
`ai-answers`, `topics-list`, `topic-matches`. Review and the topic matcher
write those themselves, after the run.

## Adding a mineral

1. `workflows/<Mineral>/workflow.ts` — export a `WorkflowDefinition`
   (`../types.ts`) with its render policy, model policy, and `run()`.
   **Load the engine lazily inside `run`**: `registry.ts` is reachable from the
   widely-imported settings module, and a static engine import there drags
   every prompt string and the pdfium WASM into the main bundle.
2. Add it to `WORKFLOWS` in `registry.ts`. It appears in Customize
   automatically.
3. `workflows/<Mineral>/PROMPTS.md` if it wants generated prompts, plus its own
   `prompts.test.ts` freshness check. Optional — a workflow may keep its
   prompts inline instead.
4. Write to the output contract above, and nothing else.
5. Benchmark it against Gold on the shared corpus (`benchmarks/`) before
   marking it `status: 'verified'`.

Everything a workflow persists carries its id on the run
(`RunState.workflowId`), so a stored run always says which strategy made it.

## Where a workflow's docs go

A mineral's own docs live in its folder, not in `Docs/`. Gold's are the
template:

| File | What it is |
|---|---|
| [Gold/README.md](Gold/README.md) | what the strategy is, in short |
| [Gold/ENGINE.md](Gold/ENGINE.md) | its pipeline semantics — roles, steps, validation, merge rules |
| [Gold/PROMPTS.md](Gold/PROMPTS.md) | its generated prompts |
| [Gold/ANSWER_LAYOUTS.md](Gold/ANSWER_LAYOUTS.md) | what its stages measured on real documents |

`Docs/` holds only what is true across every mineral: the product context, the
output contract, releasing, and the shared UI behaviour.

## Status

**Gold** — `status: 'verified'`, the production strategy. See
[Gold/README.md](Gold/README.md).

No second workflow exists yet. Until one does, the registry has one entry and
the Customize picker shows one option; the seam is real and dispatches, but it
has never been exercised by a second implementation. Treat the tier boundaries
above as designed-but-unproven where a second mineral would test them.
