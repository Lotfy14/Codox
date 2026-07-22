import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../design/components'
import { reviewMessages } from '../copy/messages'
import type { Box2d } from '../engine/types'
import { getPageArtifact } from '../state/runs'
import {
  moveBox,
  nudgeHandle,
  resizeBox,
  WHOLE_PAGE_BOX,
  type CropHandle,
} from './review-figure-crops'

/** The eight resize handles, with the CSS anchors that place each one. */
const HANDLES: { handle: CropHandle; cursor: string }[] = [
  { handle: 'nw', cursor: 'nwse-resize' },
  { handle: 'n', cursor: 'ns-resize' },
  { handle: 'ne', cursor: 'nesw-resize' },
  { handle: 'e', cursor: 'ew-resize' },
  { handle: 'se', cursor: 'nwse-resize' },
  { handle: 's', cursor: 'ns-resize' },
  { handle: 'sw', cursor: 'nesw-resize' },
  { handle: 'w', cursor: 'ew-resize' },
]

/** normalized 0–1000 → CSS percentages for the overlay rectangle. */
function boxStyle(box: Box2d): React.CSSProperties {
  const [ymin, xmin, ymax, xmax] = box
  return {
    top: `${ymin / 10}%`,
    left: `${xmin / 10}%`,
    height: `${(ymax - ymin) / 10}%`,
    width: `${(xmax - xmin) / 10}%`,
  }
}

/** normalized handle position (0–1000 on both axes). */
function handlePos(box: Box2d, handle: CropHandle): { top: number; left: number } {
  const [ymin, xmin, ymax, xmax] = box
  const midY = (ymin + ymax) / 2
  const midX = (xmin + xmax) / 2
  const top = handle.includes('n') ? ymin : handle.includes('s') ? ymax : midY
  const left = handle.includes('w') ? xmin : handle.includes('e') ? xmax : midX
  return { top: top / 10, left: left / 10 }
}

const NUDGE = 15 // normalized units per arrow press

export interface FigureCropEditorProps {
  runId: string
  /** 0-based page index the figure lives on. */
  pageIndex: number
  /** The current effective box (override, or the auto padded default). */
  box: Box2d
  /** True when a stored override exists (enables "Reset to auto"). */
  hasOverride: boolean
  figureNumber: number
  /** Persist the tutor's chosen box. `null` clears the override. */
  onCommit: (box: Box2d | null) => void
  onClose: () => void
}

/**
 * Lets the tutor re-draw a clipped figure's crop over its whole source page.
 * Pointer users drag the rectangle or its eight handles; keyboard users focus
 * the rectangle and use arrows to move it, Shift+arrows to grow a side, and
 * Alt+arrows to shrink it. "Whole page" and "Reset to auto" cover the common
 * cases without any dragging. The chosen box is what ships to Triviadox.
 */
