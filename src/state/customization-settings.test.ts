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
      indexPagesPerCall: 3,
      boxPagesPerCall: 4,
      workerChunkSize: 5,
      matchingMode: 'skip',
      plannerModel: 'gemini-3.1-flash-lite',
      workerModel: 'gemini-3.5-flash-lite',
      auditModel: 'gemini-3.1-flash-lite',
    })
    expect(await getCustomizationSettings()).toEqual({
      yearMode: 'ai',
      topicsMode: 'off',
      exportTarget: 'zip',
      debugConsole: true,
      indexPagesPerCall: 3,
      boxPagesPerCall: 4,
      workerChunkSize: 5,
      matchingMode: 'skip',
      plannerModel: 'gemini-3.1-flash-lite',
      workerModel: 'gemini-3.5-flash-lite',
      auditModel: 'gemini-3.1-flash-lite',
    })
  })

  it('falls back per field on unknown values', async () => {
    await db.meta.put({
      key: 'customizationSettings',
      value: JSON.stringify({
        yearMode: 'guess',
        topicsMode: 'off',
        exportTarget: 'ftp',
        indexPagesPerCall: 0,
        boxPagesPerCall: 99,
        workerChunkSize: 99,
        // An unrecognized model id (a typo, or a model removed from the menu)
        // must never reach the engine — it narrows back to the default.
        plannerModel: 'gemini-9-ultra',
      }),
    })
    expect(await getCustomizationSettings()).toEqual({
      yearMode: DEFAULT_CUSTOMIZATION_SETTINGS.yearMode,
      topicsMode: 'off',
      exportTarget: DEFAULT_CUSTOMIZATION_SETTINGS.exportTarget,
      debugConsole: DEFAULT_CUSTOMIZATION_SETTINGS.debugConsole,
      // Out of range below the floor — a 0-page window would emit no windows
      // at all, so it must never survive narrowing.
      indexPagesPerCall: DEFAULT_CUSTOMIZATION_SETTINGS.indexPagesPerCall,
      boxPagesPerCall: DEFAULT_CUSTOMIZATION_SETTINGS.boxPagesPerCall,
      workerChunkSize: DEFAULT_CUSTOMIZATION_SETTINGS.workerChunkSize,
      // Absent from the stored row entirely — an install that predates the
      // setting migrates to the 'split' default rather than to a mode that
      // would silently drop the tutor's questions.
      matchingMode: DEFAULT_CUSTOMIZATION_SETTINGS.matchingMode,
      // Unknown / absent model ids fall back to the default primary.
      plannerModel: DEFAULT_CUSTOMIZATION_SETTINGS.plannerModel,
      workerModel: DEFAULT_CUSTOMIZATION_SETTINGS.workerModel,
      auditModel: DEFAULT_CUSTOMIZATION_SETTINGS.auditModel,
    })
  })

  it('falls back to defaults on a malformed row', async () => {
    await db.meta.put({ key: 'customizationSettings', value: 'not json' })
    expect(await getCustomizationSettings()).toEqual(
      DEFAULT_CUSTOMIZATION_SETTINGS,
    )
  })
})
