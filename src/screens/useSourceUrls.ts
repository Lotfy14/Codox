import { useEffect, useState } from 'react'
import { boxToCropBox } from '../engine/boxes'
import { getPageArtifact } from '../state/runs'
import type { ReviewRow } from './review-data'

interface SourceUrls {
  crop: string | null
  page: string | null
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
  const [urls, setUrls] = useState<SourceUrls>({ crop: null, page: null })

  useEffect(() => {
    let cancelled = false
    const created: string[] = []
    const load = async () => {
      if (reviewRow?.pageIndex == null) {
        setUrls({ crop: null, page: null })
        return
      }
      const artifact = await getPageArtifact(runId, reviewRow.pageIndex)
      if (artifact?.bytes === undefined) {
        if (!cancelled) setUrls({ crop: null, page: null })
        return
      }
      const pageBlob = new Blob(
        [artifact.bytes as Uint8Array<ArrayBuffer>],
        { type: 'image/jpeg' },
      )
      let cropUrl: string | null = null
      if (
        reviewRow.box !== null &&
        artifact.width !== undefined &&
        artifact.height !== undefined
      ) {
        try {
          const { cropJpeg } = await import('../pdf/images')
          const cropBlob = await cropJpeg(
            pageBlob,
            boxToCropBox(reviewRow.box, artifact.width, artifact.height),
          )
          cropUrl = URL.createObjectURL(cropBlob)
        } catch {
          cropUrl = null
        }
      }
      const pageUrl = URL.createObjectURL(pageBlob)
      if (cancelled) {
        if (cropUrl !== null) URL.revokeObjectURL(cropUrl)
        URL.revokeObjectURL(pageUrl)
        return
      }
      if (cropUrl !== null) created.push(cropUrl)
      created.push(pageUrl)
      setUrls({ crop: cropUrl, page: pageUrl })
    }
    void load()
    return () => {
      cancelled = true
      for (const url of created) URL.revokeObjectURL(url)
      setUrls({ crop: null, page: null })
    }
  }, [runId, reviewRow])

  return urls
}
