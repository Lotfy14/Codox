import { Export } from './screens/Export'
import { Progress } from './screens/Progress'
import { Review } from './screens/Review'
import { Setup } from './screens/Setup'
import { Upload } from './screens/Upload'
import { useCurrentJob } from './state/useCurrentJob'
import type { AppStep } from './state/types'

const screenSteps: Array<{ step: AppStep; label: string }> = [
  { step: 'setup', label: 'Setup' },
  { step: 'upload', label: 'Upload' },
  { step: 'progress', label: 'Progress' },
  { step: 'review', label: 'Review' },
  { step: 'export', label: 'Export' },
]

function renderScreen(step: AppStep) {
  switch (step) {
    case 'setup':
      return <Setup />
    case 'upload':
      return <Upload />
    case 'progress':
      return <Progress />
    case 'review':
      return <Review />
    case 'export':
      return <Export />
  }
}

function App() {
  const { job, setStep } = useCurrentJob()
  const currentStep = job?.step ?? 'setup'

  return (
    <div className="app-shell">
      <header className="app-header">
        <p className="app-kicker">Codox</p>
        <p className="app-subtitle">
          Client-side exam PDF conversion scaffold.
        </p>
      </header>

      <nav aria-label="Screens" className="screen-nav">
        {screenSteps.map(({ step, label }) => (
          <button
            aria-current={step === currentStep ? 'page' : undefined}
            className="screen-nav-button"
            disabled={!job}
            key={step}
            onClick={() => void setStep(step)}
            type="button"
          >
            {label}
          </button>
        ))}
      </nav>

      <main aria-busy={!job} className="screen-panel">
        {job ? renderScreen(currentStep) : <p>Loading current job...</p>}
      </main>
    </div>
  )
}

export default App
