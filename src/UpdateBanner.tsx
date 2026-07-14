import { useEffect, useState } from 'react'
import { Button } from './design/components'
import { updateMessages } from './copy/messages'
import { checkForUpdate, type UpdateInfo } from './updater.ts'

/**
 * Shows a dismissible banner when a newer build exists on a channel that
 * cannot update itself. Windows installs and relaunches; Android downloads the
 * APK and opens the system installer. If Android refuses to install (the user
 * declined "unknown sources", say), the banner degrades to a plain download
 * link so the update is never a dead end. No-op on web — the service worker
 * keeps it current.
 */
export function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    void checkForUpdate().then(setUpdate)
  }, [])

  if (update === null || dismissed) return null

  const isAndroid = update.platform === 'android'

  return (
    <div className="ds-update-banner" role="status">
      <span className="ds-update-banner__text">
        {failed
          ? updateMessages.failed
          : updateMessages.available(update.version)}
      </span>
      {failed && update.platform === 'android' ? (
        <a className="ds-button ds-button--primary" href={update.url}>
          <span className="ds-button__content">
            <span className="ds-button__label">{updateMessages.download}</span>
          </span>
        </a>
      ) : (
        <Button
          isLoading={installing}
          loadingLabel={
            isAndroid ? updateMessages.downloading : updateMessages.installing
          }
          onPress={() => {
            setInstalling(true)
            void update.install().catch(() => {
              setInstalling(false)
              setFailed(true)
            })
          }}
        >
          {isAndroid ? updateMessages.update : updateMessages.restart}
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
