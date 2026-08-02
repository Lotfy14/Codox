import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AUDIT_PROMPT, PLANNER_PROMPT, WORKER_PROMPT } from './prompts'

/**
 * GOLD's three big prompts are GENERATED from `workflows/Gold/PROMPTS.md`
 * into `prompts.ts`. This test guards the one bug that generation invites:
 * editing the doc and forgetting to re-run the generator, so the app keeps
 * silently running the OLD prompt while the doc shows the new one.
 *
 * It is a freshness check, not a lock. Gold's prompts are Gold's to change —
 * edit PROMPTS.md, run `node scripts/sync-workflow-prompts.mjs Gold`, done. What
 * proves a change is good is a benchmark run on real documents, never a
 * checksum. (SHA-256 pins lived here until 2026-08-02; they only restated what
 * the byte-equality check below already proves, at the cost of a three-place
 * ritual per edit.)
 *
 * The source file is resolved relative to THIS test, not the repo root: these
 * prompts belong to Gold, and another workflow generates (or does not
 * generate) its own.
 */

/** `workflows/Gold/PROMPTS.md` — the workflow's own prompt source of truth. */
const PROMPTS_DOC = join(dirname(fileURLToPath(import.meta.url)), '..', 'PROMPTS.md')

function extractDocBlocks(): string[] {
  const doc = readFileSync(PROMPTS_DOC, 'utf8')
  return [...doc.matchAll(/```text\r?\n([\s\S]*?)\r?\n```/g)].map((match) =>
    match[1].replace(/\r\n/g, '\n'),
  )
}

describe('Gold prompt fidelity', () => {
  it("Gold's PROMPTS.md still contains exactly three prompt blocks", () => {
    expect(extractDocBlocks()).toHaveLength(3)
  })

  it('code constants equal the doc blocks byte-for-byte', () => {
    // The real guard: fails when PROMPTS.md was edited without re-running the
    // generator, which would otherwise ship the stale prompt in silence.
    const [planner, worker, audit] = extractDocBlocks()
    expect(PLANNER_PROMPT).toBe(planner)
    expect(WORKER_PROMPT).toBe(worker)
    expect(AUDIT_PROMPT).toBe(audit)
  })

  it('the planner final_format keeps its literal backslash-n', () => {
    // "\n" inside the prompt's final_format is two characters, not a
    // newline — the #1 way a retyped prompt would silently drift.
    expect(PLANNER_PROMPT).toContain(
      '"Case stem: {case_stem}\\nQuestion: {question_prompt}"',
    )
  })

  it('strictly requires question-linked image discovery and precise boxes', () => {
    expect(PLANNER_PROMPT).toContain('it MUST appear once in assets')
    expect(PLANNER_PROMPT).toContain('Never reuse a')
    expect(PLANNER_PROMPT).toContain('If the PDF has no question-linked visuals')
  })
})
