import { describe, expect, it } from 'vitest'
import { answerDirective, buildWorkerRequest, WORKER_MODEL } from './calls'
import { buildReducedBlueprint } from './blueprint'
import { makeBlueprint, makeEvidenceBlueprint } from './fixtures'
import { WORKER_PROMPT } from './prompts'

const reduced = (evidence: boolean) => {
  const blueprint = evidence ? makeEvidenceBlueprint() : makeBlueprint()
  return buildReducedBlueprint(blueprint, blueprint.planned_rows)
}

describe('answerDirective', () => {
  it('names exactly the rows it was given', () => {
    expect(answerDirective(['3', '7'])).toContain('these rows only): 3, 7')
  })

  it('permits a blank answer and bans subject knowledge', () => {
    // NEVER-GUESS lives in this text: "always look" must never become
    // "always fill", or an unreadable mark becomes an invented index.
    const text = answerDirective(['1'])
    expect(text).toContain('return "" for that row')
    expect(text).toContain('Never infer an answer from')
    expect(text).toContain('subject knowledge')
    expect(text).toContain('never fill a row to avoid leaving it empty')
  })
})

describe('buildWorkerRequest', () => {
  it('appends the directive after the pinned prompt, never inside it', () => {
    const request = buildWorkerRequest(reduced(true), [], WORKER_MODEL, undefined, ['1', '2'])
    expect(request.prompt.startsWith(WORKER_PROMPT)).toBe(true)
    expect(request.prompt).toContain('ANSWER EXTRACTION')
    expect(request.prompt.indexOf('ANSWER EXTRACTION')).toBeGreaterThan(
      WORKER_PROMPT.length,
    )
  })

  it('adds nothing at all when no row permits an answer', () => {
    // A document with no marks must produce byte-identical requests to
    // before the directive existed.
    const package_ = reduced(false)
    const withEmpty = buildWorkerRequest(package_, [], WORKER_MODEL, undefined, [])
    const withNone = buildWorkerRequest(package_, [], WORKER_MODEL)
    expect(withEmpty.prompt).toBe(withNone.prompt)
    expect(withEmpty.prompt).not.toContain('ANSWER EXTRACTION')
  })

  it('keeps the retry error and the directive both present', () => {
    const request = buildWorkerRequest(
      reduced(true), [], WORKER_MODEL, 'row "1": bad options', ['1'],
    )
    expect(request.prompt).toContain('ANSWER EXTRACTION')
    expect(request.prompt).toContain('VALIDATION ERROR: row "1": bad options')
  })
})
