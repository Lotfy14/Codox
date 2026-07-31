# sample

Drop your exam PDFs straight into this folder — as many as you like, one
bundle per PDF. Then run the two steps below.

```
sample/
  exam-one.pdf
  exam-two.pdf
  exam-two-key.pdf      <- optional answer key, matched to exam-two.pdf by name
  keys/
    exam-one.pdf        <- or put keys here instead; anything in keys/ is a key
```

## Answer keys are optional

A key is matched to its exam by name. Any of these work:

- `<exam>-key.pdf`, `<exam> key.pdf`, `<exam>-answers.pdf`
- anything inside `keys/` (matched to the exam with the same stem)
- a Cambridge mark scheme `..._ms_NN.pdf` beside its paper `..._qp_NN.pdf`

No key is fine — answers marked on the exam's own pages are read off the page,
and anything the agent works out from knowledge lands in Review as a suggestion
you approve, never as a shipped answer.

## Run it

```
npm run agent:prepare -- sample
```

renders every page at 200 DPI into `agent-conversion/output/sample/<exam>/`,
then point an agent at it:

| Agent | How |
|---|---|
| Claude Code | `/convert sample` (it will prepare for you if you skipped the step above) |
| Codex / other `AGENTS.md`-aware CLIs | *"Convert agent-conversion/output/sample following agent-conversion/AGENTS.md"* |

Then check and import:

```
npm run agent:validate -- agent-conversion/output/sample
```

and in Codox open **Folders → Import agent folder** and pick
`agent-conversion/output/sample`.

The PDFs you drop here are gitignored (only this README is tracked), so exam
documents can never be committed by accident.
