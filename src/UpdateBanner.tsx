import { useEffect, useState } from 'react'
import { Button } from './design/components'
import { updateMessages } from './copy/messages'
import { checkForUpdate, type UpdateInfo } from './updater.ts'

/**
 * Shows a dismissible banner when a newer build exists on a channel that
 * cannot update itself (Android) or, on Windows, offers the signed install.
 * No-op on web — the service worker keeps it current.
 */
export function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    void checkForUpdate().then(setUpdate)
  }, [])

  if (update === null || dismissed) return null

  return (
    <div className="ds-update-banner" role="status">
      <span className="ds-update-banner__text">
        {updateMessages.available(update.version)}
      </span>
      {update.platform === 'android' ? (
        <a className="ds-button ds-button--primary" href={update.url}>
          <span className="ds-button__content">
            <span className="ds-button__label">{updateMessages.download}</span>
          </span>
        </a>
      ) : (
        <Button
          isLoading={installing}
          loadingLabel={updateMessages.installing}
          onPress={() => {
            setInstalling(true)
            void update.install().catch(() => setInstalling(false))
          }}
        >
          {updateMessages.restart}
        </Button>
      )}
      <Button
        aria-label={updateMessages.dismiss}
        onPress={() => setDismissed(true)}
        variant="quiet"
      >
        ✕
      </Button>
    </div>
  )
}
