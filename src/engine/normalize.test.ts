import { describe, expect, it } from 'vitest'
import { stripEnumerationLabels } from './normalize'

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
