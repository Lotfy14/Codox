import { useEffect, useState } from 'react'
import { boxToCropBox } from '../engine/boxes'
import { getPageArtifact } from '../state/runs'
import type { ReviewRow } from './review-data'

interface SourceUrls {
  crop: string | null
  page: string | null
  /** Cropped linked figures, in blueprint order. */
  figures: string[]
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

export function isActivationTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.tagName === 'BUTTON' ||
    target.tagName === 'A' ||
    target.getAttribute('role') === 'button'
}

export function useOffline(): boolean {
  const [offline, setOffline] = useState(() => !navigator.onLine)
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  return offline
}

export function useSourceUrls(
  runId: string,
  reviewRow: ReviewRow | undefined,
): SourceUrls {
  const [urls, setUrls] = useState<SourceUrls>({ crop: null, page: null, figures: [] })

  useEffect(() => {
    let cancelled = false
    const created: string[] = []
    const load = async () => {
      if (reviewRow?.pageIndex == null) {
        setUrls({ crop: null, page: null, figures: [] })
        return
      }
      const artifact = await getPageArtifact(runId, reviewRow.pageIndex)
      if (artifact?.bytes === undefined) {
        if (!cancelled) setUrls({ crop: null, page: null, figures: [] })
        return
      }
      const { cropJpeg } = await import('../pdf/images')
      // Page blobs are cached by index so a figure sharing the question's
      // page (or two figures on one page) is only decoded once.
      const pages = new Map<number, { blob: Blob; width?: number; height?: number }>()
      pages.set(reviewRow.pageIndex, {
        blob: new Blob([artifact.bytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }),
        width: artifact.width,
        height: artifact.height,
      })
      const pageFor = async (pageIndex: number) => {
        const cached = pages.get(pageIndex)
        if (cached !== undefined) return cached
        const found = await getPageArtifact(runId, pageIndex)
        const entry = found?.bytes === undefined
          ? null
          : {
              blob: new Blob([found.bytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }),
              width: found.width,
              height: found.height,
            }
        if (entry !== null) pages.set(pageIndex, entry)
        return entry
      }
      const cropFrom = async (
        source: { blob: Blob; width?: number; height?: number },
        box: typeof reviewRow.box,
      ): Promise<string | null> => {
        if (box === null || source.width === undefined || source.height === undefined) return null
        try {
          const cropBlob = await cropJpeg(source.blob, boxToCropBox(box, source.width, source.height))
          return URL.createObjectURL(cropBlob)
        } catch {
          return null
        }
      }

      const questionPage = pages.get(reviewRow.pageIndex)!
      const cropUrl = await cropFrom(questionPage, reviewRow.box)
      const figureUrls: string[] = []
      for (const figure of reviewRow.figures) {
        const source = await pageFor(figure.pageIndex)
        if (source === null) continue
        const url = await cropFrom(source, figure.box)
        if (url !== null) figureUrls.push(url)
      }
      const pageUrl = URL.createObjectURL(questionPage.blob)
      if (cancelled) {
        if (cropUrl !== null) URL.revokeObjectURL(cropUrl)
        for (const url of figureUrls) URL.revokeObjectURL(url)
        URL.revokeObjectURL(pageUrl)
        return
      }
      if (cropUrl !== null) created.push(cropUrl)
      created.push(...figureUrls, pageUrl)
      setUrls({ crop: cropUrl, page: pageUrl, figures: figureUrls })
    }
    void load()
    return () => {
      cancelled = true
      for (const url of created) URL.revokeObjectURL(url)
      setUrls({ crop: null, page: null, figures: [] })
    }
  }, [runId, reviewRow])

  return urls
}
