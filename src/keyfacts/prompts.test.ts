import { describe, expect, it } from 'vitest'
import {
  buildFactsUserMessage, cardProblems, NEW_FACT_ID_BASE, parseCardsReply, parseFactsReply, parseReconcileReply,
} from './prompts'

describe('key fact prompt', () => {
  it('lays questions out exactly like Triviadox\'s generator', () => {
    const text = buildFactsUserMessage(
      [{ question: 'Most common cause?', options: ['A', 'B'], correctIndex: 1 }],
      [{ id: 7, text: 'Fact seven.' }],
    )
    expect(text).toBe([
      'EXISTING key facts for this subtopic (id. text):',
      '7. Fact seven.',
      '',
      'QUESTIONS (* marks the correct option):',
      '1. Most common cause?\n- A\n* B\nCorrect: "B"',
    ].join('\n'))
    expect(buildFactsUserMessage([], [])).toContain('(none yet for this subtopic)')
  })

  it('names attached images by question', () => {
    expect(buildFactsUserMessage([], [], ['Image 1: Question 2'])).toMatch(/ATTACHED IMAGES, in order:\nImage 1: Question 2$/)
  })
})

describe('key fact reply', () => {
  const known = new Set([7, NEW_FACT_ID_BASE])

  it('keeps matches to known ids and new facts by index', () => {
    const r = parseFactsReply('```json\n{"newFacts":["  A  new fact. "],"results":[{"q":1,"matchId":7},{"q":2,"newIndex":0},{"q":3,"matchId":1000000000}]}\n```', 3, known)
    expect(r.newFacts).toEqual(['A new fact.'])
    expect(r.links).toEqual([{ q: 1, matchId: 7 }, { q: 2, newIndex: 0 }, { q: 3, matchId: NEW_FACT_ID_BASE }])
  })

  it('drops invented ids, bad indices, out-of-range and repeated questions', () => {
    const r = parseFactsReply('{"newFacts":["x"],"results":[{"q":1,"matchId":99},{"q":2,"newIndex":4},{"q":9,"newIndex":0},{"q":3,"newIndex":0},{"q":3,"matchId":7}]}', 3, known)
    expect(r.links).toEqual([{ q: 3, newIndex: 0 }])
  })

  it('survives a reply that is not JSON', () => {
    expect(parseFactsReply('Sorry, I cannot.', 2, known)).toEqual({ newFacts: [], links: [] })
  })
})

describe('reconcile reply', () => {
  it('maps candidates to site facts it was shown, once each', () => {
    const m = parseReconcileReply('{"same":[{"candidate":1,"matchId":50},{"candidate":2,"matchId":999},{"candidate":1,"matchId":51},{"candidate":5,"matchId":50}]}', 2, new Set([50, 51]))
    expect([...m]).toEqual([[0, 50]])
  })
})

describe('flashcards', () => {
  it('reads cards, skips and both reply shapes', () => {
    const wrapped = parseCardsReply('{"cards":[{"id":1,"q":"Which nerve?","a":"Median nerve","e":""},{"id":2,"skip":true}]}', [1, 2, 3])
    expect(wrapped.get(1)).toEqual({ kind: 'card', card: { front: 'Which nerve?', back: 'Median nerve', extra: '' } })
    expect(wrapped.get(2)).toEqual({ kind: 'skip' })
    expect(wrapped.get(3)).toEqual({ kind: 'dropped', reason: 'missing from the reply' })
    expect(parseCardsReply('[{"id":4,"q":"Q?","a":"A"}]', [4]).get(4)?.kind).toBe('card')
  })

  it('drops cards that break the owner\'s rules', () => {
    expect(cardProblems({ front: 'Which drug, allopurinol, prevents it?', back: 'Allopurinol', extra: '' })).toContain('answer is in the question')
    expect(cardProblems({ front: 'Why is mesh infected?', back: 'Foreign body', extra: '' })).toContain('"why" question')
    expect(cardProblems({ front: 'Besides X and Y, what else?', back: 'Z', extra: '' })).toContain('"besides…" list question')
    expect(cardProblems({ front: 'Is it red?', back: 'Yes', extra: '' })).toContain('yes/no question')
    expect(cardProblems({ front: 'Which?', back: 'one two three four five six', extra: '' })).toContain('answer over 5 words')
    expect(cardProblems({ front: 'What causes acute monoarthritis classically?', back: 'Crystal arthropathy', extra: 'e.g. gout' })).toEqual([])
  })
})
