/**
 * The Key facts area: key facts and flashcards for questions that already live
 * on Triviadox (owner design, 2026-11-17).
 *
 * Connect to Triviadox opens the site's /codox/connect page in the browser;
 * the manager picks subtopics there and presses Send to Codox, and this screen
 * (polling with the job's secret) receives the job. Start generates with the
 * chosen mode's models; Export to Triviadox re-checks the page and sends.
 * Everything a run produces is saved on the device as it goes (kfJobs), so a
 * pause on quota or a closed app loses nothing.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, GlassPanel, ProgressBar } from '../design/components'
import { keyFactsMessages as m } from '../copy/messages'
import { geminiController, type ControllerStatus } from '../providers/controller'
import { useGeminiCredential } from '../state/credentials'
import { db } from '../state/db'
import {
  createPairing, openConnectPage, TriviadoxError, waitForJob, type JobKind,
} from '../triviadox/jobs'
import type { KeyFactMode } from '../keyfacts/models'
import { setKeyFactMode, useKeyFactMode } from '../keyfacts/mode'
import { exportJob, pendingFacts, pendingQuestions, RunStop, runJob } from '../keyfacts/runner'
import { deleteKfJob, newKfJob, saveKfJob, useLatestKfJob, type KfJob } from '../keyfacts/state'

function useControllerStatus(): ControllerStatus {
  const [status, setStatus] = useState<ControllerStatus>(geminiController.getStatus())
  useEffect(() => geminiController.subscribe(() => setStatus(geminiController.getStatus())), [])
  return status
}

function JobPanel({ kind, mode, onMode, onRequestApiKey }: {
  kind: JobKind
  mode: KeyFactMode
  onMode: (m: KeyFactMode) => void
  onRequestApiKey: () => void
}) {
  const job = useLatestKfJob(kind)
  const credential = useGeminiCredential()
  const controllerStatus = useControllerStatus()
  const [busy, setBusy] = useState<'run' | 'export' | null>(null)
  const [live, setLive] = useState<KfJob | null>(null)
  const abort = useRef<AbortController | null>(null)
  const copy = kind === 'facts' ? m.facts : m.cards
  const shown = live ?? job ?? null

  // Keep polling while a Connect is waiting (also after the app was reopened).
  useEffect(() => {
    if (!job || job.status !== 'waiting') return
    const ctrl = new AbortController()
    waitForJob(job.pairing, ctrl.signal)
      .then(async (payload) => {
        await saveKfJob({ ...job, payload, status: 'ready' })
      })
      .catch(async (e) => {
        if (ctrl.signal.aborted) return
        await saveKfJob({ ...job, status: 'ready', error: e instanceof Error ? e.message : String(e) })
      })
    return () => ctrl.abort()
  }, [job?.id, job?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => abort.current?.abort(), [])

  const connect = async () => {
    if (!credential) { onRequestApiKey(); return }
    const pairing = createPairing(kind)
    await saveKfJob(newKfJob(pairing, mode))
    await openConnectPage(pairing)
  }

  const run = async (forceMode?: KeyFactMode) => {
    if (!job) return
    abort.current?.abort()
    const ctrl = new AbortController()
    abort.current = ctrl
    setBusy('run')
    const fresh = (await db.kfJobs.get(job.id)) ?? job
    if (forceMode) fresh.mode = forceMode
    else fresh.mode = mode
    try {
      await runJob(fresh, { signal: ctrl.signal, onUpdate: setLive })
    } catch (e) {
      if (!(e instanceof RunStop)) console.error('[codox] key facts run', e)
    } finally {
      setBusy(null)
      setLive(null)
    }
  }

  const continueInNormal = () => {
    abort.current?.abort()
    onMode('normal')
    void run('normal')
  }

  const doExport = async () => {
    if (!job) return
    const ctrl = new AbortController()
    abort.current = ctrl
    setBusy('export')
    try {
      await exportJob((await db.kfJobs.get(job.id)) ?? job, { signal: ctrl.signal, onUpdate: setLive })
    } catch (e) {
      if (!(e instanceof RunStop) && !(e instanceof TriviadoxError)) console.error('[codox] key facts export', e)
    } finally {
      setBusy(null)
      setLive(null)
    }
  }

  const stop = () => abort.current?.abort()

  const total = useMemo(() => {
    if (!shown?.payload) return 0
    const scopeAll = shown.payload.job.scope === 'all'
    return kind === 'facts'
      ? shown.payload.questions.filter((q) => scopeAll || q.keyFactId === null).length
      : shown.payload.facts.filter((f) => scopeAll || !f.hasCard || f.cardStale).length
  }, [shown?.payload, kind])
  const remaining = shown?.payload ? (kind === 'facts' ? pendingQuestions(shown).length : pendingFacts(shown).length) : 0
  const expired = !!shown?.payload && new Date(shown.payload.job.expiresAt).getTime() < Date.now() && shown.status !== 'sent'
  const pausedForQuota = busy === 'run' && controllerStatus.kind === 'paused' && controllerStatus.reason === 'quota'

  const connectButton = (
    <Button onPress={() => void connect()} variant="primary">{m.connect}</Button>
  )

  return (
    <GlassPanel as="section" aria-labelledby={`kf-${kind}-title`} padding="compact">
      <div className="ds-stack">
        <div className="ds-kf-head">
          <h2 className="ds-kf-title" id={`kf-${kind}-title`}>{kind === 'facts' ? m.factsTitle : m.cardsTitle}</h2>
          {shown?.payload?.page ? <Badge tone="neutral">{m.received(shown.payload.page.label)}</Badge> : null}
        </div>

        {!shown || shown.status === 'sent' || expired ? (
          <>
            <p className="ds-muted">{kind === 'facts' ? m.factsHint : m.cardsHint}</p>
            {shown?.status === 'sent' && shown.result ? (
              <p className="ds-kf-ok" role="status">
                <strong>{m.sent}.</strong>{' '}
                {kind === 'facts'
                  ? m.sentFacts(shown.result.created, shown.result.linked_new + shown.result.linked_existing, shown.result.linked_existing)
                  : m.sentCards(shown.result.cards, shown.result.cards_skipped, shown.result.thin ?? 0)}
              </p>
            ) : null}
            {expired ? <p className="ds-kf-warn">{m.expired}</p> : null}
            {credential ? connectButton : <><p className="ds-muted">{m.needKey}</p><Button onPress={onRequestApiKey} variant="secondary">API key</Button></>}
          </>
        ) : shown.status === 'waiting' ? (
          <>
            <p role="status">{m.waiting}</p>
            <p className="ds-muted">{m.waitingHelp}</p>
            <div className="ds-kf-actions">
              <Button onPress={() => void openConnectPage(shown.pairing)} variant="secondary">{m.reopen}</Button>
              <Button onPress={() => void deleteKfJob(shown.id)} variant="quiet">{m.cancel}</Button>
            </div>
          </>
        ) : !shown.payload ? (
          <>
            {shown.error ? <p className="ds-kf-warn" role="alert">{shown.error}</p> : null}
            <div className="ds-kf-actions">
              {connectButton}
              <Button onPress={() => void deleteKfJob(shown.id)} variant="quiet">{m.discard}</Button>
            </div>
          </>
        ) : (
          <>
            <p>{copy.todo(total, shown.payload.subtopics.length)}</p>
            {total === 0 ? <p className="ds-muted">{m.nothingToDo}</p> : (
              <ProgressBar label={copy.progress} max={total} showFraction value={total - remaining} />
            )}
            {kind === 'facts'
              ? <p className="ds-muted">{m.facts.summary(shown.newFacts.length, shown.links.length)}{shown.skipped.length ? ` · ${m.skipped(shown.skipped.length)}` : ''}</p>
              : <p className="ds-muted">{m.cards.summary(shown.cards.length)}{shown.skipped.length ? ` · ${m.skipped(shown.skipped.length)}` : ''}</p>}
            {pausedForQuota ? (
              <div className="ds-kf-warn" role="status">
                <p>{m.paused}</p>
                {mode === 'pro' ? <Button onPress={continueInNormal} variant="secondary">{m.continueNormal}</Button> : null}
              </div>
            ) : null}
            {shown.error ? <p className="ds-kf-warn" role="alert">{shown.error}</p> : null}

            <div className="ds-kf-actions">
              {busy === 'run' ? (
                <Button onPress={stop} variant="secondary">{m.stop}</Button>
              ) : remaining > 0 ? (
                <Button isDisabled={busy !== null} onPress={() => void run()} variant="primary">
                  {shown.requests > 0 ? m.continue : m.start}
                </Button>
              ) : null}
              {remaining === 0 || shown.status === 'done' ? (
                <Button isDisabled={busy !== null && busy !== 'export'} isLoading={busy === 'export'} loadingLabel={m.exporting} onPress={() => void doExport()} variant={remaining === 0 ? 'primary' : 'secondary'}>
                  {m.export}
                </Button>
              ) : null}
              {busy === null ? <Button onPress={() => void deleteKfJob(shown.id)} variant="quiet">{m.discard}</Button> : null}
            </div>

            {(kind === 'facts' ? shown.newFacts.length : shown.cards.length) > 0 ? (
              <details className="ds-kf-list">
                <summary>{copy.listTitle} ({kind === 'facts' ? shown.newFacts.length : shown.cards.length})</summary>
                <ol>
                  {kind === 'facts'
                    ? shown.newFacts.map((f) => <li key={f.tmp}>{f.text}</li>)
                    : shown.cards.map((c) => (
                      <li key={c.factId}>
                        <strong>{c.front}</strong> → {c.back}{c.extra ? <span className="ds-muted"> ({c.extra})</span> : null}
                      </li>
                    ))}
                </ol>
              </details>
            ) : null}
            {shown.skipped.length > 0 ? (
              <details className="ds-kf-list">
                <summary>{m.skippedTitle} ({shown.skipped.length})</summary>
                <ul>{shown.skipped.map((s) => <li key={s.id}>{s.reason}</li>)}</ul>
              </details>
            ) : null}
          </>
        )}
      </div>
    </GlassPanel>
  )
}

export function KeyFacts({ onRequestApiKey }: { onRequestApiKey: () => void }) {
  // Normal / Pro is switched in the top bar (App.tsx, KeyFactsQuotaStrip).
  const mode = useKeyFactMode()
  return (
    <section aria-labelledby="keyfacts-heading" className="ds-convert">
      <header className="ds-work__head">
        <h1 id="keyfacts-heading">{m.title}</h1>
      </header>
      <div className="ds-stack">
        <p className="ds-muted">{m.subtitle}</p>
        <div className="ds-kf-grid">
          <JobPanel kind="facts" mode={mode} onMode={setKeyFactMode} onRequestApiKey={onRequestApiKey} />
          <JobPanel kind="cards" mode={mode} onMode={setKeyFactMode} onRequestApiKey={onRequestApiKey} />
        </div>
      </div>
    </section>
  )
}
