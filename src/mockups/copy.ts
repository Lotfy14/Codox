/**
 * Mockup copy. The canonical, owner-reviewed strings live in
 * src/copy/messages.ts (mirrored from design-system/ERROR_LANGUAGE.md) and
 * are imported here so the mockups cannot drift from them.
 *
 * Everything defined locally below is HISTORICAL multi-provider prototype
 * copy (provider-parameterized messages, failover language). The real app
 * is Gemini-only and must never use it — see the Provider and quota rule
 * in CLAUDE.md.
 */

import {
  exportMessages,
  firstRunMessages,
  historyMessages,
  keyMessages,
  progressMessages,
  reviewMessages,
  uploadMessages,
} from '../copy/messages'

export const keyCopy = {
  emptyKey: keyMessages.emptyKey,
  checking: keyMessages.checking,
  working: keyMessages.working,
  /** Historical: provider-parameterized prototype variant. */
  wrongKey: (provider: string) =>
    `${provider} rejected this key. Check that you copied the whole key, or make a new one on ${provider}'s website.`,
  /** Historical: promises a "next provider", which no longer exists. */
  unreachable: (provider: string) =>
    `Can't reach ${provider} right now. This is not about your key — the service may be down or blocked on this network. During a run, Codox simply tries your next provider.`,
  /** Historical: provider-parameterized prototype variant. */
  quotaPaused: (provider: string) =>
    `This ${provider} key has used up its free daily allowance. Nothing is broken — it rests until ${provider} resets the limit, then works again on its own.`,
  usedFirst: 'Used first',
  /** Historical: failover no longer exists. */
  failoverExplainer:
    'Codox tries your providers in this order. If one is resting or unreachable mid-run, the next takes over — the run keeps going.',
} as const

export const progressCopy = {
  pausedQuota: progressMessages.pausedQuota,
  offline: progressMessages.offline,
  /** Historical: provider switching no longer exists. */
  providerSwitch: (from: string, to: string) =>
    `${from} is unavailable — continuing with ${to}. The run keeps going.`,
  /** Historical: there is only one provider now. */
  allProvidersResting:
    'All your providers are resting until their free quota returns. The run resumes on its own — you can close Codox and come back later.',
  badPage: progressMessages.badPage,
  wrongDeclaration: progressMessages.wrongDeclaration,
  finishedWithFlags: progressMessages.finishedWithFlags,
  finishedClean: progressMessages.finishedClean,
} as const

export const uploadCopy = {
  notPdf: uploadMessages.notPdf,
  encryptedPdf: uploadMessages.encryptedPdf,
  declarationQuestion: uploadMessages.declarationQuestion,
  declarationHelp: uploadMessages.declarationHelp,
  needsKeyFile: uploadMessages.needsKeyFile,
  keepOriginalHelp:
    'Keeps the PDF stored in Codox so this run can be converted again later. Uses more space.',
} as const

export const reviewCopy = reviewMessages

export const exportCopy = exportMessages

export const firstRunCopy = {
  privacyNotice: firstRunMessages.privacyNotice,
  /** Historical: "one free AI key" phrasing predates the Gemini-only rule. */
  welcome:
    'Codox turns exam PDFs into ready-to-import Triviadox question sets. It runs entirely on this device — you bring one free AI key.',
  /** Historical: add-more-providers promise no longer exists. */
  keyStepHelp:
    'One key is enough to start. You can add more providers later in the Keys tab for a bigger daily allowance.',
} as const

export const historyCopy = historyMessages
