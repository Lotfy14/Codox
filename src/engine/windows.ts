/**
 * Planner pagination (deterministic, pure).
 *
 * WHY: one planner call over a whole document must emit a fully-specified row
 * — four regions, each with a bounding box — for every question. On a large
 * scan that output is enormous and the model gives up: on a real 30-page,
 * four-exam file it reported `question_count: 108` and emitted just 3 rows.
 * So we plan in page windows and stitch the results here, in code.
 *
 * THE BOUNDARY RULE. A question can straddle a page break (stem on page 10,
 * options on page 11). Each window therefore has two page ranges:
 *
 *   - `core`    — the pages this window OWNS. Cores partition the document
 *                 and never overlap.
 *   - `context` — core ± CONTEXT_PAGES, all sent as images so the call can
 *                 SEE across the boundary.
 *
 * A row belongs to the window whose core contains its `question_prompt` page;
 * rows whose prompt page falls outside the core are dropped. Because cores
 * partition the pages and a question's prompt sits on exactly one page, every
 * question is kept exactly once — while the context overlap is what lets the
 * owning window read the whole straddling question, and lets a row on page 11
 * point its case_stem region back at a shared stem on page 10.
 *
 * The planner numbers the images it is handed 1..n, so every page reference it
 * returns is window-relative and is offset back to absolute here.
 */
import type {
  AnswerPolicy,
  AnswerPolicyType,
  Blueprint,
  BlueprintAsset,
  PlannedRow,
  Region,
} from './types'
import { EVIDENCE_POLICY_TYPES } from './types'

/** Pages per window core. The adaptive split halves this on under-emission. */
export const DEFAULT_WINDOW_PAGES = 10

/** Pages of overlap each side of the core, so a straddling question is whole. */
export const CONTEXT_PAGES = 1

export interface PageWindow {
  /** 1-based pages this window owns — rows are kept only from these. */
  core: number[]
  /** 1-based pages sent as images: the core plus its overlap. */
  context: number[]
}

/**
 * Windows are built over the pages that ACTUALLY rendered, not a 1..n range.
 * A page that failed to render is never sent, so if windows assumed a
 * contiguous range every page reference after the gap would be off by one.
 */
function windowAt(
  pages: readonly number[],
  start: number,
  end: number,
): PageWindow {
  return {
    core: pages.slice(start, end),
    context: pages.slice(
      Math.max(0, start - CONTEXT_PAGES),
      Math.min(pages.length, end + CONTEXT_PAGES),
    ),
  }
}

/**
 * Splits the rendered pages into windows whose cores partition the document.
 * A document that fits in one window yields exactly one window covering
 * everything — the caller keeps today's single-call path for that case.
 */
export function planWindows(
  pages: readonly number[],
  windowPages: number = DEFAULT_WINDOW_PAGES,
): PageWindow[] {
  const size = Math.max(1, windowPages)
  const windows: PageWindow[] = []
  for (let start = 0; start < pages.length; start += size) {
    windows.push(windowAt(pages, start, Math.min(pages.length, start + size)))
  }
  return windows
}

/** Halves a window's core — the adaptive response to under-emission. */
export function splitWindow(
  window: PageWindow,
  pages: readonly number[],
): PageWindow[] {
  if (window.core.length <= 1) return []
  const half = Math.ceil(window.core.length / 2)
  const at = (core: number[]) =>
    windowAt(
      pages,
      pages.indexOf(core[0]),
      pages.indexOf(core[core.length - 1]) + 1,
    )
  return [at(window.core.slice(0, half)), at(window.core.slice(half))]
}

/**
 * Window-relative page (the planner sees its images as 1..n) → absolute page.
 * undefined for an out-of-range reference: a planner hallucination we drop
 * rather than mis-place onto a real page.
 */
function absolutePage(
  relative: number,
  context: readonly number[],
): number | undefined {
  return context[relative - 1]
}

function offsetRegion(
  region: Region | null,
  context: readonly number[],
): Region | null {
  if (region === null) return null
  const page = absolutePage(region.page, context)
  if (page === undefined) return null
  return { ...region, page }
}

export interface LocalizedWindow {
  blueprint: Blueprint
  rows: PlannedRow[]
  assets: BlueprintAsset[]
}

/**
 * One window's blueprint in absolute document coordinates, with rows the
 * window does not own dropped. Ids are left exactly as the planner wrote them
 * — the stitch resolves collisions, so a document that needs no renumbering
 * keeps the planner's printed question numbers.
 */
export function localizeWindow(
  blueprint: Blueprint,
  window: PageWindow,
): LocalizedWindow {
  const rows = blueprint.planned_rows.flatMap((row): PlannedRow[] => {
    const regions = {
      case_stem: offsetRegion(row.regions.case_stem, window.context),
      question_prompt: offsetRegion(row.regions.question_prompt, window.context),
      options: offsetRegion(row.regions.options, window.context),
      answer_evidence: offsetRegion(row.regions.answer_evidence, window.context),
    }
    // The ownership rule.
    const promptPage = regions.question_prompt?.page
    if (promptPage === undefined || !window.core.includes(promptPage)) return []
    return [{ ...row, regions }]
  })

  const keptIds = new Set(rows.map((row) => row.id))
  const referenced = new Set(rows.flatMap((row) => row.image_urls))
  const assets = blueprint.assets.flatMap((asset): BlueprintAsset[] => {
    const page = absolutePage(asset.page, window.context)
    if (page === undefined) return []
    const linked = asset.linked_row_ids.filter((id) => keptIds.has(id))
    // Drop assets no kept row depends on: a dropped row's figure must not be
    // cropped into the bundle for nothing.
    if (!referenced.has(asset.output_path) && linked.length === 0) return []
    return [{ ...asset, page, linked_row_ids: linked }]
  })

  return { blueprint, rows, assets }
}

