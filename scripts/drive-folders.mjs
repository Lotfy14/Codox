// Smoke test for the Folders tab. Launches Edge headless against the running
// dev server (port 5173), creates a folder, opens it, and checks the detail
// screen renders its drop zone + shared-topics panel. Screenshots to
// scripts/out/. Run: node scripts/drive-folders.mjs
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const OUT = fileURLToPath(new URL('./out/', import.meta.url))
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

try {
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await page
    .getByRole('button', { name: 'Dismiss API key tip' })
    .click({ timeout: 5000 })
    .catch(() => {})

  // Into the Folders tab.
  await page.getByRole('button', { name: 'Folders' }).first().click()
  await page.getByRole('heading', { name: 'Folders', level: 1 }).waitFor({ timeout: 5000 })
  await page.screenshot({ path: OUT + 'folders-list-empty.png' })

  // Create a folder.
  await page.getByRole('button', { name: 'New folder' }).click()
  await page.getByLabel('Folder name').fill('Cardiology block')
  await page.getByRole('button', { name: 'Create folder' }).click()

  // Detail screen should show the folder name + drop zone + shared topics.
  await page.getByRole('heading', { name: 'Cardiology block', level: 1 }).waitFor({ timeout: 5000 })
  const hasDrop = await page.getByText('Add exam PDFs').first().isVisible()
  const hasTopics = await page.getByText('Shared topics').first().isVisible()
  const hasMatch = await page
    .getByRole('button', { name: 'Match topics across all PDFs' })
    .isVisible()
  await page.screenshot({ path: OUT + 'folder-detail.png' })

  // Back to list — the folder should now be listed.
  await page.getByRole('button', { name: 'Back to folders' }).click()
  const listed = await page.getByRole('heading', { name: 'Cardiology block' }).isVisible()

  console.log(JSON.stringify({ hasDrop, hasTopics, hasMatch, listed, errors }, null, 2))
  if (!hasDrop || !hasTopics || !hasMatch || !listed || errors.length > 0) {
    process.exitCode = 1
  }
} catch (e) {
  console.error('FAILED:', e)
  await page.screenshot({ path: OUT + 'folder-failure.png' }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
}
