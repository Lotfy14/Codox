import { describe, expect, it } from 'vitest'
import {
  assetJpegPath,
  buildReducedBlueprint,
  chunkPages,
  chunkPlannedRows,
  isUnderExtracted,
  rewriteAssetPaths,
  validateBlueprint,
} from './blueprint'
import { makeBlueprint, makePlannedRow, makeRegion } from './fixtures'
import type { Blueprint } from './types'

const PAGES = new Set([1, 2])

/** Serializes a fixture blueprint the way a planner response would look. */
function respond(blueprint: Blueprint): string {
  return JSON.stringify(blueprint)
}

function expectInvalid(response: string, fragment: string) {
  const result = validateBlueprint(response, PAGES)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.errors.join(' | ')).toContain(fragment)
}

describe('validateBlueprint — accepts a good blueprint', () => {
  it('validates the canonical no-answer-key blueprint', () => {
    const result = validateBlueprint(respond(makeBlueprint()), PAGES)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.blueprint.planned_rows).toHaveLength(2)
      expect(result.blueprint.document_profile.answer_policy.type).toBe(
        'no_answer_key',
      )
    }
  })

  it('tolerates a markdown-fenced planner response', () => {
    const fenced = '```json\n' + respond(makeBlueprint()) + '\n```'
    expect(validateBlueprint(fenced, PAGES).ok).toBe(true)
  })
})

/**
 * The count is planner-declared evidence; the rows are the product. A real
 * 30-page run stopped with `planner_invalid_after_repair` because a repaired
 * blueprint emitted 17 fully-specified rows and wrote `question_count: 15`
 * beside them. Code owns the count now; only a SHORTFALL is a real signal, and
 * `isUnderExtracted` — which every caller runs first — is what owns it.
 */
describe('the question count is code-owned, not negotiated', () => {
  it('accepts a blueprint that emits more rows than it counted', () => {
    const blueprint = makeBlueprint()
    blueprint.document_profile.question_count = 1 // counted 1, emitted 2
    const result = validateBlueprint(respond(blueprint), PAGES)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.blueprint.planned_rows).toHaveLength(2)
      // The rows we carry, never the number written next to them.
      expect(result.blueprint.document_profile.question_count).toBe(2)
    }
  })

  it('still requires question_count to BE a number', () => {
    const blueprint = makeBlueprint()
    const raw = JSON.parse(respond(blueprint))
    delete raw.document_profile.question_count
    expectInvalid(JSON.stringify(raw), 'question_count must be a number')
  })

  it('isUnderExtracted catches a shortfall, and only a shortfall', () => {
    const short = makeBlueprint()
    short.document_profile.question_count = 99 // counted 99, emitted 2
    expect(isUnderExtracted(respond(short))).toBe(true)

    const surplus = makeBlueprint()
    surplus.document_profile.question_count = 1 // counted 1, emitted 2
    expect(isUnderExtracted(respond(surplus))).toBe(false)

    expect(isUnderExtracted(respond(makeBlueprint()))).toBe(false)
    // An unparseable response declares nothing: the parse gate owns it.
    expect(isUnderExtracted('not json at all')).toBe(false)
  })
})

