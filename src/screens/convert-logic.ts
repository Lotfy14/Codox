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

/** Flat ~5 s/page estimate; refine when Phase 6 measures the real pace. */
export function estimatedMinutes(totalPages: number): number {
  return Math.max(1, Math.round((totalPages * 5) / 60))
}
