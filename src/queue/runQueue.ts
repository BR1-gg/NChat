import { nanoid } from 'nanoid'
import { providerSpec } from '../logic/providers'
import { appError, isAppError, type AppError } from '../types/errors'
import { useUiStore } from '../store/uiStore'
import { getActiveWorkspaceStore, useWorkspaceStore } from '../store/workspaceStore'
import { workspaceRegistry } from '../store/workspaceRegistry'
import { useQueueStore, type QueueJobKind, type QueueJobView } from './queueStore'

interface JobRecord extends QueueJobView {
  resolve: () => void
  reject: (error: AppError) => void
  execute: () => Promise<void>
  /** Job titles this one is waiting for, resolved for the UI. */
  dependencyLabels: string[]
}

export interface EnqueueOptions {
  kind: QueueJobKind
  workspaceId: string
  targetNodeId: string
  sourceNodeId: string
  title: string
  dependsOn?: string[]
  promptTextSnapshot?: string
  execute: () => Promise<void>
}

const jobs = new Map<string, JobRecord>()
/** Explicit order. The scheduler walks this array, not the Map insertion order. */
let order: string[] = []
const completedDurations: number[] = []
let running = 0
let pumpScheduled = false
let sequence = 0

function notify(): void {
  useQueueStore.getState().setJobs([...order].map((id) => jobs.get(id)).filter(isJob))
}

function isJob(record: JobRecord | undefined): record is JobRecord {
  return record !== undefined
}

function responseReady(workspaceId: string, nodeId: string): 'ready' | 'pending' | 'failed' {
  const store =
    workspaceRegistry.get(workspaceId) ??
    (workspaceId === useWorkspaceStore.getState().workspaceId
      ? getActiveWorkspaceStore()
      : undefined)
  const node = store?.getState().nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return 'pending'
  if (node.data.kind === 'response' || node.data.kind === 'summary') {
    if (node.data.status === 'done' || node.data.status === 'aborted') return 'ready'
    if (node.data.status === 'error' || node.data.status === 'interrupted') return 'failed'
  }
  return 'pending'
}

function schedulePump(): void {
  if (pumpScheduled) return
  pumpScheduled = true
  queueMicrotask(() => {
    pumpScheduled = false
    pump()
  })
}

/**
 * Picks the first job, in display order, whose dependencies are satisfied.
 * A blocked job is skipped instead of stalling the ones behind it.
 */
function pump(): void {
  if (useQueueStore.getState().paused) return
  const concurrency = Math.max(1, useUiStore.getState().appSettings.queueConcurrency)
  while (running < concurrency) {
    let candidate: JobRecord | undefined
    for (const id of order) {
      const job = jobs.get(id)
      if (!job || (job.state !== 'waiting' && job.state !== 'blocked')) continue
      const states = job.dependsOn.map((dep) => responseReady(job.workspaceId, dep))
      if (states.includes('pending')) {
        if (job.state !== 'blocked') update(job.id, { state: 'blocked' })
        continue
      }
      if (states.includes('failed')) {
        update(job.id, {
          state: 'error',
          errorMessage: 'A connected answer failed.',
        })
        const error = appError(
          'CONTEXT_NOT_READY',
          'A connected answer failed.',
          { hint: 'Retry the failed answer, then run this prompt again.' },
        )
        useUiStore.getState().addToast({ tone: 'error', title: error.message, message: error.hint })
        job.reject(error)
        jobs.delete(job.id)
        order = order.filter((entry) => entry !== job.id)
        notify()
        continue
      }
      candidate = job
      break
    }
    if (!candidate) break

    running += 1
    const startedAt = Date.now()
    sequence += 1
    const position = sequence
    update(candidate.id, { state: 'running' })
    useUiStore.getState().addAnnouncement(
      `Generation ${position} of ${order.length + completedDurations.length} started`,
    )
    void candidate
      .execute()
      .then(() => {
        completedDurations.push(Date.now() - startedAt)
        if (completedDurations.length > 20) completedDurations.shift()
        update(candidate!.id, { state: 'done' })
        candidate!.resolve()
        jobs.delete(candidate!.id)
        order = order.filter((entry) => entry !== candidate!.id)
        notify()
      })
      .catch((error: unknown) => {
        const mapped = isAppError(error) ? error : appError('INTERNAL', 'The queued job failed.')
        update(candidate!.id, { state: 'error', errorMessage: mapped.message })
        if (
          mapped.kind === 'OFFLINE' ||
          mapped.kind === 'CORS_BLOCKED' ||
          mapped.kind === 'MODEL_NOT_LOADED'
        ) {
          /*
           * Il motivo della pausa nomina il provider scelto, non LM Studio.
           *
           * La coda si mette in pausa quando non riesce a parlare con il backend, e
           * il messaggio finiva sulla barra con la parola "LM Studio" anche con
           * Google o NVIDIA selezionati: l'utente andava a cercare un programma che
           * non c'entra, mentre il vero motivo — rete, chiave, servizio locale — era
           * gia scritto una riga sotto, nel toast.
           */
          const providerLabel = providerSpec(useUiStore.getState().appSettings.provider).label
          useQueueStore
            .getState()
            .setPaused(
              true,
              mapped.kind === 'MODEL_NOT_LOADED' ? mapped.message : `${providerLabel} is unreachable.`,
            )
          useUiStore.getState().addToast({
            tone: 'warning',
            title: 'Queue paused',
            message: mapped.hint ?? mapped.message,
            actionLabel: 'Resume',
            onAction: () => resumeQueue(),
            sticky: true,
          })
        }
        candidate!.reject(mapped)
        jobs.delete(candidate!.id)
        order = order.filter((entry) => entry !== candidate!.id)
        notify()
      })
      .finally(() => {
        running -= 1
        schedulePump()
      })
  }
  notify()
}

