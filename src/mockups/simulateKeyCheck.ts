import type { StatusChipStatus } from '../design/components'
import { keyCopy } from './copy'

export interface KeyCheckResult {
  message: string
  status: Extract<
    StatusChipStatus,
    'quota-paused' | 'unreachable' | 'working' | 'wrong-key'
  >
}

/**
 * Mockup-only stand-in for a live validation call. The pasted text picks the
 * outcome so the owner can see every state and its exact words:
 * contains "bad" → wrong key, "down" → unreachable, "rest" → quota,
 * anything else → key works.
 */
export function simulateKeyCheck(
  key: string,
  providerName: string,
): KeyCheckResult {
  const normalized = key.toLowerCase()

  if (normalized.includes('bad')) {
    return { status: 'wrong-key', message: keyCopy.wrongKey(providerName) }
  }
  if (normalized.includes('down')) {
    return { status: 'unreachable', message: keyCopy.unreachable(providerName) }
  }
  if (normalized.includes('rest')) {
    return {
      status: 'quota-paused',
      message: keyCopy.quotaPaused(providerName),
    }
  }
  return { status: 'working', message: keyCopy.working }
}

export const keyCheckHint =
  'Mockup: paste anything and press Check. Include "bad", "down", or "rest" in the text to preview the wrong-key, unreachable, or quota states.'
