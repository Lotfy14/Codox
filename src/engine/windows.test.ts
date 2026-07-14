import { describe, expect, it } from 'vitest'
import { makeBlueprint, makePlannedRow, makeRegion } from './fixtures'
import {
  CONTEXT_PAGES,
  localizeWindow,
  planWindows,
  reconcileAnswerPolicy,
  splitWindow,
  stitchBlueprints,
  type PageWindow,
} from './windows'
import type { AnswerPolicy, Blueprint, PlannedRow } from './types'

const pages = (count: number) => Array.from({ length: count }, (_, i) => i + 1)

/** A planned row whose regions sit on the given WINDOW-RELATIVE pages. */
function rowOn(
  id: string,
  promptPage: number,
  optionsPage = promptPage,
  overrides: Partial<PlannedRow> = {},
): PlannedRow {
  return makePlannedRow(id, {
    regions: {
      case_stem: null,
      question_prompt: makeRegion(promptPage),
      options: makeRegion(optionsPage),
      answer_evidence: null,
    },
    ...overrides,
  })
}

function windowBlueprint(rows: PlannedRow[], extra: Partial<Blueprint> = {}) {
  const blueprint = makeBlueprint({ planned_rows: rows, ...extra })
  blueprint.document_profile.question_count = rows.length
  return blueprint
}

describe('planWindows', () => {
  it('gives one window for a document that fits in a single call', () => {
    const windows = planWindows(pages(10), 10)
    expect(windows).toHaveLength(1)
    expect(windows[0].core).toEqual(pages(10))
    expect(windows[0].context).toEqual(pages(10))
  })

  it('cores partition the document — every page owned exactly once', () => {
    const windows = planWindows(pages(30), 10)
    expect(windows).toHaveLength(3)
    const owned = windows.flatMap((window) => window.core)
    expect(owned).toEqual(pages(30))
    expect(new Set(owned).size).toBe(30)
  })

  it('context overlaps the neighbours so a straddling question is visible', () => {
    const [first, second, third] = planWindows(pages(30), 10)
    expect(first.core).toEqual(pages(10))
    // Window 1 can SEE page 11 — a question whose stem is on 10 and options
    // on 11 is therefore whole for the window that owns it.
    expect(first.context).toContain(11)
    expect(second.core[0]).toBe(11)
    // Window 2 can look BACK at page 10 — a shared case stem there is visible.
    expect(second.context).toContain(10)
    expect(third.core).toEqual([21, 22, 23, 24, 25, 26, 27, 28, 29, 30])
  })

  it('is built over the pages that actually rendered, not a 1..n range', () => {
    // Page 3 failed to render, so it is never sent and must not be windowed.
    const rendered = [1, 2, 4, 5]
    const windows = planWindows(rendered, 2)
    expect(windows.flatMap((w) => w.core)).toEqual([1, 2, 4, 5])
    expect(windows[0].context).toEqual([1, 2, 4])
  })
})

describe('the boundary rule', () => {
  // The case that would otherwise silently corrupt a paginated planner:
  // a question whose stem is on page 10 and whose options are on page 11.
  const all = pages(30)
  const [first, second] = planWindows(all, 10)

  // Window 1: core 1-10, context 1-11. The planner sees 11 images, so the
  // straddling question is prompt=page 10 (relative 10), options=page 11
  // (relative 11).
  const straddler = rowOn('10', 10, 11)

  it('the window that OWNS the prompt page keeps the whole question', () => {
    const { rows } = localizeWindow(windowBlueprint([straddler]), first)
    expect(rows).toHaveLength(1)
    // Pages are absolute now, and the options region still points at page 11 —
    // the part that lives outside this window's core.
    expect(rows[0].regions.question_prompt?.page).toBe(10)
    expect(rows[0].regions.options?.page).toBe(11)
  })

  it('the neighbouring window DROPS it, so it is never duplicated', () => {
    // Window 2: core 11-20, context 10-21. It sees the same question — its
    // prompt is relative page 1 (absolute 10) — but does not own page 10.
    const { rows } = localizeWindow(windowBlueprint([rowOn('10', 1, 2)]), second)
    expect(rows).toEqual([])
  })

  it('keeps every question exactly once across the whole document', () => {
    // One question per page, planned by whichever window owns that page.
    const localized = planWindows(all, 10).map((window) => {
      const rows = window.core.map((page) =>
        // window-relative index of this page
        rowOn(String(page), window.context.indexOf(page) + 1),
      )
      return localizeWindow(windowBlueprint(rows), window)
    })
    const stitched = stitchBlueprints(localized, 30)
    expect(stitched.planned_rows).toHaveLength(30)
    expect(stitched.planned_rows.map((row) => row.id)).toEqual(
      all.map(String),
    )
    // Reading order preserved.
    expect(
      stitched.planned_rows.map((row) => row.regions.question_prompt?.page),
    ).toEqual(all)
  })

  it('lets a row point its case stem back at the previous window’s page', () => {
    // A shared case stem on page 10, questions on page 11 (window 2's core).
    const row = rowOn('11', 2, 2, {
      question_assembly: {
        mode: 'case_stem_plus_question_prompt',
        final_format: 'Case stem: {case_stem}\nQuestion: {question_prompt}',
      },
      regions: {
        case_stem: makeRegion(1), // relative page 1 === absolute page 10
        question_prompt: makeRegion(2),
        options: makeRegion(2),
        answer_evidence: null,
      },
    })
    const { rows } = localizeWindow(windowBlueprint([row]), second)
    expect(rows).toHaveLength(1)
    expect(rows[0].regions.case_stem?.page).toBe(10)
    expect(rows[0].regions.question_prompt?.page).toBe(11)
  })
})

