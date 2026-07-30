import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ensureStoragePersisted,
  readStorageProtection,
  requestStoragePersistedAgain,
  resetStoragePersistForTests,
  subscribeStorageProtection,
} from './persist'

const original = Object.getOwnPropertyDescriptor(navigator, 'storage')

function stubStorage(value: unknown): void {
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value,
  })
}

beforeEach(() => {
  resetStoragePersistForTests()
})

afterEach(() => {
  if (original === undefined) {
    Reflect.deleteProperty(navigator, 'storage')
  } else {
    Object.defineProperty(navigator, 'storage', original)
  }
})

describe('ensureStoragePersisted', () => {
  it('asks the browser once however many times it is called', async () => {
    const persist = vi.fn().mockResolvedValue(true)
    stubStorage({ persist, persisted: vi.fn().mockResolvedValue(false) })

    const results = await Promise.all([
      ensureStoragePersisted(),
      ensureStoragePersisted(),
      ensureStoragePersisted(),
    ])

    expect(results).toEqual(['protected', 'protected', 'protected'])
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('does not ask again when the origin is already protected', async () => {
    const persist = vi.fn()
    stubStorage({ persist, persisted: vi.fn().mockResolvedValue(true) })

    expect(await ensureStoragePersisted()).toBe('protected')
    expect(persist).not.toHaveBeenCalled()
  })

  it('reports best-effort when the browser refuses, and never throws', async () => {
    stubStorage({
      persist: vi.fn().mockResolvedValue(false),
      persisted: vi.fn().mockResolvedValue(false),
    })
    expect(await ensureStoragePersisted()).toBe('best-effort')
  })

  it('treats a rejected request as best-effort, not as a crash', async () => {
    stubStorage({
      persist: vi.fn().mockRejectedValue(new Error('denied')),
      persisted: vi.fn().mockResolvedValue(false),
    })
    expect(await ensureStoragePersisted()).toBe('best-effort')
  })

  it('reports unsupported where the Storage API is absent', async () => {
    stubStorage(undefined)
    expect(await ensureStoragePersisted()).toBe('unsupported')
  })
})

describe('requestStoragePersistedAgain', () => {
  it('re-asks after a refusal — Chrome can grant it later', async () => {
    const persist = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    stubStorage({ persist, persisted: vi.fn().mockResolvedValue(false) })

    expect(await ensureStoragePersisted()).toBe('best-effort')
    expect(await requestStoragePersistedAgain()).toBe('protected')
    expect(persist).toHaveBeenCalledTimes(2)
  })
})

describe('readStorageProtection', () => {
  it('checks without ever asking for permission', async () => {
    const persist = vi.fn()
    stubStorage({ persist, persisted: vi.fn().mockResolvedValue(false) })

    expect(await readStorageProtection()).toBe('best-effort')
    expect(persist).not.toHaveBeenCalled()
  })

  it('publishes each new state to subscribers', async () => {
    const seen: string[] = []
    const unsubscribe = subscribeStorageProtection((state) => seen.push(state))
    stubStorage({
      persist: vi.fn().mockResolvedValue(true),
      persisted: vi.fn().mockResolvedValue(false),
    })

    await readStorageProtection()
    await ensureStoragePersisted()
    unsubscribe()
    await readStorageProtection()

    expect(seen).toEqual(['best-effort', 'protected'])
  })
})
