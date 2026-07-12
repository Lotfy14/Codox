import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './design/theme'
import './index.css'
import App from './App.tsx'
import './registerServiceWorker.ts'
import { applyPendingUpdate } from './updater.ts'

// Fire-and-forget: no-op outside the Tauri shell, never blocks render.
void applyPendingUpdate()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
