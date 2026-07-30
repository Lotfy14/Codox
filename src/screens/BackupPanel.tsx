/**
 * Backup & restore, on the History tab — where a tutor's saved work lives and
 * where losing it hurts. Three things in one panel, in the order that matters:
 * whether this browser has promised not to evict Codox's storage, how to take
 * a backup out of the app, and how to put one back.
 *
 * Everything here is feature-detected, never platform-detected: the automatic
 * section explains itself where the File System Access API is missing rather
 * than disappearing, so a tutor on Firefox knows why the button is not there.
 */
import { useCallback, useEffect, useState } from 'react'
import { fileOpen, fileSave } from 'browser-fs-access'
import { Badge, Button, ChoiceGroup, GlassPanel } from '../design/components'
import type { BadgeTone, ChoiceOption } from '../design/components'
import { backupMessages } from '../copy/messages'
import {
  BACKUP_EXTENSION,
  BackupFormatError,
  createBackup,
  hasBackableWork,
  restoreBackup,
  type BackupScope,
} from '../state/backup'
import {
  chooseAutoBackupFolder,
  clearAutoBackupFolder,
  readAutoBackupFolder,
  reconnectAutoBackupFolder,
  supportsAutoBackup,
  type AutoBackupFolder,
} from '../state/auto-backup'
import {
  requestStoragePersistedAgain,
  useStorageProtection,
} from '../state/persist'

const SCOPE_OPTIONS: readonly ChoiceOption<BackupScope>[] = [
  {
    value: 'work',
    label: backupMessages.scopeWork,
    hint: backupMessages.scopeWorkHint,
  },
  {
    value: 'everything',
    label: backupMessages.scopeEverything,
    hint: backupMessages.scopeEverythingHint,
  },
]

type Notice = { text: string; tone: 'info' | 'danger' | 'working' } | null

function formatWhen(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp))
}

