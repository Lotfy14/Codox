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

## Versioning (applies to every mineral)

**Any change to a workflow's behavior increments its `version`.** That means
`workflow.ts` and the `**Version:**` line in its README, in the same commit as
the change. A prompt edit, a merge or validation rule, a window size, a model
default — all behavior. Only edits that cannot change a single output row
(comments, docs, tests, renames) may leave the version alone.

The version is not decoration: `benchmarks/results/` files are keyed by
`workflow` plus `version`, so two runs that disagree are only comparable when
the number moved. Leaving it still silently re-labels the old measurements as
describing the new code.

A change that can alter output must record what it measured in
`benchmarks/results/`, naming the documents it ran on. One document is a data
point, not a benchmark — say which it was.

A change that provably cannot alter output — a knob removed at exactly its
shipped default, a pure refactor — still increments the version, because the
number is what keeps old results attached to the code they described. It
records why no measurement was needed in the workflow's version history
instead of adding an empty results file.

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

**Gypsum** — `status: 'experimental'`, the IGCSE MCQ strategy. See
[Gypsum/README.md](Gypsum/README.md). It aggressively preserves diagrams,
graphs, tables, and graphical answer choices and remains experimental until it
clears the three-paper gate in [Gypsum/ENGINE.md](Gypsum/ENGINE.md).

**Gold** — `status: 'verified'`, the production strategy. See
[Gold/README.md](Gold/README.md).

**Pyrite** — `status: 'experimental'`, the low-request strategy. See
[Pyrite/README.md](Pyrite/README.md). It is registered and selectable in
Customize, it is not the default, and it has not cleared the benchmark gate in
[Pyrite/ENGINE.md](Pyrite/ENGINE.md).

Pyrite is what now exercises the seam: it dispatches through the registry,
declares its own render and model policy, and writes the shared output
contract, so Review and export work on its runs unchanged. The tier boundaries
above are therefore no longer untested — but Pyrite reuses several of Gold's
engine modules (`csv`, `json`, `boxes`, `concurrency`, `types`), so the line
between workflow-owned and shared has been walked rather than proven.
