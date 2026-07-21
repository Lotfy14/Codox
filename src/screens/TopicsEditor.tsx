/**
 * The structured topic/subtopic editor on Convert. Edits live in a local
 * draft and commit on blur and on add/remove — one Dexie write per settled
 * change, so typing never fights the job's live query. A topics-file
 * extraction replaces the whole list; the parent remounts this component
 * (key on an extraction nonce) so the draft re-seeds.
 */
import { useState } from 'react'
import { Button, GlassInput, Select } from '../design/components'
import { convertMessages, topicsMessages } from '../copy/messages'
import type { TopicItem } from '../state/types'

export interface TopicsEditorProps {
  isDisabled?: boolean
  onCommit: (topics: TopicItem[]) => void
  topics: readonly TopicItem[]
}

/** Rows with a blank topic name are drafts — never committed. */
function committable(draft: readonly TopicItem[]): TopicItem[] {
  return draft.flatMap((item) => {
    const topic = item.topic.trim()
    if (topic === '') return []
    const subtopics = item.subtopics
      .map((subtopic) => subtopic.trim())
      .filter((subtopic) => subtopic !== '')
    return [{ topic, subtopics }]
  })
}

export function TopicsEditor({
  isDisabled = false,
  onCommit,
  topics,
}: TopicsEditorProps) {
  const [draft, setDraft] = useState<TopicItem[]>(() =>
    topics.map((item) => ({ topic: item.topic, subtopics: [...item.subtopics] })),
  )

  const update = (next: TopicItem[], commit: boolean) => {
    setDraft(next)
    if (commit) onCommit(committable(next))
  }

  const setTopic = (index: number, topic: string) => {
    update(
      draft.map((item, i) => (i === index ? { ...item, topic } : item)),
      false,
    )
  }

  const setSubtopic = (index: number, subIndex: number, subtopic: string) => {
    update(
      draft.map((item, i) =>
        i === index
          ? {
              ...item,
              subtopics: item.subtopics.map((current, j) =>
                j === subIndex ? subtopic : current,
              ),
            }
          : item,
      ),
      false,
    )
  }

  /**
   * Demote a topic to a subtopic of another: its name (and any subtopics it
   * already had) move under the target, and the topic row is removed. The
   * fix for a flat extraction the tutor wants to nest by hand.
   */
  const demoteTopic = (index: number, targetIndex: number) => {
    const moved = draft[index]
    const movedName = moved.topic.trim()
    if (movedName === '') return
    const additions = [
      movedName,
      ...moved.subtopics.map((subtopic) => subtopic.trim()).filter((s) => s !== ''),
    ]
    const next = draft
      .map((item, i) => {
        if (i !== targetIndex) return item
        const seen = new Set(item.subtopics.map((subtopic) => subtopic.trim()))
        const merged = [...item.subtopics]
        for (const addition of additions) {
          if (!seen.has(addition)) {
            merged.push(addition)
            seen.add(addition)
          }
        }
        return { ...item, subtopics: merged }
      })
      .filter((_, i) => i !== index)
    update(next, true)
  }

  /** Promote a subtopic to its own top-level topic (the inverse move). */
  const promoteSubtopic = (index: number, subIndex: number) => {
    const name = (draft[index].subtopics[subIndex] ?? '').trim()
    const next = draft.map((item, i) =>
      i === index
        ? {
            ...item,
            subtopics: item.subtopics.filter((_, j) => j !== subIndex),
          }
        : item,
    )
    if (name !== '' && !next.some((item) => item.topic.trim() === name)) {
      next.push({ topic: name, subtopics: [] })
    }
    update(next, true)
  }

  return (
    <div aria-label={topicsMessages.editorLabel} className="ds-topics-editor" role="group">
      {draft.map((item, index) => (
        <div className="ds-topics-editor__topic" key={index}>
          <div className="ds-topics-editor__row">
            <GlassInput
              className="ds-topics-editor__field"
              isDisabled={isDisabled}
              label={
                <span className="ds-visually-hidden">
                  {topicsMessages.topicLabel(index + 1)}
                </span>
              }
              onBlur={() => onCommit(committable(draft))}
              onChange={(topic) => setTopic(index, topic)}
              placeholder={topicsMessages.topicPlaceholder}
              value={item.topic}
            />
            <Button
              aria-label={topicsMessages.removeTopic(item.topic.trim())}
              isDisabled={isDisabled}
              onPress={() =>
                update(draft.filter((_, i) => i !== index), true)
              }
              variant="quiet"
            >
              {convertMessages.remove}
            </Button>
          </div>
          {draft.some((other, i) => i !== index && other.topic.trim() !== '') &&
          item.topic.trim() !== '' ? (
            <div className="ds-topics-editor__reparent">
              <Select
                className="ds-topics-editor__demote"
                isDisabled={isDisabled}
                label={
                  <span className="ds-visually-hidden">
                    {topicsMessages.demoteTopicLabel(item.topic.trim())}
                  </span>
                }
                onChange={(key) => {
                  if (key !== null) demoteTopic(index, Number(key))
                }}
                options={draft.flatMap((other, i) =>
                  i !== index && other.topic.trim() !== ''
                    ? [{ id: String(i), label: other.topic.trim() }]
                    : [],
                )}
                value={null}
                valueLabel={topicsMessages.demoteTopic}
              />
            </div>
          ) : null}
          {item.subtopics.map((subtopic, subIndex) => (
            <div
              className="ds-topics-editor__row ds-topics-editor__row--subtopic"
              key={subIndex}
            >
              <GlassInput
                className="ds-topics-editor__field"
                isDisabled={isDisabled}
                label={
                  <span className="ds-visually-hidden">
                    {topicsMessages.subtopicLabel(index + 1, subIndex + 1)}
                  </span>
                }
                onBlur={() => onCommit(committable(draft))}
                onChange={(value) => setSubtopic(index, subIndex, value)}
                placeholder={topicsMessages.subtopicPlaceholder}
                value={subtopic}
              />
              <Button
                aria-label={topicsMessages.promoteSubtopicLabel(subtopic.trim())}
                isDisabled={isDisabled || subtopic.trim() === ''}
                onPress={() => promoteSubtopic(index, subIndex)}
                variant="quiet"
              >
                {topicsMessages.promoteSubtopic}
              </Button>
              <Button
                aria-label={topicsMessages.removeSubtopic(subtopic.trim())}
                isDisabled={isDisabled}
                onPress={() =>
                  update(
                    draft.map((current, i) =>
                      i === index
                        ? {
                            ...current,
                            subtopics: current.subtopics.filter(
                              (_, j) => j !== subIndex,
                            ),
                          }
                        : current,
                    ),
                    true,
                  )
                }
                variant="quiet"
              >
                {convertMessages.remove}
              </Button>
            </div>
          ))}
          <div className="ds-topics-editor__row ds-topics-editor__row--subtopic">
            <Button
              isDisabled={isDisabled}
              onPress={() =>
                update(
                  draft.map((current, i) =>
                    i === index
                      ? { ...current, subtopics: [...current.subtopics, ''] }
                      : current,
                  ),
                  false,
                )
              }
              variant="quiet"
            >
              {topicsMessages.addSubtopic}
            </Button>
          </div>
        </div>
      ))}
      <Button
        isDisabled={isDisabled}
        onPress={() => update([...draft, { topic: '', subtopics: [] }], false)}
        variant="secondary"
      >
        {topicsMessages.addTopic}
      </Button>
    </div>
  )
}
