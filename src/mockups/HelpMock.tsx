import { Button } from '../design/components'
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

/** Help panel content: the privacy line and every message in one place. */
export function HelpMock({ onRestartWalkthrough }: HelpMockProps) {
  return (
    <div className="mock-stack">
      <section aria-labelledby="mock-help-privacy">
        <h3 className="mock-panel-heading" id="mock-help-privacy">
          Your key and your pages
        </h3>
        <p className="mock-muted">{firstRunCopy.privacyNotice}</p>
        <h3 className="mock-panel-heading">Why export matters</h3>
        <p className="mock-muted">{exportCopy.whyExportMatters}</p>
        <div className="mock-done-actions">
          <Button onPress={onRestartWalkthrough} variant="secondary">
            Restart the walkthrough
          </Button>
        </div>
      </section>

      <section aria-labelledby="mock-help-messages">
        <h3 className="mock-panel-heading" id="mock-help-messages">
          Every message Codox can show
        </h3>
        <p className="mock-muted">
          The Phase 3 error-language pass, in one place for review. If any
          line sounds confusing, that is a bug — say which.
        </p>
        {messageGroups.map((group) => (
          <div className="mock-message-group" key={group.heading}>
            <h4>{group.heading}</h4>
            <ul>
              {group.messages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  )
}
