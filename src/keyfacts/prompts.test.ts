import { describe, expect, it } from 'vitest'
import {
  buildFactsUserMessage, cardProblems, NEW_FACT_ID_BASE, parseCardsReply, parseFactsReply, parseReconcileReply,
} from './prompts'
import contract1Reply from './fixtures/contract1-reply.txt?raw'
import contract2FusedTests from './fixtures/contract2-fused-tests.txt?raw'
import contract2SecondResultsKey from './fixtures/contract2-second-results-key.txt?raw'
import contract2SkipsAQuestion from './fixtures/contract2-skips-a-question.txt?raw'

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

/** Questions that share a fact, as sorted groups: by matchId, or by the new fact's text. */
function sharedGroups(r: ReturnType<typeof parseFactsReply>): number[][] {
  const by = new Map<string, number[]>()
  for (const l of r.links) {
    const key = 'matchId' in l ? `id:${l.matchId}` : `new:${r.newFacts[l.newIndex].toLowerCase()}`
    by.set(key, [...(by.get(key) ?? []), l.q])
  }
  return [...by.values()].filter((g) => g.length > 1).map((g) => g.sort((a, b) => a - b))
}

const answered = (r: ReturnType<typeof parseFactsReply>) => r.links.map((l) => l.q).sort((a, b) => a - b)
const unanswered = (r: ReturnType<typeof parseFactsReply>, n: number) => {
  const got = new Set(answered(r))
  return Array.from({ length: n }, (_, i) => i + 1).filter((q) => !got.has(q))
}

