import { useState } from 'react'
import { GlassInput } from '../design/components'
import { sourceMessages } from '../copy/messages'

export function SourceField({
  initial,
  isDisabled = false,
  onCommit,
  scope = 'pdf',
}: {
  initial: string
  isDisabled?: boolean
  onCommit: (source: string) => void
  scope?: 'pdf' | 'folder'
}) {
  const [value, setValue] = useState(initial)

  return (
    <GlassInput
      description={
        scope === 'folder'
          ? sourceMessages.folderHint
          : sourceMessages.pdfHint
      }
      isDisabled={isDisabled}
      label={scope === 'folder' ? sourceMessages.folderLabel : sourceMessages.pdfLabel}
      onChange={(source) => {
        setValue(source)
        onCommit(source.trim())
      }}
      placeholder={sourceMessages.placeholder}
      value={value}
    />
  )
}
