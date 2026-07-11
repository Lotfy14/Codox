import { Button, GlassPanel, ThemeSwitcher } from '../design/components'
import {
  exportCopy,
  firstRunCopy,
  historyCopy,
  keyCopy,
  progressCopy,
  reviewCopy,
  uploadCopy,
} from './copy'

interface MessageGroup {
  heading: string
  messages: readonly string[]
}

const messageGroups: readonly MessageGroup[] = [
  {
    heading: 'Checking a key',
    messages: [
      keyCopy.emptyKey,
      keyCopy.checking,
      keyCopy.working,
      keyCopy.wrongKey('Groq'),
      keyCopy.unreachable('Groq'),
      keyCopy.quotaPaused('Groq'),
      keyCopy.failoverExplainer,
    ],
  },
  {
    heading: 'While converting',
    messages: [
      progressCopy.pausedQuota,
      progressCopy.offline,
      progressCopy.providerSwitch('Groq', 'OpenRouter'),
      progressCopy.allProvidersResting,
      progressCopy.badPage(7, 'bio_exam.pdf'),
      progressCopy.wrongDeclaration('maths_mock.pdf'),
      progressCopy.finishedWithFlags(4),
      progressCopy.finishedClean,
    ],
  },
  {
    heading: 'Adding files',
    messages: [
      uploadCopy.notPdf('notes.docx'),
      uploadCopy.encryptedPdf('chemistry_final.pdf'),
      uploadCopy.needsKeyFile,
    ],
  },
  {
    heading: 'Reviewing flags',
    messages: [
      reviewCopy.whyFlagged['blank-answer'],
      reviewCopy.whyFlagged['conflicting-marks'],
      reviewCopy.whyFlagged['length-mismatch'],
      reviewCopy.whyFlagged['low-confidence'],
      reviewCopy.flagsRemainOnExport(3),
      reviewCopy.offlineIsFine,
      reviewCopy.allResolved,
    ],
  },
  {
    heading: 'Exporting and History',
    messages: [
      exportCopy.exportDone,
      exportCopy.whyExportMatters,
      historyCopy.reRunNeedsOriginal,
      historyCopy.deleteBody,
    ],
  },
]

export interface HelpMockProps {
  onRestartWalkthrough: () => void
}

/** The Help tab: appearance, the privacy line, and every message in one place. */
export function HelpMock({ onRestartWalkthrough }: HelpMockProps) {
  return (
    <section aria-labelledby="mock-help-heading" className="mock-screen">
      <header className="mock-screen__header">
        <h1 id="mock-help-heading">Help</h1>
        <p>{firstRunCopy.welcome}</p>
      </header>

      <div className="mock-stack">
        <GlassPanel as="section" aria-label="Appearance" padding="default">
          <ThemeSwitcher />
        </GlassPanel>

        <GlassPanel as="section" aria-labelledby="mock-help-privacy" padding="default">
          <h2 className="mock-panel-heading" id="mock-help-privacy">
            Your key and your pages
          </h2>
          <p className="mock-muted">{firstRunCopy.privacyNotice}</p>
          <h2 className="mock-panel-heading">Why export matters</h2>
          <p className="mock-muted">{exportCopy.whyExportMatters}</p>
          <div className="mock-done-actions">
            <Button onPress={onRestartWalkthrough} variant="secondary">
              Restart the walkthrough
            </Button>
          </div>
        </GlassPanel>

        <GlassPanel
          as="section"
          aria-labelledby="mock-help-messages"
          padding="default"
        >
          <h2 className="mock-panel-heading" id="mock-help-messages">
            Every message Codox can show
          </h2>
          <p className="mock-muted">
            The Phase 3 error-language pass, in one place for review. If any
            line sounds confusing, that is a bug — say which.
          </p>
          {messageGroups.map((group) => (
            <div className="mock-message-group" key={group.heading}>
              <h3>{group.heading}</h3>
              <ul>
                {group.messages.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </div>
          ))}
        </GlassPanel>
      </div>
    </section>
  )
}
