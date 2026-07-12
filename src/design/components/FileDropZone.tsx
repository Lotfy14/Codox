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
        PDF
      </div>
      <div className="ds-file-drop-zone__copy">
        <strong>{label}</strong>
        <span>{description}</span>
      </div>
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
          className="ds-button ds-button--secondary"
          isDisabled={isDisabled}
        >
          {chooseLabel}
        </AriaButton>
      </FileTrigger>
    </DropZone>
  )
}
