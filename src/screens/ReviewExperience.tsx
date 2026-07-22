import { useState } from 'react'
import { TabNav } from '../design/components'
import { reviewMessages } from '../copy/messages'
import type { RunState } from '../state/types'
import { AiReviewDialog } from './AiReviewDialog'
import { ReviewDetail } from './ReviewDetail'
import { ReviewList } from './ReviewList'
import { RunTopicsPanel } from './RunTopicsPanel'
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
  const [aiDialogOpen, setAiDialogOpen] = useState(false)
  const doneRuns = runs.filter((run) => run.status === 'done')
  if (
    session.activeRun === undefined ||
    session.data === undefined ||
    session.reviewRows === undefined ||
    session.edits === undefined ||
    session.resolutions === undefined
  ) return null

  if (session.view.kind === 'detail') {
    return (
      <ReviewDetail
        aiAnswers={session.aiAnswers}
        currentRowId={session.view.rowId}
        edits={session.edits}
        exported={session.activeRun.exportedAt !== undefined}
        filter={session.controls.filter}
        onBack={session.back}
        onExport={onExport}
        onNavigate={session.navigate}
        orderedRows={session.orderedRowsForDetail}
        pristineRows={session.pristineRows}
        resolutions={session.resolutions}
        run={session.activeRun}
        runTopics={session.runTopics}
        startEditing={session.view.startEditing ?? false}
        topicMatches={session.topicMatches}
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
      <RunTopicsPanel
        key={session.activeRunId}
        runId={session.activeRunId}
        runTopics={session.runTopics}
      />
      <ReviewList
        aiAnswers={session.aiAnswers}
        filter={session.controls.filter}
        filteredRows={session.filteredRows}
        focusRowId={session.focusRowId}
        onAddRow={session.addRow}
        onFilterChange={session.setFilter}
        onOpenAiDialog={() => setAiDialogOpen(true)}
        onOpenRow={session.openRow}
        onSearchChange={session.setSearch}
        resolutions={session.resolutions}
        reviewRows={session.reviewRows}
        runId={session.activeRunId}
        runTopics={session.runTopics}
        search={session.controls.search}
      />
      <AiReviewDialog
        aiAnswers={session.aiAnswers}
        isOpen={aiDialogOpen}
        onOpenChange={setAiDialogOpen}
        resolutions={session.resolutions}
        reviewRows={session.reviewRows}
        run={session.activeRun}
      />
    </div>
  )
}
