import { Button } from '../design/components'
import { helpMessages } from '../copy/messages'

export interface HelpContentProps {
  onOpenApi: () => void
}

export function HelpContent({ onOpenApi }: HelpContentProps) {
  return (
    <div className="help-guide">
      <p className="help-guide__intro">{helpMessages.intro}</p>
      <ol className="help-guide__steps">
        {helpMessages.steps.map((step) => (
          <li key={step.title}>
            <strong>{step.title}</strong>
            <span>{step.body}</span>
          </li>
        ))}
      </ol>
      <Button onPress={onOpenApi} variant="secondary">
        {helpMessages.openApi}
      </Button>
      <aside className="help-guide__trouble">
        <strong>{helpMessages.troubleTitle}</strong>
        <p>{helpMessages.trouble}</p>
      </aside>
      <p className="help-guide__version">{helpMessages.version(__APP_VERSION__)}</p>
    </div>
  )
}