describe('validateBlueprint — §1.6 rules', () => {
  it('rejects unparseable JSON', () => {
    expectInvalid('not json at all', 'not valid JSON')
  })

  it('rejects a csv_schema that is not exactly the 10-column contract', () => {
    const blueprint = makeBlueprint()
    blueprint.csv_schema = ['id', 'question', 'options']
    expectInvalid(respond(blueprint), 'csv_schema must equal exactly')
  })

  it('rejects duplicate row IDs', () => {
    const blueprint = makeBlueprint({
      planned_rows: [makePlannedRow('1'), makePlannedRow('1')],
    })
    expectInvalid(respond(blueprint), 'duplicate row id "1"')
  })

  it('rejects an empty group_id', () => {
    const blueprint = makeBlueprint()
    blueprint.planned_rows[0].group_id = ''
    expectInvalid(respond(blueprint), 'group_id must be non-empty')
  })

  it('rejects an answer_policy type outside the five allowed values', () => {
    const blueprint = makeBlueprint()
    // @ts-expect-error deliberately invalid
    blueprint.document_profile.answer_policy.type = 'guess_from_knowledge'
    expectInvalid(respond(blueprint), 'answer_policy.type must be one of')
  })

  it('rejects a non-numeric box_2d', () => {
    const blueprint = makeBlueprint()
    // @ts-expect-error deliberately invalid
    blueprint.planned_rows[0].regions.question_prompt.box_2d = [0, 0, '100', 100]
    expectInvalid(respond(blueprint), 'box_2d must be a numeric')
  })

  it('rejects a page reference outside the rendered page set', () => {
    const blueprint = makeBlueprint()
    blueprint.planned_rows[0].regions.question_prompt = makeRegion(7)
    expectInvalid(respond(blueprint), 'not in the rendered page set')
  })

  it('rejects an image_urls entry that names no asset', () => {
    const blueprint = makeBlueprint()
    blueprint.planned_rows[0].image_urls = ['images/ghost.png']
    expectInvalid(respond(blueprint), 'names no asset')
  })

  it('accepts an image_urls entry backed by an asset with a bbox', () => {
    const blueprint = makeBlueprint()
    blueprint.assets = [
      {
        asset_id: 'asset01',
        kind: 'case_image',
        page: 1,
        box_2d: [10, 10, 200, 300],
        output_path: 'images/asset01.png',
        linked_group_id: 'group1',
        linked_row_ids: ['1'],
        anchor: 'figure',
      },
    ]
    blueprint.planned_rows[0].image_urls = ['images/asset01.png']
    expect(validateBlueprint(respond(blueprint), PAGES).ok).toBe(true)
  })

  it('rejects a row with no question_prompt region (not enough for the worker)', () => {
    const blueprint = makeBlueprint()
    blueprint.planned_rows[0].regions.question_prompt = null
    expectInvalid(respond(blueprint), 'non-null question_prompt region is required')
  })

  it('rejects a case-stem row with no case_stem region', () => {
    const blueprint = makeBlueprint()
    blueprint.planned_rows[0].question_assembly = {
      mode: 'case_stem_plus_question_prompt',
      final_format: 'Case stem: {case_stem}\nQuestion: {question_prompt}',
    }
    expectInvalid(respond(blueprint), 'requires a non-null case_stem region')
  })

  it('rejects a mismatched final_format for the declared mode', () => {
    const blueprint = makeBlueprint()
    blueprint.planned_rows[0].question_assembly.final_format = 'whatever I like'
    expectInvalid(respond(blueprint), 'final_format must be')
  })

  it('rejects an evidence policy whose governed row has a null answer_evidence region', () => {
    const blueprint = makeBlueprint()
    blueprint.document_profile.answer_policy.type = 'inline_marks'
    blueprint.planned_rows[0].correct_index_policy = {
      type: 'extract_inline_mark',
      value: '',
      needs_review: '',
    }
    // …and no answer_evidence region.
    expectInvalid(
      respond(blueprint),
      'requires a non-null answer_evidence region',
    )
  })

  it('lets an evidence policy blank-flag an individual row without evidence', () => {
    const blueprint = makeBlueprint()
    blueprint.document_profile.answer_policy.type = 'inline_marks'
    for (const row of blueprint.planned_rows) {
      row.regions.answer_evidence = makeRegion(2)
      row.correct_index_policy = { type: 'extract_inline_mark', value: '', needs_review: '' }
    }
    // Row 2 has conflicting marks: planner blanks it and drops the region.
    blueprint.planned_rows[1].regions.answer_evidence = null
    blueprint.planned_rows[1].correct_index_policy = {
      type: 'blank_conflicting_marks',
      value: '',
      needs_review: 'conflicting_marks',
    }
    expect(validateBlueprint(respond(blueprint), PAGES).ok).toBe(true)
  })

  it('rejects worker_constraints that permit a structural change', () => {
    const blueprint = makeBlueprint()
    blueprint.worker_constraints.may_add_rows = true
    expectInvalid(respond(blueprint), 'worker_constraints.may_add_rows must be false')
  })

  it('rejects a missing worker_constraints block', () => {
    const raw = JSON.parse(respond(makeBlueprint()))
    delete raw.worker_constraints
    expectInvalid(JSON.stringify(raw), 'worker_constraints must be an object')
  })
})

