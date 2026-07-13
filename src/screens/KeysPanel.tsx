import { GeminiKeySection } from './GeminiKeySection'

/** The real API-key panel: exactly one Google Gemini key, nothing to add. */
export function KeysPanel() {
  return (
    <div className="key-section">
      <GeminiKeySection allowRemove />
    </div>
  )
}