// Real Flash-Lite replies from the key-fact lab (C:\Users\dramr\triviadox-keyfacts-lab\debug),
// each the first request of its subtopic, so no fact existed yet. The expected
// numbers are what the lab's parser (run.mjs, the reference for contract 2) made of them.
describe('key fact reply: real replies', () => {
  const none = new Set<number>()

  it('contract 1: reads newFacts/newIndex and drops matchIds it never showed', () => {
    const r = parseFactsReply(contract1Reply, 25, none)
    expect(r.links).toHaveLength(21)
    expect(unanswered(r, 25)).toEqual([3, 22, 24, 25])
    expect(sharedGroups(r)).toEqual([[4, 10, 11], [16, 21]])
  })

  it('contract 2: an inline fact per question; invented ids are dropped, known ones kept', () => {
    const r = parseFactsReply(contract2SkipsAQuestion, 40, none)
    expect(r.links).toHaveLength(32)
    expect(r.newFacts).toHaveLength(32)
    expect(unanswered(r, 40)).toEqual([6, 22, 32, 33, 34, 35, 37, 40])
    const ids = new Set([1, 4, 8, 9, 10, 21, 27])
    expect(parseFactsReply(contract2SkipsAQuestion, 40, ids).links).toHaveLength(40)
  })

  it('contract 2: repairs "tests":"sameAs":N and follows sameAs to the earlier question', () => {
    expect(contract2FusedTests).toMatch(/"tests":"sameAs":9/)
    const r = parseFactsReply(contract2FusedTests, 32, none)
    expect(r.links).toHaveLength(32)
    expect(r.newFacts).toHaveLength(22)
    expect(sharedGroups(r)).toEqual([[2, 17, 20, 26], [4, 32], [8, 19, 22], [9, 11], [12, 16], [18, 28], [21, 25]])
  })

  it('contract 2: one broken item costs that question only', () => {
    const broken = contract2FusedTests.replace(/("q":1,[^}]*"fact":")/, '$1"')
    expect(() => JSON.parse(broken)).toThrow()
    const r = parseFactsReply(broken, 32, none)
    expect(unanswered(r, 32)).toEqual([1])
    expect(sharedGroups(r)).toEqual([[2, 17, 20, 26], [4, 32], [8, 19, 22], [9, 11], [12, 16], [18, 28], [21, 25]])
  })

  it('contract 2: keeps the complete items of a reply cut off mid-way', () => {
    const cut = contract2FusedTests.slice(0, contract2FusedTests.indexOf('{"q":18,') + 60)
    expect(cut).not.toMatch(/"q":18,[^}]*}/)
    expect(answered(parseFactsReply(cut, 32, none))).toEqual(Array.from({ length: 17 }, (_, i) => i + 1))
  })

  it('contract 2: a second, empty "results" key does not wipe out the first (the lab lost all 40)', () => {
    expect(JSON.parse(contract2SecondResultsKey.replace(/\s*```$/, '')).results).toEqual([])
    const r = parseFactsReply(contract2SecondResultsKey, 40, none)
    expect(r.links).toHaveLength(40)
  })
})

describe('key fact reply: contract 2 rules', () => {
  const known = new Set([7, NEW_FACT_ID_BASE + 3])

  it('reads a fact that is only a number as a matchId, never as a sentence', () => {
    const r = parseFactsReply(
      '{"results":[{"q":1,"tests":"t","fact":"1000000003"},{"q":2,"tests":"t","fact":7},{"q":3,"tests":"t","fact":" 99 "}]}', 3, known)
    expect(r.links).toEqual([{ q: 1, matchId: NEW_FACT_ID_BASE + 3 }, { q: 2, matchId: 7 }])
    expect(r.newFacts).toEqual([])
  })

  it('shares one entry between questions with the same fact text', () => {
    const r = parseFactsReply(
      '{"results":[{"q":1,"fact":"Same  point."},{"q":2,"fact":"same point."},{"q":3,"fact":"Other."}]}', 3, known)
    expect(r.newFacts).toEqual(['Same point.', 'Other.'])
    expect(r.links).toEqual([{ q: 1, newIndex: 0 }, { q: 2, newIndex: 0 }, { q: 3, newIndex: 1 }])
  })

  it('follows sameAs only to a question already answered earlier in the reply', () => {
    const r = parseFactsReply(JSON.stringify({ results: [
      { q: 1, matchId: 7 },
      { q: 2, sameAs: 1 },
      { q: 3, sameAs: 4 },
      { q: 4, fact: 'Four.' },
      { q: 5, sameAs: 5 },
      { q: 6, sameAs: 9 },
    ] }), 6, known)
    expect(r.links).toEqual([{ q: 1, matchId: 7 }, { q: 2, matchId: 7 }, { q: 4, newIndex: 0 }])
  })

  it('drops empty facts, unknown ids, out-of-range and repeated questions', () => {
    const r = parseFactsReply(JSON.stringify({ results: [
      { q: 1, tests: 't', fact: '   ' },
      { q: 2, tests: 't', matchId: 99 },
      { q: 0, fact: 'Zero.' },
      { q: 4, fact: 'Four.' },
      { q: 3, fact: 'Three.' },
      { q: 3, fact: 'Three again.' },
    ] }), 3, known)
    expect(r.links).toEqual([{ q: 3, newIndex: 0 }])
    expect(r.newFacts).toEqual(['Three.'])
  })

  it('takes a reply that mixes both contracts', () => {
    const r = parseFactsReply('{"newFacts":["Listed."],"results":[{"q":1,"newIndex":0},{"q":2,"fact":"Inline."},{"q":3,"sameAs":2}]}', 3, known)
    expect(r.newFacts).toEqual(['Listed.', 'Inline.'])
    expect(r.links).toEqual([{ q: 1, newIndex: 0 }, { q: 2, newIndex: 1 }, { q: 3, newIndex: 1 }])
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
    expect(cardProblems({ front: 'Which nerve is not contained within the spermatic cord?', back: 'Iliohypogastric nerve', extra: '' })).toContain('asks which one is not')
    expect(cardProblems({ front: 'All are branches of the celiac trunk except?', back: 'Inferior mesenteric', extra: '' })).toContain('asks which one is not')
    expect(cardProblems({ front: 'Multiple-dose activated charcoal is ineffective for eliminating which mood stabiliser?', back: 'Lithium', extra: '' })).toEqual([])
    expect(cardProblems({ front: 'Which?', back: 'one two three four five six', extra: '' })).toContain('answer over 5 words')
    expect(cardProblems({ front: 'What causes acute monoarthritis classically?', back: 'Crystal arthropathy', extra: 'e.g. gout' })).toEqual([])
  })
})
