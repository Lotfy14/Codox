import { describe, expect, it } from 'vitest'
import { validBox, pixelBox } from './boxes'
import { emitCsv } from './csv'
import { modelJson } from './json'
import { dedupeCoreQuestions, parseCropCheck, repairPreservesFigureCounts } from './executor'
import { buildReviewBlueprint } from './blueprint'
import type { PageExtraction } from './types'

describe('Gypsum-owned primitives', () => {
  it('parses fenced model JSON without another workflow parser', () => {
    expect(modelJson('```json\n{"questions":[]}\n```')).toEqual({ questions: [] })
  })

  it('validates and converts normalized boxes', () => {
    const box = [100, 200, 300, 500] as const
    expect(validBox(box)).toBe(true)
    expect(pixelBox(box, 1000, 2000)).toEqual({ x: 200, y: 200, width: 300, height: 400 })
    expect(pixelBox(box, 1000, 2000, 20)).toEqual({ x: 180, y: 160, width: 340, height: 480 })
  })

  it('writes the shared CSV contract independently', () => {
    const csv = emitCsv([{ id: '1', topic: '', subtopic: '', year: '2023', question: 'Which, one?', options: ['A', 'B'], correct_index: '1', image_urls: ['images/a.jpg'], needs_review: '' }])
    expect(csv).toContain('id,topic,subtopic,year,question,options,correct_index,image_urls,needs_review')
    expect(csv).toContain('"Which, one?"')
    expect(csv).toContain('"[""A"",""B""]"')
  })

  it('gives a repeated label to the page it actually starts on', () => {
    const question = (sourcePages: number[]) => ({ label: '1', question: 'Stem', options: ['x', 'y'], sourcePages, questionBox: null, needsReview: '' })
    const page = (corePage: number, sourcePages: number[]): PageExtraction => ({ corePage, declaredLabels: ['1'], questions: [question(sourcePages)], figures: [], issues: [] })
    expect(dedupeCoreQuestions([page(1, [2]), page(2, [2])])).toEqual({
      questions: [question([2])], issues: [],
    })
  })

  it('emits shared assets linked to the rows that name each crop', () => {
    const row = { id: '4', topic: '', subtopic: '', year: '2023', question: 'Use the diagram.', options: ['A', 'B'], correct_index: '0', image_urls: ['images/gypsum-001.jpg'], needs_review: '', source_page: 3, source_box: [100, 50, 500, 900] as const }
    const blueprint = buildReviewBlueprint(18, [row], [{
      path: 'images/gypsum-001.jpg', page: 3, linkedLabels: ['4'],
      box: [200, 100, 450, 800], kind: 'diagram', anchor: 'diagram',
    }], true)
    expect(blueprint.assets[0]).toMatchObject({
      output_path: 'images/gypsum-001.jpg', linked_row_ids: ['4'], page: 3,
    })
    expect(blueprint.planned_rows[0].image_urls).toEqual(['images/gypsum-001.jpg'])
  })

  it('keeps two independently boxed visuals linked to one question', () => {
    const check = parseCropCheck({
      pass: false,
      figures: [
        { linked_labels: ['19'], box_2d: [100, 100, 450, 700], kind: 'diagram', anchor: 'villus' },
        { linked_labels: ['19'], box_2d: [560, 120, 900, 820], kind: 'table', anchor: 'answer table' },
      ],
      issues: ['The current crop fused and clipped two separate visuals.'],
    }, 7, new Set(['19']))
    expect(check?.figures).toHaveLength(2)
    expect(check?.figures.every((figure) => figure.linkedLabels[0] === '19')).toBe(true)
    expect(repairPreservesFigureCounts(check?.figures ?? [], [check!.figures[0]], new Set(['19']))).toBe(false)
  })
})
