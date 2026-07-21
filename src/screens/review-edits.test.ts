import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { MergedRow } from '../engine/types'
import { db } from '../state/db'
import { getArtifact, putArtifact } from '../state/runs'
import {
  applyContentEdits,
  applyMetaEdits,
  editsSetTopic,
  editsSetYear,
  getEdits,
  planEditSave,
  saveRowEdit,
  saveRowEditsPatch,
  updateAiAnswerIndex,
  type EditorOption,
} from './review-edits'

function makeRow(overrides: Partial<MergedRow> = {}): MergedRow {
  return {
    id: '1',
    group_id: '',
    topic: '',
    subtopic: '',
    year: '',
    question: 'What is the diagnosis?',
    options: ['Appendicitis', 'Cholecystitis', 'Pancreatitis'],
    correct_index: '',
    image_urls: [],
    needs_review: 'no_answer_key',
    ...overrides,
  }
}

/** Unchanged options as the editor would hold them. */
function keptOptions(row: MergedRow): EditorOption[] {
  return row.options.map((text, index) => ({ text, originalIndex: index }))
}

function formFrom(row: MergedRow, correctChoice: number | null) {
  return {
    question: row.question,
    options: keptOptions(row),
    correctChoice,
    topic: '',
    subtopic: '',
    year: '',
    imageUrls: [...row.image_urls],
  }
}

const blankBaseline = { topic: '', subtopic: '', year: '' }

beforeEach(async () => {
  await db.runArtifacts.clear()
  await db.runs.clear()
})

describe('applyContentEdits / applyMetaEdits', () => {
  it('replaces only the edited row and only the edited fields', () => {
    const rows = [makeRow({ id: '1' }), makeRow({ id: '2' })]
    const edited = applyContentEdits(rows, {
      '2': { question: 'Rewritten?', options: ['A', 'B'], correctIndex: '1' },
    })
    expect(edited[0]).toBe(rows[0])
    expect(edited[1].question).toBe('Rewritten?')
    expect(edited[1].options).toEqual(['A', 'B'])
    expect(edited[1].correct_index).toBe('1')
    expect(edited[1].image_urls).toEqual([])
  })

  it('meta edits win over whatever topic/year the rows carry', () => {
    const rows = [makeRow({ topic: 'Matched', year: '2022' })]
    const edited = applyMetaEdits(rows, {
      '1': { topic: 'Surgery', subtopic: 'Acute abdomen', year: '2023' },
    })
    expect(edited[0].topic).toBe('Surgery')
    expect(edited[0].subtopic).toBe('Acute abdomen')
    expect(edited[0].year).toBe('2023')
  })

  it('editsSetTopic / editsSetYear see only non-blank values', () => {
    expect(editsSetTopic({ '1': { topic: '' } })).toBe(false)
    expect(editsSetTopic({ '1': { subtopic: 'Hernia' } })).toBe(true)
    expect(editsSetYear({ '1': { year: '' } })).toBe(false)
    expect(editsSetYear({ '1': { year: '2024' } })).toBe(true)
  })
})

describe('planEditSave', () => {
  it('a no-change form stores nothing and leaves the answer alone', () => {
    const row = makeRow({ correct_index: '1', needs_review: '' })
    const plan = planEditSave(row, row, formFrom(row, 1), blankBaseline, undefined, undefined)
    expect(plan.edit).toBeNull()
    expect(plan.resolution).toEqual({ kind: 'keep' })
    expect(plan.aiIndex).toBeUndefined()
  })

  it('a wording fix keeps the extracted answer and its provenance', () => {
    const row = makeRow({ correct_index: '2', needs_review: '' })
    const form = formFrom(row, 2)
    form.options = form.options.map((option, index) =>
      index === 0 ? { ...option, text: 'Acute appendicitis' } : option,
    )
    const plan = planEditSave(row, row, form, blankBaseline, undefined, undefined)
    expect(plan.edit).toEqual({
      options: ['Acute appendicitis', 'Cholecystitis', 'Pancreatitis'],
    })
    expect(plan.resolution).toEqual({ kind: 'keep' })
  })

  it('removing an option above the answer shifts the extracted index', () => {
    const row = makeRow({ correct_index: '2', needs_review: '' })
    const form = formFrom(row, 1)
    form.options = form.options.filter((option) => option.originalIndex !== 0)
    const plan = planEditSave(row, row, form, blankBaseline, undefined, undefined)
    expect(plan.edit).toEqual({
      options: ['Cholecystitis', 'Pancreatitis'],
      correctIndex: '1',
    })
    // The same option is still the answer — no fresh human pick needed.
    expect(plan.resolution).toEqual({ kind: 'keep' })
  })

  it('removing the correct option blanks the answer (NEVER-GUESS)', () => {
    const row = makeRow({ correct_index: '2', needs_review: '' })
    const form = formFrom(row, null)
    form.options = form.options.filter((option) => option.originalIndex !== 2)
    const plan = planEditSave(row, row, form, blankBaseline, 2, undefined)
    expect(plan.edit).toEqual({
      options: ['Appendicitis', 'Cholecystitis'],
      correctIndex: '',
    })
    expect(plan.resolution).toEqual({ kind: 'clear' })
  })

  it('marking a different option correct is an explicit human pick', () => {
    const row = makeRow({ correct_index: '0', needs_review: '' })
    const plan = planEditSave(row, row, formFrom(row, 2), blankBaseline, undefined, undefined)
    expect(plan.edit).toBeNull()
    expect(plan.resolution).toEqual({ kind: 'set', index: 2 })
  })

  it('an added option can be marked correct', () => {
    const row = makeRow()
    const form = formFrom(row, 3)
    form.options = [...form.options, { text: 'Diverticulitis', originalIndex: null }]
    const plan = planEditSave(row, row, form, blankBaseline, undefined, undefined)
    expect(plan.edit).toEqual({
      options: ['Appendicitis', 'Cholecystitis', 'Pancreatitis', 'Diverticulitis'],
    })
    expect(plan.resolution).toEqual({ kind: 'set', index: 3 })
  })

  it('topic/subtopic/year store only when they differ from the baseline', () => {
    const row = makeRow()
    const form = {
      ...formFrom(row, null),
      topic: 'Surgery',
      subtopic: 'Match kept',
      year: '2022',
    }
    const baseline = { topic: '', subtopic: 'Match kept', year: '' }
    const plan = planEditSave(row, row, form, baseline, undefined, undefined)
    expect(plan.edit).toEqual({ topic: 'Surgery', year: '2022' })
  })

  it('remaps a cached AI answer through a structural option change', () => {
    const row = makeRow()
    const form = formFrom(row, null)
    form.options = form.options.filter((option) => option.originalIndex !== 0)
    const plan = planEditSave(row, row, form, blankBaseline, undefined, {
      index: 2,
      confidence: 'certain',
    })
    expect(plan.aiIndex).toBe(1)
  })

  it("nulls a cached AI answer whose option was removed — blank beats stale", () => {
    const row = makeRow()
    const form = formFrom(row, null)
    form.options = form.options.filter((option) => option.originalIndex !== 2)
    const plan = planEditSave(row, row, form, blankBaseline, undefined, {
      index: 2,
      confidence: 'certain',
    })
    expect(plan.aiIndex).toBeNull()
  })

  it('composes against a prior edit: originalIndex refers to displayed options', () => {
    const pristine = makeRow({ correct_index: '1', needs_review: '' })
    const current = {
      ...pristine,
      options: ['Cholecystitis', 'Pancreatitis'],
      correct_index: '0',
    }
    // The tutor now removes displayed option 0 (Cholecystitis, the answer).
    const form = {
      ...formFrom(current, null),
      options: [{ text: 'Pancreatitis', originalIndex: 1 }],
    }
    const plan = planEditSave(pristine, current, form, blankBaseline, undefined, undefined)
    expect(plan.edit).toEqual({ options: ['Pancreatitis'], correctIndex: '' })
  })
})

