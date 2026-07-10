import { Button as AriaButton } from 'react-aria-components/Button'
import { DropZone } from 'react-aria-components/DropZone'
import { FileTrigger } from 'react-aria-components/FileTrigger'
import { isFileDropItem } from 'react-aria-components/useDragAndDrop'

export interface FileDropZoneProps {
  allowsMultiple?: boolean
  className?: string
  description?: string
  isDisabled?: boolean
  label?: string
  onFiles: (files: File[]) => void
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

export function FileDropZone({
  allowsMultiple = true,
  className,
  description = 'PDF files only',
  isDisabled = false,
  label = 'Drop exam PDFs here',
  onFiles,
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
          if (pdfs.length > 0) onFiles(allowsMultiple ? pdfs : pdfs.slice(0, 1))
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
          const files = fileList ? Array.from(fileList).filter(isPdf) : []
          if (files.length > 0) onFiles(files)
        }}
      >
        <AriaButton
          className="ds-button ds-button--secondary"
          isDisabled={isDisabled}
        >
          Choose files
        </AriaButton>
      </FileTrigger>
    </DropZone>
  )
}