function update(id: string, patch: Partial<QueueJobView>): void {
  const job = jobs.get(id)
  if (!job) return
  jobs.set(id, { ...job, ...patch })
  notify()
}

export function enqueueJob(options: EnqueueOptions): Promise<void> {
  const id = nanoid(12)
  const record: JobRecord = {
    id,
    kind: options.kind,
    workspaceId: options.workspaceId,
    targetNodeId: options.targetNodeId,
    sourceNodeId: options.sourceNodeId,
    title: options.title,
    dependsOn: options.dependsOn ?? [],
    dependencyLabels: [],
    ...(options.promptTextSnapshot !== undefined
      ? { promptTextSnapshot: options.promptTextSnapshot }
      : {}),
    enqueuedAt: Date.now(),
    state: 'waiting',
    resolve: () => undefined,
    reject: () => undefined,
    execute: options.execute,
  }
  const promise = new Promise<void>((resolve, reject) => {
    record.resolve = resolve
    record.reject = reject
  })
  jobs.set(id, record)
  order.push(id)
  notify()
  schedulePump()
  return promise
}

export function cancelJob(id: string): boolean {
  const job = jobs.get(id)
  if (!job || job.state === 'running') return false
  update(id, { state: 'cancelled' })
  job.resolve()
  jobs.delete(id)
  order = order.filter((entry) => entry !== id)
  notify()
  schedulePump()
  return true
}

/** Moves a waiting job. Returns false when the move is not applicable. */
export function moveJob(id: string, to: 'top' | 'up' | 'down'): boolean {
  const index = order.indexOf(id)
  if (index < 0) return false
  const job = jobs.get(id)
  if (!job || job.state !== 'waiting') return false
  let target = index
  if (to === 'top') target = 0
  if (to === 'up') target = Math.max(0, index - 1)
  if (to === 'down') target = Math.min(order.length - 1, index + 1)
  if (target === index) return false
  order.splice(index, 1)
  order.splice(target, 0, id)
  notify()
  schedulePump()
  return true
}

export function clearQueue(): void {
  for (const job of [...jobs.values()]) {
    if (job.state === 'running') continue
    job.resolve()
    jobs.delete(job.id)
  }
  order = order.filter((id) => jobs.has(id))
  notify()
  schedulePump()
}

export function resumeQueue(): void {
  useQueueStore.getState().setPaused(false)
  schedulePump()
}

export function pauseQueue(reason: string): void {
  useQueueStore.getState().setPaused(true, reason)
}

export function queueSnapshot(): QueueJobView[] {
  return useQueueStore.getState().jobs
}

/** 1-based position of a job among the ones still to run, or 0 if not queued. */
export function queuePosition(id: string): number {
  const pending = queueSnapshot().filter(
    (job) => job.state === 'waiting' || job.state === 'blocked' || job.state === 'running',
  )
  const index = pending.findIndex((job) => job.id === id)
  return index < 0 ? 0 : index + 1
}

export function queueCounts(): { running: number; waiting: number; total: number } {
  const list = queueSnapshot().filter((job) => job.state !== 'done' && job.state !== 'cancelled')
  return {
    running: list.filter((job) => job.state === 'running').length,
    waiting: list.filter((job) => job.state === 'waiting' || job.state === 'blocked').length,
    total: list.length,
  }
}

/** Average duration of recent jobs and a coarse estimate of the remaining time. */
export function queueEtaMs(): number | null {
  const counts = queueCounts()
  if (counts.waiting === 0 || completedDurations.length === 0) return null
  const average = completedDurations.reduce((sum, value) => sum + value, 0) / completedDurations.length
  const slots = Math.max(1, useUiStore.getState().appSettings.queueConcurrency)
  return Math.round((average * counts.waiting) / slots)
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  return `${Math.round(ms / 60_000)} min`
}

/** Test seam: drops all scheduler state. */
export function resetQueueForTests(): void {
  jobs.clear()
  order = []
  completedDurations.length = 0
  running = 0
  sequence = 0
  useQueueStore.getState().setJobs([])
  useQueueStore.getState().setPaused(false)
}
