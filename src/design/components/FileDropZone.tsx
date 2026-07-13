import { Button as AriaButton } from 'react-aria-components/Button'
import { DropZone } from 'react-aria-components/DropZone'
import { FileTrigger } from 'react-aria-components/FileTrigger'
import { isFileDropItem } from 'react-aria-components/useDragAndDrop'

export interface FileDropZoneProps {
  allowsMultiple?: boolean
  className?: string
  chooseLabel: string
  description: string
  isDisabled?: boolean
  label: string
  onFiles: (files: File[]) => void
  onRejected?: (files: File[]) => void
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

export function FileDropZone({
  allowsMultiple = true,
  className,
  chooseLabel,
  description,
  isDisabled = false,
  label,
  onFiles,
  onRejected,
}: FileDropZoneProps) {
  return (
    <DropZone
      aria-label={label}
      className={['ds-file-drop-zone', className].filter(Boolean).join(' ')}
      isDisabled={isDisabled}
      onDrop={(event) => {
        const pendingFiles = event.items
          .filter(isFileDropItem)
          .map((item) => item.getFile())

        void Promise.all(pendingFiles).then((files) => {
          const pdfs = files.filter(isPdf)
          const rejected = files.filter((file) => !isPdf(file))
          if (pdfs.length > 0) onFiles(allowsMultiple ? pdfs : pdfs.slice(0, 1))
          if (rejected.length > 0) onRejected?.(rejected)
        })
      }}
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
        acceptedFileTypes={['application/pdf']}
        allowsMultiple={allowsMultiple}
        onSelect={(fileList) => {
          const selected = fileList ? Array.from(fileList) : []
          const files = selected.filter(isPdf)
          const rejected = selected.filter((file) => !isPdf(file))
          if (files.length > 0) onFiles(allowsMultiple ? files : files.slice(0, 1))
          if (rejected.length > 0) onRejected?.(rejected)
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
