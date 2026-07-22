/**
 * Post-run topic editor (owner-approved 2026-07-21). Lets a tutor rename or
 * remove the run's topics — e.g. strip a "167" count badge the extractor
 * absorbed — and re-label every question against the edited list, without
 * re-running the whole conversion. Outside the pinned engine path: it edits
 * only the run's `topics-list` snapshot and its `topic-matches`, never
 * `merged-rows`. NEVER-GUESS holds — re-matching still blanks any row the
 * model can't confidently place.
 */
import { useState } from 'react'
import { Button } from '../design/components'
import { topicsMessages } from '../copy/messages'
import { rematchRunTopics } from '../engine/topic-matcher'
import type { TopicItem } from '../state/types'
import { TopicsEditor } from './TopicsEditor'

interface PanelProps {
  runId: string
  /**
   * The run's current taxonomy; undefined when it never had a topic list.
   * A run without one is still editable here — the tutor can add a list
   * after extraction and match, no re-run needed (owner-approved 2026-07-22).
   */
  runTopics: TopicItem[] | undefined
}

type Note = { text: string; tone: 'info' | 'danger' | 'working' }

function cloneTopics(topics: readonly TopicItem[]): TopicItem[] {
  return topics.map((item) => ({
    topic: item.topic,
    subtopics: [...item.subtopics],
  }))
}

/** Maps a re-match failure to the tutor-facing note (bad key ≠ quota ≠ down). */
function failureNote(kind: string): Note {
  if (kind === 'wrong-key') return { text: topicsMessages.matchWrongKey, tone: 'danger' }
  if (kind === 'quota-exhausted' || kind === 'rate-limited') {
    return { text: topicsMessages.rematchQuotaPaused, tone: 'info' }
  }
  if (kind === 'unreachable') return { text: topicsMessages.rematchUnreachable, tone: 'info' }
  return { text: topicsMessages.rematchFailed, tone: 'danger' }
}

export function RunTopicsPanel({ runId, runTopics }: PanelProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<TopicItem[]>([])
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [note, setNote] = useState<Note | null>(null)

  // A run with no list yet gets the "add topic matching" entry; one that
  // already has topics gets the "edit & re-match" entry. Both build a draft
  // in TopicsEditor and persist through rematchRunTopics, which creates the
  // topics-list snapshot on first save.
  const existing = runTopics ?? []
  const hasList = existing.length > 0

  const openEditor = () => {
    setDraft(cloneTopics(existing))
    setNote(null)
    setProgress(null)
    setOpen(true)
  }

  const save = async () => {
    if (saving) return
    setSaving(true)
    setNote(null)
    setProgress(null)
    try {
      const outcome = await rematchRunTopics(runId, draft, {
        onProgress: (done, total) => setProgress({ done, total }),
      })
      if (outcome.ok) {
        setNote({
          text: draft.length === 0 ? topicsMessages.rematchEmpty : topicsMessages.rematchDone,
          tone: 'info',
        })
        setOpen(false)
      } else if (outcome.failure.kind !== 'aborted') {
        setNote(failureNote(outcome.failure.kind))
      }
    } catch {
      setNote({ text: topicsMessages.rematchFailed, tone: 'danger' })
    } finally {
      setSaving(false)
      setProgress(null)
    }
  }

  return (
    <section className="review-topics-panel" aria-label={topicsMessages.editorLabel}>
      {open ? (
        <div className="review-topics-panel__body">
          <p className="ds-muted review-topics-panel__hint">
            {hasList ? topicsMessages.rematchHint : topicsMessages.addHint}
          </p>
          <TopicsEditor
            isDisabled={saving}
            onCommit={setDraft}
            topics={draft}
          />
          <div className="review-topics-panel__actions">
            <Button isDisabled={saving} onPress={() => void save()}>
              {saving ? topicsMessages.rematchSaving : topicsMessages.rematchSave}
            </Button>
            <Button
              isDisabled={saving}
              onPress={() => setOpen(false)}
              variant="secondary"
            >
              {topicsMessages.rematchClose}
            </Button>
          </div>
          {progress !== null ? (
            <p className="ds-inline-note ds-inline-note--working" role="status">
              {topicsMessages.rematchProgress(progress.done, progress.total)}
            </p>
          ) : null}
        </div>
      ) : (
        <Button onPress={openEditor} variant="secondary">
          {hasList ? topicsMessages.rematchOpen : topicsMessages.addOpen}
        </Button>
      )}
      {note !== null ? (
        <p
          className={`ds-inline-note ds-inline-note--${note.tone === 'danger' ? 'danger' : note.tone === 'working' ? 'working' : 'info'}`}
          role={note.tone === 'danger' ? 'alert' : 'status'}
        >
          {note.text}
        </p>
      ) : null}
    </section>
  )
}
