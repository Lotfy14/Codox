import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import {
  DEFAULT_CUSTOMIZATION_SETTINGS,
  getCustomizationSettings,
  saveCustomizationSettings,
} from './customization-settings'

beforeEach(async () => {
  await db.meta.clear()
})

describe('customization settings', () => {
  it('returns defaults when nothing is saved', async () => {
    expect(await getCustomizationSettings()).toEqual(
      DEFAULT_CUSTOMIZATION_SETTINGS,
    )
  })

  it('round-trips a saved value', async () => {
    await saveCustomizationSettings({
      yearMode: 'ai',
      topicsMode: 'off',
      exportTarget: 'zip',
      debugConsole: true,
      boxPagesPerCall: 4,
      workerChunkSize: 5,
      matchingMode: 'skip',
    })
    expect(await getCustomizationSettings()).toEqual({
      yearMode: 'ai',
      topicsMode: 'off',
      exportTarget: 'zip',
      debugConsole: true,
      boxPagesPerCall: 4,
      workerChunkSize: 5,
      matchingMode: 'skip',
    })
  })

  it('falls back per field on unknown values', async () => {
    await db.meta.put({
      key: 'customizationSettings',
      value: JSON.stringify({
        yearMode: 'guess',
        topicsMode: 'off',
        exportTarget: 'ftp',
        boxPagesPerCall: 99,
        workerChunkSize: 99,
      }),
    })
    expect(await getCustomizationSettings()).toEqual({
      yearMode: DEFAULT_CUSTOMIZATION_SETTINGS.yearMode,
      topicsMode: 'off',
      exportTarget: DEFAULT_CUSTOMIZATION_SETTINGS.exportTarget,
      debugConsole: DEFAULT_CUSTOMIZATION_SETTINGS.debugConsole,
      boxPagesPerCall: DEFAULT_CUSTOMIZATION_SETTINGS.boxPagesPerCall,
      workerChunkSize: DEFAULT_CUSTOMIZATION_SETTINGS.workerChunkSize,
      // Absent from the stored row entirely — an install that predates the
      // setting migrates to the 'split' default rather than to a mode that
      // would silently drop the tutor's questions.
      matchingMode: DEFAULT_CUSTOMIZATION_SETTINGS.matchingMode,
    })
  })

  it('falls back to defaults on a malformed row', async () => {
    await db.meta.put({ key: 'customizationSettings', value: 'not json' })
    expect(await getCustomizationSettings()).toEqual(
      DEFAULT_CUSTOMIZATION_SETTINGS,
    )
  })
})
