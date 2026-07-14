/**
 * The structured topic/subtopic editor on Convert. Edits live in a local
 * draft and commit on blur and on add/remove — one Dexie write per settled
 * change, so typing never fights the job's live query. A topics-file
 * extraction replaces the whole list; the parent remounts this component
 * (key on an extraction nonce) so the draft re-seeds.
 */
import { useState } from 'react'
import { Button, GlassInput } from '../design/components'
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
