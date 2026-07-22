import { useEffect, useState } from 'react'
import { boxToCropBox } from '../engine/boxes'
import { getArtifacts, getPageArtifact } from '../state/runs'
import type { ReviewRow } from './review-data'
import type { FigureCrops } from './review-figure-crops'

/** One linked figure's preview: its crop URL and the override key. */
export interface FigurePreview {
  url: string
  /** Bundle crop path — the key an adjust-crop override is stored under. */
  path: string
  /** 0-based page index the figure lives on (for the crop editor). */
  pageIndex: number
}

interface SourceUrls {
  crop: string | null
  page: string | null
  /** Cropped linked figures, in blueprint order. */
  figures: FigurePreview[]
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

/** One extracted picture the tutor can link: bundle path + preview URL. */
export interface CropAsset {
  path: string
  url: string
}

/**
 * The run's stored figure crops as object URLs — edit mode's linked-picture
 * picker. Loads only while `enabled` (crops are read once, URLs revoked on
 * close) so the review screen itself never pays for it.
 */
export function useCropAssets(runId: string, enabled: boolean): CropAsset[] {
  const [assets, setAssets] = useState<CropAsset[]>([])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const created: string[] = []
    void getArtifacts(runId, 'crop').then((crops) => {
      const list = crops.flatMap((crop) => {
        if (crop.path === undefined || crop.bytes === undefined) return []
        const url = URL.createObjectURL(
          new Blob([crop.bytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }),
        )
        created.push(url)
        return [{ path: crop.path, url }]
      })
      if (cancelled) {
        for (const url of created) URL.revokeObjectURL(url)
        return
      }
      setAssets(list)
    })
    return () => {
      cancelled = true
      for (const url of created) URL.revokeObjectURL(url)
      setAssets([])
    }
  }, [runId, enabled])

  return assets
}

export function useSourceUrls(
  runId: string,
  reviewRow: ReviewRow | undefined,
  figureOverrides?: FigureCrops,
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
      const figureList: FigurePreview[] = []
      for (const figure of reviewRow.figures) {
        const source = await pageFor(figure.pageIndex)
        if (source === null) continue
        // The tutor's adjusted crop wins over the auto (padded) box.
        const box = figureOverrides?.[figure.path] ?? figure.box
        const url = await cropFrom(source, box)
        if (url !== null) {
          figureList.push({ url, path: figure.path, pageIndex: figure.pageIndex })
        }
      }
      const pageUrl = URL.createObjectURL(questionPage.blob)
      if (cancelled) {
        if (cropUrl !== null) URL.revokeObjectURL(cropUrl)
        for (const figure of figureList) URL.revokeObjectURL(figure.url)
        URL.revokeObjectURL(pageUrl)
        return
      }
      if (cropUrl !== null) created.push(cropUrl)
      created.push(...figureList.map((figure) => figure.url), pageUrl)
      setUrls({ crop: cropUrl, page: pageUrl, figures: figureList })
    }
    void load()
    return () => {
      cancelled = true
      for (const url of created) URL.revokeObjectURL(url)
      setUrls({ crop: null, page: null, figures: [] })
    }
  }, [runId, reviewRow, figureOverrides])

  return urls
}
