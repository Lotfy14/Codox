/**
 * Workflow-ownership click-through: the Customize tab's workflow picker and
 * its per-step model pickers are now rendered FROM the selected workflow's
 * own definition (`workflows/<Mineral>/workflow.ts`) rather than a list
 * hardcoded in the screen. This drives the real app to prove the panel still
 * renders, still shows Gold's four groups, and still persists a change.
 *
 * Drives http://localhost:5173 (start `npx vite` first) with playwright-core
 * + installed Edge — no real Gemini calls. Screenshots land in scripts/out/.
 */
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const BASE = process.env.CODOX_BASE ?? 'http://localhost:5173'
const OUT = new URL('./out/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')

const checks = []
function check(name, pass, detail = '') {
  checks.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  await mkdir(OUT, { recursive: true })
  const context = await browser.newContext({ viewport: { width: 1200, height: 1000 } })
  const page = await context.newPage()

  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(message.text())
  })

  await page.goto(BASE)
  await page
    .getByRole('button', { name: 'Dismiss API key tip' })
    .click({ timeout: 5000 })
    .catch(() => {})

  await page.locator('.ds-sidebar').getByRole('button', { name: 'Customize' }).click()
  await page.getByRole('heading', { name: 'Customize' }).waitFor()

  // --- The workflow picker is fed by the registry.
  const workflowPanel = page.locator('section[aria-label="Conversion workflow"]')
  const workflowPicker = workflowPanel.getByRole('button').first()
  check(
    'workflow picker shows the registry entry',
    ((await workflowPicker.textContent()) ?? '').includes('Gold 1.0.0'),
    (await workflowPicker.textContent())?.trim(),
  )

  // --- The model pickers come from Gold's own `models.groups`.
  const modelsPanel = page.locator('section[aria-label="Which model does each step"]')
  const labels = await modelsPanel.locator('.ds-select__label').allTextContents()
  check(
    "model pickers match Gold's declared groups",
    JSON.stringify(labels) === JSON.stringify(['Planner', 'Worker', 'Figure', 'Crop']),
    labels.join(', '),
  )

  const pickerFor = (label) =>
    modelsPanel
      .locator('.ds-select')
      .filter({ has: page.locator('.ds-select__label', { hasText: new RegExp(`^${label}$`) }) })
      .getByRole('button')
      .first()

  // --- Gold's declared defaults reach the UI: box/figure on the older model,
  //     the text-reading steps on the newer one.
  const crop = pickerFor('Crop')
  const planner = pickerFor('Planner')
  const cropText = (await crop.textContent()) ?? ''
  const plannerText = (await planner.textContent()) ?? ''
  check(
    'Gold defaults differ per step (Crop older, Planner newer)',
    cropText !== plannerText,
    `Crop=${cropText.trim()} Planner=${plannerText.trim()}`,
  )

  await page.screenshot({ path: `${OUT}workflow-models-panel.png`, fullPage: true })

  // --- Changing a step's model persists through the settings narrowing,
  //     which now resolves steps via the selected workflow.
  await crop.click()
  const options = page.getByRole('option')
  await options.first().waitFor()
  const optionCount = await options.count()
  check('model picker offers exactly the two selectable models', optionCount === 2, `${optionCount} options`)
  await options.nth(0).click()
  const changed = (await crop.textContent()) ?? ''

  await page.reload()
  await page
    .getByRole('button', { name: 'Dismiss API key tip' })
    .click({ timeout: 5000 })
    .catch(() => {})
  await page.locator('.ds-sidebar').getByRole('button', { name: 'Customize' }).click()
  await page.getByRole('heading', { name: 'Customize' }).waitFor()
  const afterReload = (await pickerFor('Crop').textContent()) ?? ''
  check('step model choice survives a reload', afterReload.trim() === changed.trim(), afterReload.trim())

  check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))

  const failed = checks.filter((entry) => !entry.pass)
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`)
  process.exitCode = failed.length === 0 ? 0 : 1
} finally {
  await browser.close()
}
