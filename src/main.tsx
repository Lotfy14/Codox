import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './design/theme'
import './index.css'
import App from './App.tsx'
import './registerServiceWorker.ts'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
