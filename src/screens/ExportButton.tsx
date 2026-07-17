/**
 * The one export action. Its destination comes from the Customize tab's
 * export setting: "Export to [Triviadox]" (the logo carries the name for
 * screen readers) or "Download ZIP". There are no export variants — the
 * bundle always carries the questions exactly as they stand in review.
 */
import { Button } from '../design/components'
import type { ButtonVariant } from '../design/components'
import { exportMessages } from '../copy/messages'
import type { ExportTarget } from '../state/customization-settings'
import triviadoxLogo from '../assets/triviadox-logo.png'

export function ExportButton({
  target,
  isDisabled,
  isPending,
  onPress,
  variant,
}: {
  target: ExportTarget
  isDisabled?: boolean
  isPending?: boolean
  onPress: () => void
  variant?: ButtonVariant
}) {
  return (
    <Button
      isDisabled={isDisabled}
      isPending={isPending}
      onPress={onPress}
      variant={variant}
    >
      {target === 'zip' ? (
        exportMessages.downloadZip
      ) : (
        <>
          {exportMessages.exportToPrefix}
          <img
            alt={exportMessages.triviadoxName}
            className="ds-button__brand-logo"
            src={triviadoxLogo}
          />
        </>
      )}
    </Button>
  )
}
