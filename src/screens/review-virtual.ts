import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, type RefObject } from 'react'

export interface VirtualWindowItem {
  index: number
  offsetTop: number
}

export function useVirtualWindow({
  scrollRef,
  count,
  rowHeight,
}: {
  scrollRef: RefObject<HTMLElement | null>
  count: number
  rowHeight: number
}) {
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 3,
  })
  const scrollToIndex = useCallback(
    (index: number, align: 'center') => virtualizer.scrollToIndex(index, { align }),
    [virtualizer],
  )
  return {
    totalHeight: virtualizer.getTotalSize(),
    items: virtualizer.getVirtualItems().map((item) => ({
      index: item.index,
      offsetTop: item.start,
    })),
    scrollToIndex,
  }
}