/**
 * The document-level answer policy across windows. A window that happened to
 * see no answer marks reports `no_answer_key`; that must not erase evidence
 * another window found. Take the strongest evidence seen anywhere — every ROW
 * still carries its own policy, so rows from a window that saw no marks stay
 * blank and flagged rather than guessed at.
 */
export function reconcileAnswerPolicy(
  policies: readonly AnswerPolicy[],
): AnswerPolicy {
  const evidence = policies.filter((policy) =>
    EVIDENCE_POLICY_TYPES.includes(policy.type),
  )
  if (evidence.length > 0) {
    const types = new Set<AnswerPolicyType>(evidence.map((policy) => policy.type))
    const winner = evidence[0]
    return {
      ...winner,
      // Windows disagreeing on WHERE answers live is precisely `mixed`.
      type: types.size > 1 ? 'mixed' : winner.type,
      answer_key_present: evidence.some((policy) => policy.answer_key_present),
    }
  }
  return policies.find((policy) => policy.type === 'uncertain') ?? policies[0]
}

/** `group01`, `group02`, … — the numbering style the planner prompt uses. */
function groupName(index: number): string {
  return `group${String(index + 1).padStart(2, '0')}`
}

/**
 * Stitches localized windows into one document blueprint.
 *
 * Identity is the delicate part. Each window's planner numbers groups and
 * assets from 1, so those collide across windows and MUST be renumbered.
 * Row ids are different: the planner uses the document's PRINTED question
 * numbers, which are unique in a single exam (1..127) but restart at 1 in a
 * file holding several exams. So we keep the printed ids when they are
 * globally unique and only renumber when they actually collide — a paginated
 * single exam therefore keeps exactly the ids a single call would have given
 * it. Ids never leave the device (export drops id/group_id), so renumbering is
 * invisible in the user's CSV.
 *
 * Rows arrive in reading order (windows are page-ordered, and each window's
 * rows are in the planner's reading order), so first-appearance order IS
 * document order.
 */
export function stitchBlueprints(
  windows: readonly LocalizedWindow[],
  pageCount: number,
): Blueprint {
  const first = windows[0].blueprint

  // Row ids: keep the printed numbers unless two windows collide on one.
  const allIds = windows.flatMap((window) => window.rows.map((row) => row.id))
  const idsCollide = new Set(allIds).size !== allIds.length
  let nextRowId = 0
  // Group ids and asset paths always restart per window — always renumber.
  const groupIds = new Map<string, string>()
  const assetPaths = new Map<string, string>()
  let nextGroup = 0
  let nextAsset = 0

  const key = (windowIndex: number, value: string) => `${windowIndex} ${value}`
  const resolveGroup = (windowIndex: number, groupId: string): string => {
    const k = key(windowIndex, groupId)
    let mapped = groupIds.get(k)
    if (mapped === undefined) {
      mapped = groupName(nextGroup++)
      groupIds.set(k, mapped)
    }
    return mapped
  }
  const resolveAsset = (windowIndex: number, path: string): string => {
    const k = key(windowIndex, path)
    let mapped = assetPaths.get(k)
    if (mapped === undefined) {
      const slash = path.lastIndexOf('/')
      const dir = slash < 0 ? '' : path.slice(0, slash + 1)
      const dot = path.lastIndexOf('.')
      const ext = dot > slash ? path.slice(dot) : ''
      nextAsset += 1
      mapped = `${dir}asset${String(nextAsset).padStart(2, '0')}${ext}`
      assetPaths.set(k, mapped)
    }
    return mapped
  }

  const rowIds = new Map<string, string>()
  const rows: PlannedRow[] = []
  const assets: BlueprintAsset[] = []

  windows.forEach((window, windowIndex) => {
    for (const row of window.rows) {
      const id = idsCollide ? String(++nextRowId) : row.id
      rowIds.set(key(windowIndex, row.id), id)
      rows.push({
        ...row,
        id,
        group_id: resolveGroup(windowIndex, row.group_id),
        image_urls: row.image_urls.map((path) => resolveAsset(windowIndex, path)),
      })
    }
    for (const asset of window.assets) {
      assets.push({
        ...asset,
        asset_id: `asset${String(assets.length + 1).padStart(2, '0')}`,
        output_path: resolveAsset(windowIndex, asset.output_path),
        linked_group_id:
          asset.linked_group_id === ''
            ? ''
            : resolveGroup(windowIndex, asset.linked_group_id),
        linked_row_ids: asset.linked_row_ids.flatMap((linked) => {
          const mapped = rowIds.get(key(windowIndex, linked))
          return mapped === undefined ? [] : [mapped]
        }),
      })
    }
  })

  const questionPages = new Set<number>()
  for (const row of rows) {
    const page = row.regions.question_prompt?.page
    if (page !== undefined) questionPages.add(page)
  }

  return {
    csv_schema: first.csv_schema,
    document_profile: {
      page_count: pageCount,
      // Deterministic truth: the rows we actually carry. The per-window
      // under-emission guard is what proves no window emitted fewer than the
      // questions it counted.
      question_count: rows.length,
      group_count: new Set(rows.map((row) => row.group_id)).size,
      question_pages: [...questionPages].sort((a, b) => a - b),
      answer_policy: reconcileAnswerPolicy(
        windows.map((window) => window.blueprint.document_profile.answer_policy),
      ),
    },
    assets,
    planned_rows: rows,
    worker_constraints: first.worker_constraints,
  }
}