describe('edit storage', () => {
  it('saveRowEdit round-trips, replaces, and deletes per row', async () => {
    await saveRowEdit('run1', '1', { question: 'Edited?' })
    await saveRowEdit('run1', '2', { year: '2024' })
    expect(await getEdits('run1')).toEqual({
      '1': { question: 'Edited?' },
      '2': { year: '2024' },
    })
    await saveRowEdit('run1', '1', null)
    expect(await getEdits('run1')).toEqual({ '2': { year: '2024' } })
  })

  it('updateAiAnswerIndex moves only the index, keeping confidence', async () => {
    await putArtifact({
      runId: 'run1',
      kind: 'ai-answers',
      json: {
        answers: {
          '1': { index: 2, confidence: 'certain' },
          '2': { index: 0, confidence: 'likely' },
        },
        solvedAt: 1,
      },
    })
    await updateAiAnswerIndex('run1', '1', null)
    const artifact = await getArtifact('run1', 'ai-answers')
    expect(artifact?.json).toMatchObject({
      answers: {
        '1': { index: null, confidence: 'certain' },
        '2': { index: 0, confidence: 'likely' },
      },
    })
  })

  it('updateAiAnswerIndex is a no-op when nothing is cached', async () => {
    await updateAiAnswerIndex('run1', '1', 0)
    expect(await getArtifact('run1', 'ai-answers')).toBeUndefined()
  })
})

describe('saveRowEditsPatch', () => {
  it('applies a patch to many rows in one write, trimming values', async () => {
    await saveRowEditsPatch('run1', {
      '1': { topic: 'Surgery', year: '2023' },
      '2': { topic: '  Anatomy  ' },
    })
    expect(await getEdits('run1')).toEqual({
      '1': { topic: 'Surgery', year: '2023' },
      '2': { topic: 'Anatomy' },
    })
  })

  it('merges into an existing edit without wiping content fields', async () => {
    await saveRowEdit('run1', '1', { question: 'Kept?', options: ['A', 'B'] })
    await saveRowEditsPatch('run1', { '1': { topic: 'Surgery' } })
    expect(await getEdits('run1')).toEqual({
      '1': { question: 'Kept?', options: ['A', 'B'], topic: 'Surgery' },
    })
  })

  it('leaves absent fields untouched but clears a field set to empty', async () => {
    await saveRowEdit('run1', '1', { topic: 'Surgery', subtopic: 'Hernia', year: '2023' })
    // Only year is in the patch, and it clears; topic/subtopic stay.
    await saveRowEditsPatch('run1', { '1': { year: '' } })
    expect(await getEdits('run1')).toEqual({
      '1': { topic: 'Surgery', subtopic: 'Hernia' },
    })
  })

  it('removes a row whose edit becomes empty after clearing', async () => {
    await saveRowEdit('run1', '1', { topic: 'Surgery' })
    await saveRowEditsPatch('run1', { '1': { topic: '   ' } })
    expect(await getEdits('run1')).toEqual({})
  })

  it('creates the artifact on first write', async () => {
    expect(await getArtifact('run1', 'review-edits')).toBeUndefined()
    await saveRowEditsPatch('run1', { '1': { subtopic: 'Acute abdomen' } })
    expect(await getEdits('run1')).toEqual({ '1': { subtopic: 'Acute abdomen' } })
  })
})
