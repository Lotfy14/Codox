import { lazy, Suspense, useState } from 'react'
import { Export } from './screens/Export'
import { Progress } from './screens/Progress'
import { Review } from './screens/Review'
import { Setup } from './screens/Setup'
import { Upload } from './screens/Upload'
import { useCurrentJob } from './state/useCurrentJob'
import type { AppStep } from './state/types'

const DesignGalleryScreen = import.meta.env.DEV
  ? lazy(() =>
      import('./screens/DesignGallery').then(({ DesignGallery }) => ({
        default: DesignGallery,
      })),
    )
  : null

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
  // Phase-3 owner review surface. Keep out of persisted JobState/AppStep.
  const galleryAvailable = import.meta.env.DEV
  const [galleryOpen, setGalleryOpen] = useState(
    () =>
      galleryAvailable &&
      new URLSearchParams(window.location.search).get('gallery') === '1',
  )

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
            aria-current={
              !galleryOpen && step === currentStep ? 'page' : undefined
            }
            className="screen-nav-button"
            disabled={!job}
            key={step}
            onClick={() => {
              setGalleryOpen(false)
              void setStep(step)
            }}
            type="button"
          >
            {label}
          </button>
        ))}
        {galleryAvailable ? (
          <button
            aria-current={galleryOpen ? 'page' : undefined}
            className="screen-nav-button"
            onClick={() => setGalleryOpen(true)}
            type="button"
          >
            Gallery
          </button>
        ) : null}
      </nav>

      <main aria-busy={!galleryOpen && !job} className="screen-panel">
        {galleryOpen && DesignGalleryScreen ? (
          <Suspense fallback={<p>Loading design gallery...</p>}>
            <DesignGalleryScreen />
          </Suspense>
        ) : job ? (
          renderScreen(currentStep)
        ) : (
          <p>Loading current job...</p>
        )}
      </main>
    </div>
  )
}

export default App