describe('localizeWindow page mapping', () => {
  it('offsets window-relative pages back to absolute document pages', () => {
    const window: PageWindow = { core: [11, 12], context: [10, 11, 12, 13] }
    const { rows } = localizeWindow(windowBlueprint([rowOn('a', 2, 3)]), window)
    expect(rows[0].regions.question_prompt?.page).toBe(11)
    expect(rows[0].regions.options?.page).toBe(12)
  })

  it('drops a row whose page reference is out of range (hallucinated)', () => {
    const window: PageWindow = { core: [1, 2], context: [1, 2, 3] }
    const { rows } = localizeWindow(windowBlueprint([rowOn('a', 9)]), window)
    expect(rows).toEqual([])
  })

  it('drops assets no kept row depends on', () => {
    const window: PageWindow = { core: [1], context: [1, 2] }
    const blueprint = windowBlueprint([rowOn('1', 1)], {
      assets: [
        {
          asset_id: 'asset01',
          kind: 'figure',
          page: 2, // belongs to a row this window does not own
          box_2d: [0, 0, 100, 100],
          output_path: 'images/asset01.png',
          linked_group_id: '',
          linked_row_ids: ['99'],
          anchor: 'fig',
        },
      ],
    })
    const { assets } = localizeWindow(blueprint, window)
    expect(assets).toEqual([])
  })
})

describe('splitWindow', () => {
  it('halves the core and refuses to split a single page', () => {
    const all = pages(30)
    const [first] = planWindows(all, 10)
    const [a, b] = splitWindow(first, all)
    expect(a.core).toEqual([1, 2, 3, 4, 5])
    expect(b.core).toEqual([6, 7, 8, 9, 10])
    // Halves still see across their new boundary.
    expect(a.context).toContain(6)
    expect(b.context).toContain(5)
    expect(splitWindow({ core: [7], context: [6, 7, 8] }, all)).toEqual([])
  })
})

describe('stitchBlueprints identity', () => {
  const window1: PageWindow = { core: [1], context: [1, 2] }
  const window2: PageWindow = { core: [2], context: [1, 2] }

  it('keeps the planner’s printed ids when they are globally unique', () => {
    // A single exam numbered 1..N: pagination must not renumber it, or the
    // gold-gate CSV would change.
    const a = localizeWindow(windowBlueprint([rowOn('1', 1)]), window1)
    const b = localizeWindow(windowBlueprint([rowOn('2', 2)]), window2)
    const stitched = stitchBlueprints([a, b], 2)
    expect(stitched.planned_rows.map((row) => row.id)).toEqual(['1', '2'])
  })

  it('renumbers ids only when windows collide (several exams in one file)', () => {
    // Four exams each restart their printed numbering at 1 — ids collide.
    const a = localizeWindow(windowBlueprint([rowOn('1', 1)]), window1)
    const b = localizeWindow(windowBlueprint([rowOn('1', 2)]), window2)
    const stitched = stitchBlueprints([a, b], 2)
    expect(stitched.planned_rows.map((row) => row.id)).toEqual(['1', '2'])
    expect(new Set(stitched.planned_rows.map((r) => r.id)).size).toBe(2)
  })

  it('always renumbers group ids, which restart in every window', () => {
    const a = localizeWindow(windowBlueprint([rowOn('1', 1)]), window1)
    const b = localizeWindow(windowBlueprint([rowOn('2', 2)]), window2)
    const stitched = stitchBlueprints([a, b], 2)
    // Both windows called their group "group1"/"group2" locally; the stitch
    // gives the document one consistent, collision-free group space.
    const groups = stitched.planned_rows.map((row) => row.group_id)
    expect(new Set(groups).size).toBe(2)
    expect(groups).toEqual(['group01', 'group02'])
  })

  it('reports the row count it actually carries', () => {
    const a = localizeWindow(windowBlueprint([rowOn('1', 1)]), window1)
    const b = localizeWindow(windowBlueprint([rowOn('2', 2)]), window2)
    const stitched = stitchBlueprints([a, b], 2)
    expect(stitched.document_profile.question_count).toBe(2)
    expect(stitched.document_profile.page_count).toBe(2)
    expect(stitched.document_profile.question_pages).toEqual([1, 2])
  })
})

describe('reconcileAnswerPolicy', () => {
  const policy = (type: AnswerPolicy['type'], key = false): AnswerPolicy => ({
    type,
    answer_key_present: key,
    marking_style: '',
    worker_rule: '',
  })

  it('a window that saw no marks cannot erase evidence another window found', () => {
    const merged = reconcileAnswerPolicy([
      policy('no_answer_key'),
      policy('inline_marks', true),
    ])
    expect(merged.type).toBe('inline_marks')
    expect(merged.answer_key_present).toBe(true)
  })

  it('windows disagreeing on WHERE answers live is exactly `mixed`', () => {
    const merged = reconcileAnswerPolicy([
      policy('inline_marks'),
      policy('separate_key'),
    ])
    expect(merged.type).toBe('mixed')
  })

  it('stays no_answer_key when no window saw any evidence', () => {
    const merged = reconcileAnswerPolicy([
      policy('no_answer_key'),
      policy('no_answer_key'),
    ])
    expect(merged.type).toBe('no_answer_key')
  })
})

describe('CONTEXT_PAGES', () => {
  it('is at least one page, or a straddling question could not be seen whole', () => {
    expect(CONTEXT_PAGES).toBeGreaterThanOrEqual(1)
  })
})
