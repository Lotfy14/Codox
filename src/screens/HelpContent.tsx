import { firstRunMessages, keyMessages } from '../copy/messages'

export function HelpContent() {
  return (
    <div className="ds-dialog-copy">
      <p>{firstRunMessages.welcome}</p>
      <p>{firstRunMessages.privacyNotice}</p>
      <p>{keyMessages.keyOwnership}</p>
    </div>
  )
}
