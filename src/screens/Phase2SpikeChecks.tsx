import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { Capacitor } from '@capacitor/core'
import { useEffect, useMemo, useState } from 'react'
import { strToU8, zipSync } from 'fflate'
import { db } from '../state/db'

// Editable in the widget so the key check survives any single model being
// overloaded — the point is to prove the key + browser call, not a model.
// Default is the most generous free tier (flash-lite: 15 RPM, 1,000/day).
const defaultGeminiModel = 'gemini-2.5-flash-lite'
const geminiModelSuggestions = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-3-flash',
  'gemini-3.1-flash-lite',
]
const firstSeenKey = 'phase2-spike-first-seen'

type PersistenceState = 'checking' | 'granted' | 'denied' | 'unsupported'

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return window.btoa(binary)
}

function buildDummyZip() {
  return zipSync({
    'codox-phase-2-spike.txt': strToU8(
      `Codox Phase 2 spike export\nCreated ${new Date().toISOString()}\n`,
    ),
  })
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function createTinyPngBase64() {
  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = 2
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Canvas unavailable')
  }

  context.fillStyle = '#17202a'
  context.fillRect(0, 0, 2, 2)
  context.fillStyle = '#ffffff'
  context.fillRect(1, 1, 1, 1)

  return canvas.toDataURL('image/png').split(',')[1] ?? ''
}

async function shareDummyZip() {
  const filename = `codox-phase-2-spike-${Date.now()}.zip`
  const zipBytes = buildDummyZip()
  const blob = new Blob([zipBytes], { type: 'application/zip' })

  if (Capacitor.isNativePlatform()) {
    const result = await Filesystem.writeFile({
      path: filename,
      data: bytesToBase64(zipBytes),
      directory: Directory.Cache,
    })

    await Share.share({
      title: 'Codox Phase 2 spike export',
      dialogTitle: 'Share dummy Codox export',
      files: [result.uri],
    })
    return 'Opened native share sheet.'
  }

  const file = new File([blob], filename, { type: 'application/zip' })
  const shareData: ShareData = {
    files: [file],
    title: 'Codox Phase 2 spike export',
    text: 'Dummy Codox export zip.',
  }

  if (navigator.canShare?.(shareData) && navigator.share) {
    await navigator.share(shareData)
    return 'Opened browser share sheet.'
  }

  downloadBlob(blob, filename)
  return 'Downloaded dummy zip.'
}

async function testGemini(apiKey: string, modelId: string) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${encodeURIComponent(
      apiKey,
    )}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: 'Reply with one short sentence that starts with Codox.' },
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: createTinyPngBase64(),
                },
              },
            ],
          },
        ],
      }),
    },
  )
  const body = await response.text()

  return `HTTP ${response.status}: ${body.slice(0, 100)}`
}

export function Phase2SpikeChecks() {
  const [pickedFile, setPickedFile] = useState('No PDF selected.')
  const [shareStatus, setShareStatus] = useState('Ready.')
  const [persistence, setPersistence] =
    useState<PersistenceState>('checking')
  const [firstSeen, setFirstSeen] = useState('Checking...')
  const [apiKey, setApiKey] = useState('')
  const [modelId, setModelId] = useState(defaultGeminiModel)
  const [geminiStatus, setGeminiStatus] = useState('Not tested.')
  const isNative = useMemo(() => Capacitor.isNativePlatform(), [])

  useEffect(() => {
    let cancelled = false

    async function checkPersistence() {
      const existing = await db.meta.get(firstSeenKey)
      const marker = existing?.value ?? new Date().toISOString()

      if (!existing) {
        await db.meta.put({ key: firstSeenKey, value: marker })
      }

      if (cancelled) {
        return
      }

      setFirstSeen(marker)

      if (!navigator.storage?.persist) {
        setPersistence('unsupported')
        return
      }

      const granted = await navigator.storage.persist()

      if (!cancelled) {
        setPersistence(granted ? 'granted' : 'denied')
      }
    }

    void checkPersistence().catch((error: unknown) => {
      if (!cancelled) {
        setFirstSeen(error instanceof Error ? error.message : 'Unknown error')
        setPersistence('denied')
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section
      aria-labelledby="phase-2-spike-heading"
      className="phase-2-spike"
    >
      <div className="phase-2-spike-header">
        <p className="phase-2-spike-label">Temporary</p>
        <h2 id="phase-2-spike-heading">Phase 2 spike checks</h2>
      </div>

      <div className="spike-grid">
        <label className="spike-field">
          <span>PDF picker</span>
          <input
            accept="application/pdf"
            onChange={(event) => {
              const file = event.target.files?.[0]
              setPickedFile(
                file ? `${file.name} (${file.size} bytes)` : 'No PDF selected.',
              )
            }}
            type="file"
          />
        </label>
        <p className="spike-result">{pickedFile}</p>

        <div className="spike-action">
          <button
            onClick={() => {
              setShareStatus('Preparing zip...')
              void shareDummyZip()
                .then(setShareStatus)
                .catch((error: unknown) => {
                  setShareStatus(
                    error instanceof Error ? error.message : 'Share failed.',
                  )
                })
            }}
            type="button"
          >
            Share dummy zip
          </button>
          <p className="spike-result">
            {shareStatus} {isNative ? 'Native shell detected.' : 'Web shell.'}
          </p>
        </div>

        <div className="spike-readout">
          <p>Persistence: {persistence}</p>
          <p>Stored marker: {firstSeen}</p>
        </div>

        <div className="spike-gemini">
          <label className="spike-field">
            <span>Gemini API key</span>
            <input
              autoComplete="off"
              onChange={(event) => setApiKey(event.target.value)}
              type="password"
              value={apiKey}
            />
          </label>
          <label className="spike-field">
            <span>Model (switch if one is overloaded)</span>
            <input
              autoComplete="off"
              list="gemini-model-options"
              onChange={(event) => setModelId(event.target.value)}
              spellCheck={false}
              type="text"
              value={modelId}
            />
          </label>
          <datalist id="gemini-model-options">
            {geminiModelSuggestions.map((suggestion) => (
              <option key={suggestion} value={suggestion} />
            ))}
          </datalist>
          <button
            disabled={!apiKey.trim() || !modelId.trim()}
            onClick={() => {
              setGeminiStatus(`Testing ${modelId.trim()}...`)
              void testGemini(apiKey.trim(), modelId.trim())
                .then(setGeminiStatus)
                .catch((error: unknown) => {
                  setGeminiStatus(
                    error instanceof Error ? error.message : 'Request failed.',
                  )
                })
            }}
            type="button"
          >
            Test Gemini
          </button>
          <p className="spike-result">
            Model: {modelId.trim() || '(none)'}. {geminiStatus}
          </p>
        </div>
      </div>
    </section>
  )
}
