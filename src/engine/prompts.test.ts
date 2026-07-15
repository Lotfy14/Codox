import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AUDIT_PROMPT,
  PLANNER_PROMPT,
  PROMPT_SHA256,
  WORKER_PROMPT,
} from './prompts'

/**
 * The prompts migrate byte-for-byte from CODOX_MIGRATION.md §2 and must
 * never drift — in either direction. This test (a) re-extracts the three
 * ```text blocks from the doc and requires exact equality with the code
 * constants, and (b) pins SHA-256 hashes so an edit to the DOC is caught
 * just as loudly as an edit to the code.
 */

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function extractDocBlocks(): string[] {
  const doc = readFileSync(
    join(process.cwd(), 'Docs', 'CODOX_MIGRATION.md'),
    'utf8',
  )
  return [...doc.matchAll(/```text\r?\n([\s\S]*?)\r?\n```/g)].map((match) =>
    match[1].replace(/\r\n/g, '\n'),
  )
}

describe('prompt migration fidelity', () => {
  it('the doc still contains exactly three prompt blocks', () => {
    expect(extractDocBlocks()).toHaveLength(3)
  })

  it('code constants equal the doc blocks byte-for-byte', () => {
    const [planner, worker, audit] = extractDocBlocks()
    expect(PLANNER_PROMPT).toBe(planner)
    expect(WORKER_PROMPT).toBe(worker)
    expect(AUDIT_PROMPT).toBe(audit)
  })

  it('hashes are pinned at their migration-time values', () => {
    expect(sha256(PLANNER_PROMPT)).toBe(PROMPT_SHA256.planner)
    expect(sha256(WORKER_PROMPT)).toBe(PROMPT_SHA256.worker)
    expect(sha256(AUDIT_PROMPT)).toBe(PROMPT_SHA256.audit)
    expect(PROMPT_SHA256.planner).toBe(
      '550503d8db2aa20626bb3f9627f053f603e52bac524abb617ba5295dd9eadb8d',
    )
    expect(PROMPT_SHA256.worker).toBe(
      '912e103f84d47c59987e4c5b59cd5290a03fc5bc25b017dff9777c96e91d2608',
    )
    expect(PROMPT_SHA256.audit).toBe(
      '7bedae91c172cc5f071c31aa5839aef3e769a1c5c24c4e596079dad04ce2c6ce',
    )
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
