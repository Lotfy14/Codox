import { useEffect, useState } from 'react'

export interface StorageEstimate {
  total: number
  used: number
}

export function useStorageEstimate(): StorageEstimate | null {
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null)

  useEffect(() => {
    let active = true
    const readEstimate = async () => {
      try {
        const result = await navigator.storage?.estimate()
        const used = result?.usage
        const total = result?.quota
        if (
          active &&
          typeof used === 'number' &&
          typeof total === 'number' &&
          total > 0
        ) {
          setEstimate({ used, total })
        }
      } catch {
        if (active) setEstimate(null)
      }
    }
    void readEstimate()
    return () => {
      active = false
    }
  }, [])

  return estimate
}
