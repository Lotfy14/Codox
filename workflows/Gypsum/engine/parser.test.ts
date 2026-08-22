import { describe, expect, it } from 'vitest'
import { validBox, pixelBox } from './boxes'
import { emitCsv } from './csv'
import { modelJson } from './json'
import { dedupeCoreQuestions } from './executor'
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
})
