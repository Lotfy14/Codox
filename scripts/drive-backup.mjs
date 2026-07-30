// Smoke test for Backup & restore (History tab). Launches Edge headless
// against the running dev server (port 5173), seeds a folder + a finished run
// with rows and a crop straight into IndexedDB, saves a backup through the
// real Save-As path, wipes the database the way an eviction would, restores
// the file, and checks the work came back. Screenshots to scripts/out/.
// Run: node scripts/drive-backup.mjs
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const OUT = fileURLToPath(new URL('./out/', import.meta.url))
mkdirSync(OUT, { recursive: true })
// Vite picks the next free port when 5173 is taken; override with PORT=.
const ORIGIN = `http://localhost:${process.env.PORT ?? 5173}/`

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const context = await browser.newContext({ acceptDownloads: true })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

// The OS file dialogs cannot be automated, so both pickers are stubbed and
// the saved bytes are kept in the page. Everything on either side of the
// dialog is real: button → createBackup → zip → browser-fs-access on the way
// out, and browser-fs-access → restoreBackup → Dexie on the way back. The
// bytes the restore reads are the exact bytes the save produced — no file is
// hand-built for the test.
await context.addInitScript(() => {
  window.showSaveFilePicker = async (options) => ({
    name: options?.suggestedName ?? 'unnamed',
    // browser-fs-access pipes the blob into this, so it must be a genuine
    // WritableStream — a duck-typed object fails with a pipeTo TypeError.
    createWritable: async () => {
      const chunks = []
      return new WritableStream({
        write(chunk) {
          chunks.push(chunk)
        },
        close() {
          const total = chunks.reduce((n, c) => n + c.length, 0)
          const bytes = new Uint8Array(total)
          let at = 0
          for (const chunk of chunks) {
            bytes.set(chunk, at)
            at += chunk.length
          }
          window.__savedBackup = {
            name: options?.suggestedName ?? 'unnamed',
            bytes: Array.from(bytes),
          }
        },
      })
    },
  })
  window.showOpenFilePicker = async () => {
    const saved = window.__savedBackup
    if (saved === undefined) throw new DOMException('no file', 'AbortError')
    return [
      {
        name: saved.name,
        kind: 'file',
        getFile: async () =>
          new File([new Uint8Array(saved.bytes)], saved.name, {
            type: 'application/zip',
          }),
      },
    ]
  }
})

/** Puts a folder + finished run + artifacts into the app's own database. */
const SEED = () =>
  new Promise((resolve, reject) => {
    const open = indexedDB.open('codox')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction(['jobs', 'runs', 'runArtifacts'], 'readwrite')
      tx.objectStore('jobs').put({
        id: 'folder-seed',
        createdAt: Date.now(),
        step: 'export',
        kind: 'folder',
        name: 'Backup smoke folder',
        keepOriginal: true,
      })
      tx.objectStore('runs').put({
        id: 'run-seed',
        jobId: 'folder-seed',
        pdfId: 'pdf-seed',
        fileName: 'smoke.pdf',
        status: 'done',
        step: 'audit',
        pageCount: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      const artifacts = tx.objectStore('runArtifacts')
      artifacts.put({
        id: 'art-rows',
        runId: 'run-seed',
        kind: 'merged-rows',
        json: [
          {
            id: '1',
            group_id: 'g1',
            question: 'Which vessel?',
            options: ['Aorta', 'Vena cava'],
            correct_index: '0',
            needs_review: '',
            image_urls: [],
            topic: '',
            subtopic: '',
            year: '',
          },
        ],
        createdAt: Date.now(),
      })
      artifacts.put({
        id: 'art-crop',
        runId: 'run-seed',
        kind: 'crop',
        path: 'images/asset01.jpg',
        bytes: new Uint8Array([1, 2, 3, 4, 5]),
        createdAt: Date.now(),
      })
      tx.oncomplete = () => {
        db.close()
        resolve(true)
      }
      tx.onerror = () => reject(tx.error)
    }
  })

/** Empties every store the way a browser eviction would. */
const WIPE = () =>
  new Promise((resolve, reject) => {
    const open = indexedDB.open('codox')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const names = ['jobs', 'runs', 'runArtifacts', 'files']
      const tx = db.transaction(names, 'readwrite')
      for (const name of names) tx.objectStore(name).clear()
      tx.oncomplete = () => {
        db.close()
        resolve(true)
      }
      tx.onerror = () => reject(tx.error)
    }
  })