export function FigureCropEditor({
  runId,
  pageIndex,
  box,
  hasOverride,
  figureNumber,
  onCommit,
  onClose,
}: FigureCropEditorProps) {
  const [pageUrl, setPageUrl] = useState<string | null>(null)
  const [draft, setDraft] = useState<Box2d>(box)
  const surfaceRef = useRef<HTMLDivElement>(null)
  // A live pointer drag; null when idle. `origin` is the box at drag start.
  const dragRef = useRef<{ handle: CropHandle; origin: Box2d } | null>(null)

  useEffect(() => {
    setDraft(box)
  }, [box])

  useEffect(() => {
    let cancelled = false
    let url: string | null = null
    void getPageArtifact(runId, pageIndex).then((page) => {
      if (cancelled || page?.bytes === undefined) return
      url = URL.createObjectURL(
        new Blob([page.bytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }),
      )
      setPageUrl(url)
    })
    return () => {
      cancelled = true
      if (url !== null) URL.revokeObjectURL(url)
      setPageUrl(null)
    }
  }, [runId, pageIndex])

  /** Client point → normalized (0–1000) point on the page image. */
  const toNormalized = (clientX: number, clientY: number): { py: number; px: number } => {
    const rect = surfaceRef.current?.getBoundingClientRect()
    if (rect === undefined || rect.width === 0 || rect.height === 0) {
      return { py: 0, px: 0 }
    }
    return {
      py: ((clientY - rect.top) / rect.height) * 1000,
      px: ((clientX - rect.left) / rect.width) * 1000,
    }
  }

  const onPointerDown = (handle: CropHandle) => (event: React.PointerEvent) => {
    event.preventDefault()
    ;(event.target as HTMLElement).setPointerCapture(event.pointerId)
    dragRef.current = { handle, origin: draft }
  }

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current
    if (drag === null) return
    const { py, px } = toNormalized(event.clientX, event.clientY)
    if (drag.handle === 'move') {
      // Move relative to the box centre for a stable grab feel.
      const [ymin, xmin, ymax, xmax] = drag.origin
      setDraft(moveBox(drag.origin, py - (ymin + ymax) / 2, px - (xmin + xmax) / 2))
    } else {
      setDraft(resizeBox(draft, drag.handle, py, px))
    }
  }

  const endDrag = (event: React.PointerEvent) => {
    if (dragRef.current === null) return
    ;(event.target as HTMLElement).releasePointerCapture?.(event.pointerId)
    dragRef.current = null
    onCommit(draft)
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    const side: Record<string, CropHandle> = {
      ArrowUp: 'n',
      ArrowDown: 's',
      ArrowLeft: 'w',
      ArrowRight: 'e',
    }
    const dir: Record<string, [number, number]> = {
      ArrowUp: [-NUDGE, 0],
      ArrowDown: [NUDGE, 0],
      ArrowLeft: [0, -NUDGE],
      ArrowRight: [0, NUDGE],
    }
    if (!(event.key in dir)) return
    event.preventDefault()
    const [dy, dx] = dir[event.key]
    let next: Box2d
    if (event.shiftKey) {
      // Grow the pressed side outward (Left grows the west edge leftward, …).
      next = nudgeHandle(draft, side[event.key], dy, dx)
    } else if (event.altKey) {
      next = nudgeHandle(draft, side[event.key], -dy, -dx)
    } else {
      next = moveBox(draft, dy, dx)
    }
    setDraft(next)
    onCommit(next)
  }

  const wholePage = useMemo(
    () => draft.every((v, i) => v === WHOLE_PAGE_BOX[i]),
    [draft],
  )

  return (
    <div className="figure-crop-editor">
      <div className="figure-crop-editor__stage">
        {pageUrl === null ? (
          <p className="ds-muted">{reviewMessages.sourceUnavailable}</p>
        ) : (
          <div className="figure-crop-editor__surface" ref={surfaceRef}>
            <img
              alt={reviewMessages.cropEditorPageAlt(figureNumber)}
              draggable={false}
              src={pageUrl}
            />
            {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
            <div
              aria-label={reviewMessages.cropEditorBoxLabel(figureNumber)}
              className="figure-crop-editor__box"
              onKeyDown={onKeyDown}
              onPointerDown={onPointerDown('move')}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              role="application"
              style={boxStyle(draft)}
              tabIndex={0}
            >
              {HANDLES.map(({ handle, cursor }) => {
                const pos = handlePos(draft, handle)
                return (
                  <span
                    className={`figure-crop-editor__handle figure-crop-editor__handle--${handle}`}
                    key={handle}
                    onPointerDown={onPointerDown(handle)}
                    onPointerMove={onPointerMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    style={{ top: `${pos.top}%`, left: `${pos.left}%`, cursor }}
                  />
                )
              })}
            </div>
          </div>
        )}
      </div>
      <p className="figure-crop-editor__hint ds-muted">
        {reviewMessages.cropEditorHint}
      </p>
      <div className="figure-crop-editor__actions">
        <Button
          isDisabled={wholePage}
          onPress={() => {
            setDraft(WHOLE_PAGE_BOX)
            onCommit(WHOLE_PAGE_BOX)
          }}
          variant="secondary"
        >
          {reviewMessages.cropEditorWholePage}
        </Button>
        <Button
          isDisabled={!hasOverride}
          onPress={() => onCommit(null)}
          variant="secondary"
        >
          {reviewMessages.cropEditorReset}
        </Button>
        <Button onPress={onClose} variant="primary">
          {reviewMessages.cropEditorDone}
        </Button>
      </div>
    </div>
  )
}
