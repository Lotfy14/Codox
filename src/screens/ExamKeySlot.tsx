/**
 * The compact per-exam answer-key control (owner-approved 2026-07-22): each
 * exam row carries its own key slot instead of one key shared across a batch,
 * so a tutor can pair the right key with the right exam. Shared by the Convert
 * batch list and the Folders member list — both link the key to its exam via
 * `parentPdfId`, so the storage and engine wiring is identical.
 */
import { Button, FileDropZone } from '../design/components'
import type { FileAccept } from '../design/components'
import { convertMessages, uploadMessages } from '../copy/messages'
import type { StoredPdf } from '../state/types'

/** Keys may be a PDF or a photo/screenshot, exactly like the topics doc. */
const KEY_ACCEPT: FileAccept = {
  mimeTypes: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'],
  extensions: ['.pdf', '.png', '.jpg', '.jpeg', '.webp'],
}

export function ExamKeySlot({
  keyFile,
  isDisabled = false,
  onAdd,
  onRemove,
  onRejected,
}: {
  keyFile: StoredPdf | undefined
  isDisabled?: boolean
  onAdd: (files: File[]) => void
  onRemove: () => void
  onRejected?: (files: File[]) => void
}) {
  return (
    <div className="ds-key-file-slot ds-exam-key-slot">
      {keyFile !== undefined ? (
        <p className="ds-key-file-added" role="status">
          ✓ {convertMessages.answerKeyAddedFor(keyFile.name)}{' '}
          <Button isDisabled={isDisabled} onPress={onRemove} variant="quiet">
            {convertMessages.remove}
          </Button>
        </p>
      ) : (
        <FileDropZone
          accept={KEY_ACCEPT}
          allowsMultiple={false}
          chooseLabel={uploadMessages.chooseFiles}
          description={convertMessages.keyDropHint}
          isDisabled={isDisabled}
          label={convertMessages.keyDropTitle}
          onFiles={onAdd}
          onRejected={onRejected ?? (() => undefined)}
          pasteImages
        />
      )}
    </div>
  )
}
