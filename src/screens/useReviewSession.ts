import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RunState } from '../state/types'
import {
  loadReviewData,
  useResolutions,
  type ReviewData,
} from './review-data'
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
  | { kind: 'detail'; rowId: string; pinnedIndex: number }

export function useReviewSession(runs: readonly RunState[]) {
  const doneRuns = useMemo(() => runs.filter((run) => run.status === 'done'), [runs])
  const runIds = doneRuns.map((run) => run.id).join('|')
  const [activeRunId, setActiveRunId] = useState(() => doneRuns[0]?.id ?? '')
  const [dataCache, setDataCache] = useState<Record<string, ReviewData>>({})
  const [controlsByRun, setControlsByRun] = useState<Record<string, ReviewControls>>({})
  const [view, setView] = useState<ReviewView>({ kind: 'list' })
  const [focusRowId, setFocusRowId] = useState<string | null>(null)
  const [pendingNeedsReview, setPendingNeedsReview] = useState<string | null>(null)
  const scrollStateRef = useRef(new Map<string, number>())
  const scrollFrameRef = useRef<number | undefined>(undefined)
  const pendingScrollRef = useRef<{ runId: string; top: number } | null>(null)

  useEffect(() => {
    if (!doneRuns.some((run) => run.id === activeRunId)) {
      setActiveRunId(doneRuns[0]?.id ?? '')
      setView({ kind: 'list' })
    }
  }, [activeRunId, doneRuns, runIds])

  useEffect(() => {
    if (activeRunId === '' || dataCache[activeRunId] !== undefined) return
    let cancelled = false
    void loadReviewData(activeRunId).then((data) => {
      if (!cancelled) setDataCache((current) => ({ ...current, [activeRunId]: data }))
    })
    return () => { cancelled = true }
  }, [activeRunId, dataCache])

  useEffect(() => () => window.cancelAnimationFrame(scrollFrameRef.current ?? 0), [])

  const activeRun = doneRuns.find((run) => run.id === activeRunId) ?? doneRuns[0]
  const data = activeRun === undefined ? undefined : dataCache[activeRun.id]
  const resolutions = useResolutions(activeRun?.id ?? '__no_review_run__')
  const controls = controlsByRun[activeRunId] ?? { filter: 'all', search: '' }
  const filteredRows = useMemo(
    () => data === undefined || resolutions === undefined
      ? []
      : filterReviewRows(
          data.reviewRows,
          controls.filter,
          parseSearch(controls.search),
          resolutions,
        ),
    [controls.filter, controls.search, data, resolutions],
  )

  const orderedRowsForDetail = useMemo(() => {
    if (view.kind !== 'detail' || data === undefined) return filteredRows
    if (filteredRows.some((row) => row.row.id === view.rowId)) return filteredRows
    const current = data.reviewRows.find((row) => row.row.id === view.rowId)
    if (current === undefined) return filteredRows
    const pinned = [...filteredRows]
    pinned.splice(Math.min(view.pinnedIndex, pinned.length), 0, current)
    return pinned
  }, [data, filteredRows, view])

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
      data === undefined ||
      resolutions === undefined
    ) return
    const first = data.reviewRows.find((row) => isUnresolvedFlag(row, resolutions))
    setPendingNeedsReview(null)
    if (first === undefined) {
      setView({ kind: 'list' })
      return
    }
    const index = data.reviewRows.filter((row) => isUnresolvedFlag(row, resolutions)).indexOf(first)
    setView({ kind: 'detail', rowId: first.row.id, pinnedIndex: index })
  }, [activeRunId, data, pendingNeedsReview, resolutions])

  const saveScrollTop = useCallback((top: number) => {
    if (activeRunId === '') return
    pendingScrollRef.current = { runId: activeRunId, top }
    if (scrollFrameRef.current !== undefined) return
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      const pending = pendingScrollRef.current
      if (pending !== null) scrollStateRef.current.set(pending.runId, pending.top)
      scrollFrameRef.current = undefined
    })
  }, [activeRunId])

  return {
    activeRun,
    activeRunId,
    back,
    controls,
    data,
    filteredRows,
    focusRowId,
    navigate,
    openNeedsReview,
    openRow,
    orderedRowsForDetail,
    resolutions,
    saveScrollTop,
    scrollTop: scrollStateRef.current.get(activeRunId) ?? 0,
    selectRun,
    setFilter: (filter: ReviewFilter) => updateControls({ filter }),
    setSearch: (search: string) => updateControls({ search }),
    view,
  }
}

export type ReviewSession = ReturnType<typeof useReviewSession>
