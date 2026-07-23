# agent-conversion

Convert exam documents with a **strong** model instead of the small Gemini
models Codox's built-in engine has to use, then import the result into the app.

Codox's engine is capped by what a free Gemini key can drive at volume. A
coding agent — Claude, GPT, Gemini, whichever you have — is far more capable,
and can do the one thing the engine cannot: crop a figure, look at the crop,
and fix it. This folder is the workflow for that.

## Use it

1. **Drop a folder of exam PDFs** into `input/`. An answer key can sit beside
   its exam as `<exam>-key.pdf`, or in a `keys/` subfolder.

2. **Prepare** — renders every page at the app's own 200 DPI and scaffolds the
   output:

   ```
   npm run agent:prepare -- agent-conversion/input/<your-folder>
   ```

3. **Point your agent at it.** Anything works; they all read
   [AGENTS.md](AGENTS.md), which is the actual protocol.

   | Agent | How |
   |---|---|
   | Claude Code | **`/convert <folder>`** — the skill in `.claude/skills/convert/` drives the whole thing |
   | Codex / other `AGENTS.md`-aware CLIs | *"Convert agent-conversion/output/&lt;folder&gt; following agent-conversion/AGENTS.md"* — they pick up `AGENTS.md` on their own |
   | Gemini CLI, or a chat model | paste `AGENTS.md`, `FORMAT.md`, and `QUALITY.md` in first, then the same instruction |

   Steps 1 and 2 can be folded into the agent's own run — `/convert` will
   prepare the bundle itself if you have not.

4. **Import.** In Codox open **Folders → Import agent folder** and pick
   `agent-conversion/output/<your-folder>`. Everything lands in the normal
   Review screen: questions, options, pictures, answers, topics. Export to
   Triviadox as usual.

## What ends up in `output/`

```
output/<batch>/<exam>/
  exam.json          the questions, options, answers, figures  (the agent writes this)
  exam.pdf           a copy of the source
  pages/*.jpg        every page at 200 DPI
  images/*.jpg       the cropped figures
  NOTES.md           the agent's report on what it did
```

## Commands

```
npm run agent:prepare  -- <input-folder>                           scaffold a bundle
npm run agent:crop     -- <exam-dir> <page> <ymin> <xmin> <ymax> <xmax> [--out images/fig-01.jpg]
npm run agent:validate -- [batch-dir]                              check before importing
```

`agent:validate` runs the *same* validator the app runs, so a bundle that
passes here cannot be rejected on import.

## Two things worth knowing

- **Answers are labelled by where they came from.** An answer the agent *read
  off the page* fills the question. An answer it *worked out* is offered to you
  in Review as a suggestion and stays blank until you approve it. Codox never
  ships a guessed answer, no matter which model produced it.
- **`input/` and `output/` are gitignored**, so exam documents and student work
  can never be committed by accident.
