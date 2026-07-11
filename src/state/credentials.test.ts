import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import {
  getGeminiCredential,
  recordKeyValidation,
  removeGeminiKey,
  saveGeminiKey,
} from './credentials'

beforeEach(async () => {
  await db.credentials.clear()
})

describe('the singleton Gemini credential', () => {
  it('persists a saved key', async () => {
    await saveGeminiKey('first-key')
    const credential = await getGeminiCredential()
    expect(credential?.apiKey).toBe('first-key')
    expect(credential?.id).toBe('gemini')
  })

  it('replacing the key overwrites the previous value and its validation', async () => {
    await saveGeminiKey('first-key')
    await recordKeyValidation('working')
    await saveGeminiKey('second-key')

    const credential = await getGeminiCredential()
    expect(credential?.apiKey).toBe('second-key')
    // A replaced key is unvalidated until checked again.
    expect(credential?.lastValidation).toBeUndefined()
    // Still exactly one record — replacement, never accumulation.
    expect(await db.credentials.count()).toBe(1)
  })

  it('removing the key deletes it', async () => {
    await saveGeminiKey('first-key')
    await removeGeminiKey()
    expect(await getGeminiCredential()).toBeUndefined()
    expect(await db.credentials.count()).toBe(0)
  })

  it('records validation outcomes against the stored key', async () => {
    await saveGeminiKey('first-key')
    await recordKeyValidation('quota-paused')
    const credential = await getGeminiCredential()
    expect(credential?.lastValidation?.status).toBe('quota-paused')
    expect(credential?.lastValidation?.checkedAt).toBeTypeOf('number')
  })

  it('never grows beyond one record no matter how often keys are saved', async () => {
    for (const key of ['a', 'b', 'c', 'd']) {
      await saveGeminiKey(key)
    }
    expect(await db.credentials.count()).toBe(1)
  })
})