export function BackupPanel() {
  const protection = useStorageProtection()
  const [scope, setScope] = useState<BackupScope>('work')
  const [busy, setBusy] = useState<'save' | 'restore' | 'protect' | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [folder, setFolder] = useState<AutoBackupFolder | null>(null)
  const autoSupported = supportsAutoBackup()

  const refreshFolder = useCallback(async () => {
    setFolder(await readAutoBackupFolder())
  }, [])

  useEffect(() => {
    void refreshFolder()
  }, [refreshFolder])

  const protectionTone: BadgeTone =
    protection === 'protected'
      ? 'success'
      : protection === 'best-effort'
        ? 'warning'
        : 'neutral'

  const protectionText =
    protection === null
      ? backupMessages.protectionChecking
      : protection === 'protected'
        ? backupMessages.protectionProtected
        : protection === 'best-effort'
          ? backupMessages.protectionBestEffort
          : backupMessages.protectionUnsupported

  const handleProtect = async () => {
    if (busy !== null) return
    setBusy('protect')
    setNotice(null)
    try {
      const state = await requestStoragePersistedAgain()
      if (state !== 'protected') {
        setNotice({ text: backupMessages.protectRefused, tone: 'info' })
      }
    } finally {
      setBusy(null)
    }
  }

  const handleSave = async () => {
    if (busy !== null) return
    setBusy('save')
    setNotice(null)
    try {
      if (!(await hasBackableWork())) {
        setNotice({ text: backupMessages.saveEmpty, tone: 'info' })
        return
      }
      const backup = await createBackup(scope, __APP_VERSION__)
      const file = new File(
        [backup.bytes as Uint8Array<ArrayBuffer>],
        backup.fileName,
        { type: 'application/zip' },
      )
      const handle = await fileSave(file, {
        fileName: backup.fileName,
        extensions: [BACKUP_EXTENSION],
      })
      // A handle means the Save-As picker ran; null means the browser fell
      // back to a plain download, so the UI must say where the file went.
      setNotice({
        text:
          handle === null
            ? backupMessages.saveDownloaded(backup.folders, backup.runs)
            : backupMessages.saveDone(backup.folders, backup.runs),
        tone: 'working',
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setNotice({ text: backupMessages.saveCancelled, tone: 'info' })
        return
      }
      console.error('Codox backup failed:', error)
      setNotice({ text: backupMessages.saveFailed, tone: 'danger' })
    } finally {
      setBusy(null)
    }
  }

  const handleRestore = async () => {
    if (busy !== null) return
    setNotice(null)
    let bytes: Uint8Array
    try {
      const picked = await fileOpen({
        extensions: [BACKUP_EXTENSION],
        mimeTypes: ['application/zip'],
      })
      bytes = new Uint8Array(await picked.arrayBuffer())
    } catch {
      return // Dismissed picker: say nothing.
    }
    setBusy('restore')
    try {
      const summary = await restoreBackup(bytes)
      setNotice({
        text:
          backupMessages.restoreDone(summary) +
          (summary.skipped > 0
            ? backupMessages.restoreSkipped(summary.skipped)
            : ''),
        tone: 'working',
      })
    } catch (error) {
      setNotice({
        text:
          error instanceof BackupFormatError
            ? error.message === 'newer-version'
              ? backupMessages.restoreNewer
              : backupMessages.restoreNotABackup
            : backupMessages.restoreFailed,
        tone: 'danger',
      })
    } finally {
      setBusy(null)
    }
  }

  const autoStatusText =
    folder === null
      ? backupMessages.autoOff
      : folder.permission === 'granted'
        ? backupMessages.autoOn(folder.name)
        : backupMessages.autoNeedsPermission(folder.name)

  return (
    <GlassPanel
      aria-labelledby="backup-heading"
      as="section"
      className="backup-panel"
      padding="default"
    >
      <div className="backup-panel__head">
        <h2 id="backup-heading">{backupMessages.title}</h2>
        <Badge tone={protectionTone}>
          {backupMessages.protectionBadge[protection ?? 'checking']}
        </Badge>
      </div>
      <p className="ds-muted">{backupMessages.intro}</p>

      <p className="ds-inline-note ds-inline-note--info" role="status">
        {protectionText}
      </p>
      {protection === 'best-effort' ? (
        <div className="backup-panel__actions">
          <Button
            isPending={busy === 'protect'}
            onPress={() => void handleProtect()}
            variant="secondary"
          >
            {backupMessages.protectAction}
          </Button>
        </div>
      ) : null}

      <h3 className="backup-panel__sub">{backupMessages.backupHeading}</h3>
      <ChoiceGroup
        legend={backupMessages.scopeLabel}
        onChange={setScope}
        options={SCOPE_OPTIONS}
        value={scope}
      />
      <div className="backup-panel__actions">
        <Button isPending={busy === 'save'} onPress={() => void handleSave()}>
          {backupMessages.saveAction}
        </Button>
      </div>
      <p className="ds-muted">{backupMessages.keyNote}</p>

      <h3 className="backup-panel__sub">{backupMessages.autoHeading}</h3>
      {!autoSupported ? (
        <p className="ds-muted">{backupMessages.autoUnsupported}</p>
      ) : (
        <>
          <p className="ds-muted">{backupMessages.autoIntro}</p>
          <p className="ds-inline-note ds-inline-note--info" role="status">
            {autoStatusText}
          </p>
          <p className="ds-muted">
            {folder?.lastBackupAt != null
              ? backupMessages.autoLast(formatWhen(folder.lastBackupAt))
              : backupMessages.autoNever}
          </p>
          <div className="backup-panel__actions">
            {folder !== null && folder.permission !== 'granted' ? (
              <Button
                onPress={() => {
                  void reconnectAutoBackupFolder().then(setFolder)
                }}
              >
                {backupMessages.autoReconnectAction}
              </Button>
            ) : null}
            <Button
              onPress={() => {
                void chooseAutoBackupFolder().then((picked) => {
                  if (picked !== null) setFolder(picked)
                })
              }}
              variant={folder === null ? 'primary' : 'secondary'}
            >
              {folder === null
                ? backupMessages.autoChooseAction
                : backupMessages.autoChangeAction}
            </Button>
            {folder !== null ? (
              <Button
                onPress={() => {
                  void clearAutoBackupFolder().then(() => setFolder(null))
                }}
                variant="quiet"
              >
                {backupMessages.autoOffAction}
              </Button>
            ) : null}
          </div>
        </>
      )}

      <h3 className="backup-panel__sub">{backupMessages.restoreHeading}</h3>
      <p className="ds-muted">{backupMessages.restoreIntro}</p>
      <div className="backup-panel__actions">
        <Button
          isPending={busy === 'restore'}
          onPress={() => void handleRestore()}
          variant="secondary"
        >
          {backupMessages.restoreAction}
        </Button>
      </div>
      <p className="ds-muted">{backupMessages.restoreWorkNote}</p>

      {notice !== null ? (
        <p
          className={`ds-inline-note ds-inline-note--${notice.tone}`}
          role="status"
        >
          {notice.text}
        </p>
      ) : null}
    </GlassPanel>
  )
}