const READ_BACK = () =>
  new Promise((resolve, reject) => {
    const open = indexedDB.open('codox')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction(['jobs', 'runs', 'runArtifacts'], 'readonly')
      const out = {}
      tx.objectStore('jobs').get('folder-seed').onsuccess = (e) => {
        out.folderName = e.target.result?.name ?? null
      }
      tx.objectStore('runs').get('run-seed').onsuccess = (e) => {
        out.runFile = e.target.result?.fileName ?? null
      }
      tx.objectStore('runArtifacts').get('art-rows').onsuccess = (e) => {
        out.question = e.target.result?.json?.[0]?.question ?? null
      }
      tx.objectStore('runArtifacts').get('art-crop').onsuccess = (e) => {
        out.cropBytes = Array.from(e.target.result?.bytes ?? [])
      }
      tx.oncomplete = () => {
        db.close()
        resolve(out)
      }
      tx.onerror = () => reject(tx.error)
    }
  })

const dismissCoachmark = async () => {
  await page
    .getByRole('button', { name: 'Dismiss API key tip' })
    .click({ timeout: 5000 })
    .catch(() => {})
}

try {
  await page.goto(ORIGIN, { waitUntil: 'networkidle' })
  await dismissCoachmark()
  await page.evaluate(SEED)
  await page.reload({ waitUntil: 'networkidle' })
  await dismissCoachmark()

  // The panel lives on History.
  await page.getByRole('button', { name: 'History' }).first().click()
  await page
    .getByRole('heading', { name: 'Backup & restore', level: 2 })
    .waitFor({ timeout: 5000 })

  // Storage protection: the app should have asked for it, and Chromium
  // grants it to a site with no engagement only sometimes — either state is
  // legitimate, but the panel must state one of them plainly.
  const protectionText = await page
    .locator('.backup-panel .ds-inline-note')
    .first()
    .innerText()
  const persisted = await page.evaluate(() => navigator.storage.persisted())
  await page.screenshot({ path: OUT + 'backup-panel.png', fullPage: true })

  // Save a backup through the real save path.
  await page.getByRole('button', { name: 'Save a backup' }).click()
  await page
    .getByText(/Backup saved/)
    .first()
    .waitFor({ timeout: 15000 })
  const saveNote = await page
    .getByText(/Backup saved/)
    .first()
    .innerText()
  const saved = await page.evaluate(() => window.__savedBackup ?? null)
  if (saved === null) throw new Error('the save path wrote no bytes')
  writeFileSync(OUT + 'smoke.codoxbackup', Buffer.from(saved.bytes))
  const fileName = saved.name
  const size = saved.bytes.length
  // Survive the reload below, so the restore reads back the very bytes the
  // save just wrote.
  await context.addInitScript((data) => {
    window.__savedBackup = data
  }, saved)
  await page.screenshot({ path: OUT + 'backup-saved.png', fullPage: true })

  // Now lose everything, exactly as an eviction would.
  await page.evaluate(WIPE)
  await page.reload({ waitUntil: 'networkidle' })
  await dismissCoachmark()
  await page.getByRole('button', { name: 'History' }).first().click()
  const emptyAfterWipe = await page
    .getByRole('heading', { name: 'No runs yet' })
    .isVisible()

  // Restore the file we just saved. The result notice is the panel's last
  // inline note — matching on the word "Restored" alone would also match the
  // panel's own explanatory copy and pass without the restore having run.
  const resultNote = page.locator('.backup-panel .ds-inline-note').last()
  await page.getByRole('button', { name: 'Restore from a backup' }).click()
  await resultNote.filter({ hasText: /^Restored \d+ run/ }).waitFor({ timeout: 15000 })
  const restoreNote = await resultNote.innerText()
  await page.screenshot({ path: OUT + 'backup-restored.png', fullPage: true })

  const back = await page.evaluate(READ_BACK)
  // The seeded run belongs to a folder, and folder runs deliberately live in
  // the Folders tab rather than History — so that is where it must reappear.
  await page.getByRole('button', { name: 'Folders' }).first().click()
  const listed = await page
    .getByRole('heading', { name: 'Backup smoke folder' })
    .first()
    .isVisible()
    .catch(() => false)

  const ok =
    size > 0 &&
    fileName.endsWith('.codoxbackup') &&
    emptyAfterWipe &&
    back.folderName === 'Backup smoke folder' &&
    back.runFile === 'smoke.pdf' &&
    back.question === 'Which vessel?' &&
    JSON.stringify(back.cropBytes) === JSON.stringify([1, 2, 3, 4, 5]) &&
    listed &&
    errors.length === 0

  console.log(
    JSON.stringify(
      {
        protectionText,
        persisted,
        saveNote,
        fileName,
        size,
        emptyAfterWipe,
        restoreNote,
        restored: back,
        listedInFolders: listed,
        errors,
        ok,
      },
      null,
      2,
    ),
  )
  if (!ok) process.exitCode = 1
} catch (e) {
  console.error('FAILED:', e)
  await page.screenshot({ path: OUT + 'backup-failure.png' }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
}