describe('code-owned asset paths', () => {
  it('rewrites the planner .png suggestion to the .jpg we actually produce', () => {
    expect(assetJpegPath('images/asset01.png')).toBe('images/asset01.jpg')
    expect(assetJpegPath('images/q14_lichen-planus.jpeg')).toBe(
      'images/q14_lichen-planus.jpg',
    )
    expect(assetJpegPath('images/asset01')).toBe('images/asset01')
  })

  it('rewrites both the asset list and the rows that reference it, consistently', () => {
    const blueprint = makeBlueprint()
    blueprint.assets = [
      {
        asset_id: 'asset01',
        kind: 'case_image',
        page: 1,
        box_2d: [10, 10, 200, 300],
        output_path: 'images/asset01.png',
        linked_group_id: 'group1',
        linked_row_ids: ['1'],
        anchor: 'figure',
      },
    ]
    blueprint.planned_rows[0].image_urls = ['images/asset01.png']

    const rewritten = rewriteAssetPaths(blueprint)

    expect(rewritten.assets[0].output_path).toBe('images/asset01.jpg')
    expect(rewritten.planned_rows[0].image_urls).toEqual(['images/asset01.jpg'])
  })
})

describe('chunking and the reduced blueprint', () => {
  const many = makeBlueprint({
    planned_rows: Array.from({ length: 25 }, (_, i) => makePlannedRow(String(i + 1))),
  })

  it('splits rows into chunks of 10 by default', () => {
    const chunks = chunkPlannedRows(many)
    expect(chunks.map((chunk) => chunk.length)).toEqual([10, 10, 5])
    expect(chunks[2][0].id).toBe('21')
  })

  it('honors a custom chunk size', () => {
    expect(chunkPlannedRows(many, 7).map((c) => c.length)).toEqual([7, 7, 7, 4])
  })

  it('the reduced blueprint carries ONLY the chunk rows — never the full set', () => {
    const chunk = chunkPlannedRows(many)[1]
    const reduced = buildReducedBlueprint(many, chunk)
    expect(reduced.planned_rows).toHaveLength(10)
    expect(reduced.planned_rows.map((row) => row.id)).toEqual([
      '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
    ])
    // …and still carries schema, profile, and constraints.
    expect(reduced.csv_schema).toEqual(many.csv_schema)
    expect(reduced.document_profile.answer_policy.type).toBe('no_answer_key')
    expect(reduced.worker_constraints.may_add_rows).toBe(false)
  })

  it('the reduced blueprint carries only the assets its rows reference', () => {
    const blueprint = makeBlueprint()
    blueprint.assets = [
      {
        asset_id: 'asset01',
        kind: 'case_image',
        page: 1,
        box_2d: [10, 10, 200, 300],
        output_path: 'images/asset01.jpg',
        linked_group_id: 'group1',
        linked_row_ids: ['1'],
        anchor: 'a',
      },
      {
        asset_id: 'asset02',
        kind: 'case_image',
        page: 2,
        box_2d: [10, 10, 200, 300],
        output_path: 'images/asset02.jpg',
        linked_group_id: 'group2',
        linked_row_ids: ['2'],
        anchor: 'b',
      },
    ]
    blueprint.planned_rows[0].image_urls = ['images/asset01.jpg']
    blueprint.planned_rows[1].image_urls = ['images/asset02.jpg']

    const reduced = buildReducedBlueprint(blueprint, [blueprint.planned_rows[0]])

    expect(reduced.assets.map((asset) => asset.asset_id)).toEqual(['asset01'])
  })

  it('chunkPages lists exactly the pages the chunk references, sorted', () => {
    const blueprint = makeBlueprint()
    blueprint.planned_rows[1].regions.question_prompt = makeRegion(2)
    blueprint.planned_rows[1].regions.options = makeRegion(2)
    const reduced = buildReducedBlueprint(blueprint, blueprint.planned_rows)
    expect(chunkPages(reduced)).toEqual([1, 2])

    const firstOnly = buildReducedBlueprint(blueprint, [blueprint.planned_rows[0]])
    expect(chunkPages(firstOnly)).toEqual([1])
  })
})
