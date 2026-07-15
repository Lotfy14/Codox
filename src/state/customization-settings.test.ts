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
      debugConsole: true,
    })
    expect(await getCustomizationSettings()).toEqual({
      yearMode: 'ai',
      topicsMode: 'off',
      debugConsole: true,
    })
  })

  it('falls back per field on unknown values', async () => {
    await db.meta.put({
      key: 'customizationSettings',
      value: JSON.stringify({ yearMode: 'guess', topicsMode: 'off' }),
    })
    expect(await getCustomizationSettings()).toEqual({
      yearMode: DEFAULT_CUSTOMIZATION_SETTINGS.yearMode,
      topicsMode: 'off',
      debugConsole: DEFAULT_CUSTOMIZATION_SETTINGS.debugConsole,
    })
  })

  it('falls back to defaults on a malformed row', async () => {
    await db.meta.put({ key: 'customizationSettings', value: 'not json' })
    expect(await getCustomizationSettings()).toEqual(
      DEFAULT_CUSTOMIZATION_SETTINGS,
    )
  })
})
