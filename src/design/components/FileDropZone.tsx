import { useEffect, useRef } from 'react'
import { Button as AriaButton } from 'react-aria-components/Button'
import { DropZone } from 'react-aria-components/DropZone'
import { FileTrigger } from 'react-aria-components/FileTrigger'
import { isFileDropItem } from 'react-aria-components/useDragAndDrop'

export interface FileAccept {
  mimeTypes: readonly string[]
  extensions: readonly string[]
}

/** File extension to give a pasted clipboard image, by its MIME type. */
function pastedImageExtension(type: string): string {
  if (type === 'image/png') return 'png'
  if (type === 'image/gif') return 'gif'
  if (type === 'image/webp') return 'webp'
  return 'jpg'
}

/** Turn the clipboard's image items into named Files (they arrive nameless). */
function clipboardImages(data: DataTransfer | null): File[] {
  if (data === null) return []
  const files: File[] = []
  for (const item of data.items) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (file === null) continue
    files.push(
      new File(
        [file],
        `pasted-${crypto.randomUUID()}.${pastedImageExtension(item.type)}`,
        { type: item.type },
      ),
    )
  }
  return files
}

/** The default acceptance: PDFs only, as every original zone expects. */
const PDF_ACCEPT: FileAccept = {
  mimeTypes: ['application/pdf'],
  extensions: ['.pdf'],
}

export interface FileDropZoneProps {
  /** Accepted types; omit for the PDF-only default. */
  accept?: FileAccept
  allowsMultiple?: boolean
  className?: string
  chooseLabel: string
  description: string
  isDisabled?: boolean
  label: string
  onFiles: (files: File[]) => void
  onRejected?: (files: File[]) => void
  /**
   * When set, a clipboard image pasted while the pointer is over this zone
   * (or the zone holds focus) is routed through `onFiles` exactly like a
   * dropped file. Off by default so the exam zone — and paste elsewhere — is
   * untouched. Scoped to the hovered/focused zone so two image zones on one
   * screen never both consume the same paste.
   */
  pasteImages?: boolean
}

function isAccepted(file: File, accept: FileAccept): boolean {
  const name = file.name.toLowerCase()
  return (
    accept.mimeTypes.includes(file.type) ||
    accept.extensions.some((extension) => name.endsWith(extension))
  )
}

export function FileDropZone({
  accept = PDF_ACCEPT,
  allowsMultiple = true,
  className,
  chooseLabel,
  description,
  isDisabled = false,
  label,
  onFiles,
  onRejected,
  pasteImages = false,
}: FileDropZoneProps) {
  const zoneRef = useRef<HTMLDivElement>(null)
  const split = (files: File[]) => {
    const accepted = files.filter((file) => isAccepted(file, accept))
    const rejected = files.filter((file) => !isAccepted(file, accept))
    if (accepted.length > 0) {
      onFiles(allowsMultiple ? accepted : accepted.slice(0, 1))
    }
    if (rejected.length > 0) onRejected?.(rejected)
  }
  // Always call through the latest `split` (it closes over the current
  // accept/onFiles/onRejected) without re-subscribing the window listener
  // every render.
  const splitRef = useRef(split)
  splitRef.current = split

  useEffect(() => {
    if (!pasteImages || isDisabled) return
    const onPaste = (event: ClipboardEvent) => {
      // Already handled by another zone's listener this event: never twice.
      if (event.defaultPrevented) return
      const zone = zoneRef.current
      if (zone === null) return
      // Route to the zone the pointer is over, or the focused one — the two
      // ways a user aims a paste at a specific drop area.
      const aimed =
        zone.matches(':hover') || zone.contains(document.activeElement)
      if (!aimed) return
      const files = clipboardImages(event.clipboardData)
      if (files.length === 0) return
      event.preventDefault()
      // `split` applies `allowsMultiple` itself, so hand it every image.
      splitRef.current(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [pasteImages, isDisabled])

  return (
    <DropZone
      aria-label={label}
      className={['ds-file-drop-zone', className].filter(Boolean).join(' ')}
      isDisabled={isDisabled}
      onDrop={(event) => {
        const pendingFiles = event.items
          .filter(isFileDropItem)
          .map((item) => item.getFile())

        void Promise.all(pendingFiles).then(split)
      }}
      ref={pasteImages ? zoneRef : undefined}
    >
      <div aria-hidden="true" className="ds-file-drop-zone__mark">
        <svg
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <path d="M12 16V4" />
          <path d="M8 8l4-4 4 4" />
          <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
        </svg>
      </div>
      <div className="ds-file-drop-zone__copy">
        <strong>{label}</strong>
        <span>{description}</span>
      </div>
      {/* The trigger stretches invisibly across the zone: clicking or
          keyboard-activating anywhere opens the file picker. */}
      <FileTrigger
        acceptedFileTypes={[...accept.mimeTypes]}
        allowsMultiple={allowsMultiple}
        onSelect={(fileList) => {
          split(fileList ? Array.from(fileList) : [])
        }}
      >
        <AriaButton
          aria-label={chooseLabel}
          className="ds-file-drop-zone__trigger"
          isDisabled={isDisabled}
        />
      </FileTrigger>
    </DropZone>
  )
}
