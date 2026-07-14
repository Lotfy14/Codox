import { TabNav } from '../design/components'
import { reviewMessages } from '../copy/messages'
import type { RunState } from '../state/types'
import { ReviewDetail } from './ReviewDetail'
import { ReviewList } from './ReviewList'
import type { ReviewSession } from './useReviewSession'

export function ReviewExperience({
  runs,
  session,
  onExport,
}: {
  runs: readonly RunState[]
  session: ReviewSession
  onExport: () => void
}) {
  const doneRuns = runs.filter((run) => run.status === 'done')
  if (
    session.activeRun === undefined ||
    session.data === undefined ||
    session.resolutions === undefined
  ) return null

  if (session.view.kind === 'detail') {
    return (
      <ReviewDetail
        currentRowId={session.view.rowId}
        exported={session.activeRun.exportedAt !== undefined}
        filter={session.controls.filter}
        onBack={session.back}
        onExport={onExport}
        onNavigate={session.navigate}
        orderedRows={session.orderedRowsForDetail}
        resolutions={session.resolutions}
        run={session.activeRun}
      />
    )
  }

  return (
    <div className="review-experience">
      {doneRuns.length > 1 ? (
        <TabNav
          activeTab={session.activeRunId}
          ariaLabel={reviewMessages.fileSwitcherLabel}
          className="review-file-tabs"
          items={doneRuns.map((run) => ({ id: run.id, label: run.fileName }))}
          onTabChange={session.selectRun}
        />
      ) : null}
      <ReviewList
        filter={session.controls.filter}
        filteredRows={session.filteredRows}
        focusRowId={session.focusRowId}
        initialScrollTop={session.scrollTop}
        onFilterChange={session.setFilter}
        onOpenRow={session.openRow}
        onScrollTopChange={session.saveScrollTop}
        onSearchChange={session.setSearch}
        resolutions={session.resolutions}
        reviewRows={session.data.reviewRows}
        search={session.controls.search}
      />
    </div>
  )
}
