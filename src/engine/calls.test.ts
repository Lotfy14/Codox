import { describe, expect, it } from 'vitest'
import { buildBoxBatchRequest, buildBoxRequest, type BoxFigureHint, type BoxTaskRef } from './calls'
import { BOX_PROMPT } from './prompts'

const image = { mimeType: 'image/jpeg', base64Data: 'AAAA' }

function task(ref: string): BoxTaskRef {
  return {
    ref,
    printedLabel: ref,
    anchor: `anchor ${ref}`,
    optionsPresent: true,
    hasCase: false,
    hasInlineEvidence: false,
  }
}

function promptOf(request: ReturnType<typeof buildBoxRequest>): string {
  return request.prompt
}

/**
 * FIGURE DETECT's findings used to be parsed and thrown away, so its far more
 * aggressive figure detection never reached BOX and questions shipped without
 * their picture. These lock in that the hints travel, and that they never
 * disturb the SHA-pinned prompt text.
 */
describe('BOX figure hints', () => {
  const hints: BoxFigureHint[] = [
    { page: 1, anchor: 'A rhythm strip of lead II shows', linked_refs: ['w0q2'] },
  ]

  it('appends detected figures to a single-page BOX request', () => {
    const prompt = promptOf(buildBoxRequest([image], [task('w0q2')], undefined, hints))
    expect(prompt).toContain('FIGURES ALREADY DETECTED')
    expect(prompt).toContain('A rhythm strip of lead II shows')
    expect(prompt).toContain('w0q2')
  })

  it('appends detected figures to a batched BOX request', () => {
    const prompt = promptOf(
      buildBoxBatchRequest([image, image], [{ ...task('w0q2'), page: 2 }], undefined, hints),
    )
    expect(prompt).toContain('FIGURES ALREADY DETECTED')
    expect(prompt).toContain('A rhythm strip of lead II shows')
  })

  it('leaves the request byte-identical when nothing was detected', () => {
    const withNone = promptOf(buildBoxRequest([image], [task('w0q2')], undefined, []))
    const withoutArg = promptOf(buildBoxRequest([image], [task('w0q2')]))
    expect(withNone).toBe(withoutArg)
    expect(withNone).not.toContain('FIGURES ALREADY DETECTED')
  })

  it('keeps the pinned BOX prompt text intact ahead of the code-owned payload', () => {
    const prompt = promptOf(buildBoxRequest([image], [task('w0q2')], undefined, hints))
    expect(prompt.startsWith(BOX_PROMPT)).toBe(true)
  })
})
