import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { readRunTopics, readTopicMatches } from '../engine/topic-matcher'
import type { RunState } from '../state/types'
import {
  composeReviewRows,
  loadReviewData,
  useAiAnswers,
  useResolutions,
  type ReviewData,
} from './review-data'
import { useEdits } from './review-edits'
import { addRow as addRowMutation, useAdditions, useDeletions } from './review-mutations'
import {
  filterReviewRows,
  isUnresolvedFlag,
  parseSearch,
  type ReviewFilter,
} from './review-filter'

interface ReviewControls {
  filter: ReviewFilter
  search: string
}

export type ReviewView =
  | { kind: 'list' }
  | { kind: 'detail'; rowId: string; pinnedIndex: number; startEditing?: boolean }

export function useReviewSession(runs: readonly RunState[]) {
  const doneRuns = useMemo(() => runs.filter((run) => run.status === 'done'), [runs])
  const runIds = doneRuns.map((run) => run.id).join('|')
  // Default to the newest done run: an older, pre-topics/pre-year run must
  // never be the one a tutor lands on (or exports) by accident.
  const newestDoneId = useMemo(
    () =>
      doneRuns.reduce<RunState | undefined>(
        (newest, run) =>
          newest === undefined || run.createdAt > newest.createdAt ? run : newest,
        undefined,
      )?.id ?? '',
    [doneRuns],
  )
  const [activeRunId, setActiveRunId] = useState(newestDoneId)
  const [dataCache, setDataCache] = useState<Record<string, ReviewData>>({})
  const [controlsByRun, setControlsByRun] = useState<Record<string, ReviewControls>>({})
  const [view, setView] = useState<ReviewView>({ kind: 'list' })
  const [focusRowId, setFocusRowId] = useState<string | null>(null)
  const [pendingNeedsReview, setPendingNeedsReview] = useState<string | null>(null)

  useEffect(() => {
    if (!doneRuns.some((run) => run.id === activeRunId)) {
      setActiveRunId(newestDoneId)
      setView({ kind: 'list' })
    }
  }, [activeRunId, doneRuns, newestDoneId, runIds])

  useEffect(() => {
    if (activeRunId === '' || dataCache[activeRunId] !== undefined) return
    let cancelled = false
    void loadReviewData(activeRunId).then((data) => {
      if (!cancelled) setDataCache((current) => ({ ...current, [activeRunId]: data }))
    })
    return () => { cancelled = true }
  }, [activeRunId, dataCache])

  const activeRun = doneRuns.find((run) => run.id === activeRunId) ?? doneRuns[0]
  const data = activeRun === undefined ? undefined : dataCache[activeRun.id]
  const liveRunId = activeRun?.id ?? '__no_review_run__'
  const resolutions = useResolutions(liveRunId)
  const aiAnswers = useAiAnswers(liveRunId)
  const edits = useEdits(liveRunId)
  const additions = useAdditions(liveRunId)
  const deletions = useDeletions(liveRunId)
  const topicMatches = useLiveQuery(() => readTopicMatches(liveRunId), [liveRunId])
  const runTopics = useLiveQuery(() => readRunTopics(liveRunId), [liveRunId])
  const deletedSet = useMemo(() => new Set(deletions ?? []), [deletions])
  // Edit mode diffs against the pristine rows: the engine's merged rows plus
  // any tutor-added rows (a blank added row is its own pristine baseline).
  const pristineRows = useMemo(
    () => [...(data?.rows ?? []), ...(additions ?? [])],
    [data, additions],
  )
  // Everything downstream (list, search, detail) sees the edited rows, with
  // added rows folded in and deleted rows dropped.
  const reviewRows = useMemo(
    () => data === undefined || edits === undefined || additions === undefined || deletions === undefined
      ? undefined
      : composeReviewRows(data.reviewRows, additions, deletedSet, edits, data.figureByPath),
    [data, edits, additions, deletions, deletedSet],
  )
  const controls = controlsByRun[activeRunId] ?? { filter: 'all', search: '' }
  const filteredRows = useMemo(
    () => reviewRows === undefined || resolutions === undefined
      ? []
      : filterReviewRows(
          reviewRows,
          controls.filter,
          parseSearch(controls.search),
          resolutions,
        ),
    [controls.filter, controls.search, reviewRows, resolutions],
  )

  const orderedRowsForDetail = useMemo(() => {
    if (view.kind !== 'detail' || reviewRows === undefined) return filteredRows
    if (filteredRows.some((row) => row.row.id === view.rowId)) return filteredRows
    const current = reviewRows.find((row) => row.row.id === view.rowId)
    if (current === undefined) return filteredRows
    const pinned = [...filteredRows]
    pinned.splice(Math.min(view.pinnedIndex, pinned.length), 0, current)
    return pinned
  }, [filteredRows, reviewRows, view])

  const updateControls = useCallback((update: Partial<ReviewControls>) => {
    if (activeRunId === '') return
    setControlsByRun((current) => ({
      ...current,
      [activeRunId]: {
        filter: current[activeRunId]?.filter ?? 'all',
        search: current[activeRunId]?.search ?? '',
        ...update,
      },
    }))
  }, [activeRunId])

  const openRow = useCallback((rowId: string) => {
    const pinnedIndex = Math.max(0, filteredRows.findIndex((row) => row.row.id === rowId))
    setFocusRowId(null)
    setView({ kind: 'detail', rowId, pinnedIndex })
  }, [filteredRows])

  const navigate = useCallback((rowId: string) => {
    const pinnedIndex = Math.max(
      0,
      orderedRowsForDetail.findIndex((row) => row.row.id === rowId),
    )
    setView({ kind: 'detail', rowId, pinnedIndex })
  }, [orderedRowsForDetail])

  // Append a blank question and open it straight in edit mode — the tutor
  // lands on an empty form to fill, not a read-only blank card.
  const addRow = useCallback(async () => {
    if (activeRunId === '') return
    const rowId = await addRowMutation(activeRunId)
    setFocusRowId(null)
    setView({ kind: 'detail', rowId, pinnedIndex: filteredRows.length, startEditing: true })
  }, [activeRunId, filteredRows.length])

  const back = useCallback(() => {
    if (view.kind === 'detail') setFocusRowId(view.rowId)
    setView({ kind: 'list' })
  }, [view])

  const selectRun = useCallback((runId: string) => {
    setActiveRunId(runId)
    setFocusRowId(null)
    setView({ kind: 'list' })
  }, [])

  const openNeedsReview = useCallback((runId: string) => {
    setActiveRunId(runId)
    setControlsByRun((current) => ({
      ...current,
      [runId]: { filter: 'needs-review', search: '' },
    }))
    setPendingNeedsReview(runId)
  }, [])

  useEffect(() => {
    if (
      pendingNeedsReview === null ||
      pendingNeedsReview !== activeRunId ||
      reviewRows === undefined ||
      resolutions === undefined
    ) return
    const first = reviewRows.find((row) => isUnresolvedFlag(row, resolutions))
    setPendingNeedsReview(null)
    if (first === undefined) {
      setView({ kind: 'list' })
      return
    }
    const index = reviewRows.filter((row) => isUnresolvedFlag(row, resolutions)).indexOf(first)
    setView({ kind: 'detail', rowId: first.row.id, pinnedIndex: index })
  }, [activeRunId, pendingNeedsReview, resolutions, reviewRows])

  return {
    activeRun,
    activeRunId,
    addRow,
    aiAnswers,
    back,
    controls,
    data,
    edits,
    filteredRows,
    focusRowId,
    navigate,
    openNeedsReview,
    openRow,
    orderedRowsForDetail,
    pristineRows,
    resolutions,
    reviewRows,
    runTopics,
    selectRun,
    setFilter: (filter: ReviewFilter) => updateControls({ filter }),
    setSearch: (search: string) => updateControls({ search }),
    topicMatches,
    view,
  }
}

export type ReviewSession = ReturnType<typeof useReviewSession>
