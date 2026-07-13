/** Pure Convert-screen logic, extracted for unit testing. */
import type { AnswerSource } from '../state/types'

/**
 * Whether the declared answer sources require a separate answer-key PDF:
 * either the batch default is "key file" and at least one exam file
 * follows the default, or some file explicitly declares "key file".
 */
export function needsAnswerKeyFile(
  batchSource: AnswerSource,
  exams: readonly { answerSource?: AnswerSource }[],
): boolean {
  if (exams.length === 0) return false
  return (
    (batchSource === 'key-file' &&
      exams.some((file) => file.answerSource === undefined)) ||
    exams.some((file) => file.answerSource === 'key-file')
  )
}
