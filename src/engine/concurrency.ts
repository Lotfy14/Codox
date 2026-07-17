/**
 * Bounded-concurrency map for independent Gemini calls.
 *
 * The engine's calls stay paced by the controller's shared RPM throttle;
 * this only lets a few independent calls be in flight at once instead of
 * strictly one. Results come back in ITEM order, never completion order —
 * downstream assembly (asset numbering, row order, stitching) must stay
 * byte-identical to the sequential path.
 *
 * On the first failure no new items start; in-flight items settle, then the
 * first error is rethrown. That preserves the sequential path's "stop early,
 * don't burn the rest of the quota" behavior within one bounded batch.
 */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  let failed = false
  let firstError: unknown
  const runner = async (): Promise<void> => {
    for (;;) {
      if (failed || nextIndex >= items.length) return
      const index = nextIndex
      nextIndex += 1
      try {
        results[index] = await fn(items[index], index)
      } catch (error) {
        if (!failed) {
          failed = true
          firstError = error
        }
      }
    }
  }
  const runnerCount = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: runnerCount }, runner))
  if (failed) throw firstError
  return results
}
