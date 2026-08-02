import { describe, expect, it } from 'vitest'
import {
  stripEnumerationLabels,
  stripLeadingQuestionLabel,
  stripTableBlock,
} from './normalize'

describe('stripLeadingQuestionLabel', () => {
  it('strips a number with an en-dash separator', () => {
    expect(stripLeadingQuestionLabel('18– A 49-year-old woman has felt tired')).toBe(
      'A 49-year-old woman has felt tired',
    )
  })

  it('strips number-dot, number-paren, and "Q" prefixes', () => {
    expect(stripLeadingQuestionLabel('5. What is the diagnosis?')).toBe('What is the diagnosis?')
    expect(stripLeadingQuestionLabel('12) Which drug is contraindicated?')).toBe(
      'Which drug is contraindicated?',
    )
    expect(stripLeadingQuestionLabel('Q7: Choose the best next step')).toBe('Choose the best next step')
  })

  it('leaves a real leading number that is not an enumeration label', () => {
    // No separator after the number → content, not a label.
    expect(stripLeadingQuestionLabel('18 patients were enrolled in a trial')).toBe(
      '18 patients were enrolled in a trial',
    )
    expect(stripLeadingQuestionLabel('3-day history of fatigue is reported')).toBe(
      '3-day history of fatigue is reported',
    )
  })

  it('does not mistake a leading 4-digit year for a label', () => {
    expect(stripLeadingQuestionLabel('2022. In this study the outcome was')).toBe(
      '2022. In this study the outcome was',
    )
  })

  it('keeps the original when stripping would empty the prompt', () => {
    // Matches the label pattern fully; the guard returns the original rather
    // than an empty string so the empty-question flag sees the real text.
    expect(stripLeadingQuestionLabel('7. ')).toBe('7. ')
  })

  it('leaves a printed case identity ("Case 10 …") untouched', () => {
    // Not a digit-first enumeration label, so it survives — the stem keeps its
    // case number and code assembles it with the prompt.
    expect(
      stripLeadingQuestionLabel('Case 10 A 4 months-old infant presented'),
    ).toBe('Case 10 A 4 months-old infant presented')
  })
})

describe('stripTableBlock', () => {
  it('drops a GFM table but keeps the question sentence', () => {
    const question = [
      'Which environmental conditions will result in the highest rate of transpiration?',
      '| | high air humidity | very windy | low air temperature |',
      '|---|---|---|---|',
      '| A | no | no | yes |',
      '| B | no | yes | no |',
      '| C | yes | yes | yes |',
      '| D | yes | no | no |',
    ].join('\n')
    expect(stripTableBlock(question)).toBe(
      'Which environmental conditions will result in the highest rate of transpiration?',
    )
  })

  it('keeps prose that follows the table', () => {
    const question = [
      'Study the results.',
      '| x | y |',
      '| --- | --- |',
      '| 1 | 2 |',
      'Which row is correct?',
    ].join('\n')
    expect(stripTableBlock(question)).toBe(
      'Study the results.\nWhich row is correct?',
    )
  })

  it('leaves prose that merely contains a pipe untouched', () => {
    // No separator row → not a table; a stray "|" must not trigger stripping.
    const question = 'Choose p | q as the correct boolean expression.'
    expect(stripTableBlock(question)).toBe(question)
  })

  it('keeps the original when the stem was nothing but a table', () => {
    // Stripping would empty the prompt; the empty-question guard must see the
    // real text rather than a blank card.
    const question = ['| a | b |', '|---|---|', '| 1 | 2 |'].join('\n')
    expect(stripTableBlock(question)).toBe(question)
  })

  it('leaves a table-free question unchanged', () => {
    expect(stripTableBlock('What is the capital of France?')).toBe(
      'What is the capital of France?',
    )
  })
})

describe('stripEnumerationLabels', () => {
  it('strips a clean sequential "A." "B." "C." "D." set', () => {
    const result = stripEnumerationLabels([
      'A. Appendicitis',
      'B. Cholecystitis',
      'C. Pancreatitis',
      'D. Diverticulitis',
    ])
    expect(result.ambiguous).toBe(false)
    expect(result.options).toEqual([
      'Appendicitis',
      'Cholecystitis',
      'Pancreatitis',
      'Diverticulitis',
    ])
  })

  it('strips lowercase "a)" "b)" "c)" paren labels', () => {
    const result = stripEnumerationLabels(['a) Red', 'b) Green', 'c) Blue'])
    expect(result.options).toEqual(['Red', 'Green', 'Blue'])
  })

  it('strips numeric "1." "2." "3." labels', () => {
    const result = stripEnumerationLabels(['1. One', '2. Two', '3. Three'])
    expect(result.options).toEqual(['One', 'Two', 'Three'])
  })

  it('strips roman "i)" "ii)" "iii)" labels', () => {
    const result = stripEnumerationLabels(['i) First', 'ii) Second', 'iii) Third'])
    expect(result.options).toEqual(['First', 'Second', 'Third'])
  })

  it('strips parenthesised "(b)" style when the set is sequential from a', () => {
    const result = stripEnumerationLabels(['(a) Left', '(b) Right'])
    expect(result.options).toEqual(['Left', 'Right'])
  })

  it('leaves options untouched when only some carry a label', () => {
    const options = ['A. First', 'Second without a label', 'C. Third']
    expect(stripEnumerationLabels(options).options).toEqual(options)
  })

  it('leaves options untouched when labels are non-sequential', () => {
    const options = ['A. First', 'C. Second', 'B. Third']
    expect(stripEnumerationLabels(options).options).toEqual(options)
  })

  it('does not strip when the set does not start at the conventional first label', () => {
    const options = ['B. First', 'C. Second', 'D. Third']
    expect(stripEnumerationLabels(options).options).toEqual(options)
  })

  it('flags — never strips — a sequential letter set that is all species epithets (E. coli trap)', () => {
    const options = ['E. coli', 'F. tularensis', 'G. vaginalis', 'H. pylori']
    const result = stripEnumerationLabels(options)
    // These are NOT sequential from A, so they never even reach the trap —
    // but this guards the intent: real genus abbreviations survive.
    expect(result.options).toEqual(options)
  })

  it('flags a sequential A–D set whose remainders are all bare epithets', () => {
    // Constructed worst case: labels ARE sequential A/B/C/D and every
    // remainder is a lone lowercase word. Ambiguous → leave verbatim.
    const options = ['A. baumannii', 'B. cepacia', 'C. difficile', 'D. eggerthii']
    const result = stripEnumerationLabels(options)
    expect(result.ambiguous).toBe(true)
    expect(result.options).toEqual(options)
  })

  it('does not treat a single option as labelled', () => {
    expect(stripEnumerationLabels(['A. Only one']).options).toEqual([
      'A. Only one',
    ])
  })

  it('does not strip a label with no text after it', () => {
    const options = ['A.', 'B.']
    // No separating space → pattern needs "\s+"; safe either way.
    expect(stripEnumerationLabels(options).options).toEqual(options)
  })

  it('leaves an empty or unlabelled list unchanged', () => {
    expect(stripEnumerationLabels([]).options).toEqual([])
    expect(
      stripEnumerationLabels(['True', 'False']).options,
    ).toEqual(['True', 'False'])
  })
})
