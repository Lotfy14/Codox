/**
 * Customize's "Pages per index request" click-through: the new select renders,
 * defaults to 10 (today's engine behaviour, unchanged), commits a lowered
 * value, and that value survives a reload — proving it reached IndexedDB and
 * will reach the next conversion's INDEX windows.
 *
 * Drives the real app at http://localhost:5173 (start `npx vite` first) with
 * playwright-core + installed Edge. No Gemini calls. Screenshots → scripts/out/.
 */
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const BASE = process.env.CODOX_BASE ?? 'http://localhost:5173'
const OUT = new URL('./out/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')

let failures = 0
function check(label, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) failures += 1
}

/** The setting as the app actually stored it — the value a run will read. */
function storedIndexPages(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('codox')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const request = open.result
            .transaction(['meta'], 'readonly')
            .objectStore('meta')
            .get('customizationSettings')
          request.onsuccess = () => {
            const raw = request.result?.value
            resolve(raw === undefined ? null : JSON.parse(raw).indexPagesPerCall)
          }
          request.onerror = () => reject(request.error)
        }
      }),
  )
}

await mkdir(OUT, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage()

try {
  await page.goto(BASE)
  await page
    .getByRole('button', { name: 'Dismiss API key tip' })
    .click({ timeout: 5000 })
    .catch(() => {})

  await page
    .locator('.ds-sidebar')
    .getByRole('button', { name: 'Customize' })
    .click()

  const trigger = page.getByRole('button', { name: /Pages per index request/ })
  await trigger.waitFor()
  check('index select renders on Customize', await trigger.isVisible())
  check(
    'defaults to 10 — engine behaviour unchanged until the tutor lowers it',
    (await trigger.textContent())?.includes('10 pages (default)') === true,
  )
  await page.screenshot({ path: `${OUT}index-pages-default.png`, fullPage: true })

  // Lower it to 3 — ~18 questions per response on this document instead of 57.
  await trigger.click()
  await page.getByRole('option', { name: '3 pages', exact: true }).click()
  check(
    'selecting 3 updates the trigger',
    (await trigger.textContent())?.includes('3 pages') === true,
  )
  check('3 is written to IndexedDB', (await storedIndexPages(page)) === 3)

  await page.reload()
  await page
    .getByRole('button', { name: 'Dismiss API key tip' })
    .click({ timeout: 5000 })
    .catch(() => {})
  await page
    .locator('.ds-sidebar')
    .getByRole('button', { name: 'Customize' })
    .click()
  await trigger.waitFor()
  check(
    'the lowered value survives a reload',
    (await trigger.textContent())?.includes('3 pages') === true &&
      (await storedIndexPages(page)) === 3,
  )
  await page.screenshot({ path: `${OUT}index-pages-lowered.png`, fullPage: true })
} finally {
  await browser.close()
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
