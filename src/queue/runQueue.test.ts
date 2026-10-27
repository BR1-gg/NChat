import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useQueueStore } from './queueStore'
import {
  clearQueue,
  enqueueJob,
  moveJob,
  queueCounts,
  queuePosition,
  queueSnapshot,
  resetQueueForTests,
  resumeQueue,
  pauseQueue,
} from './runQueue'
import { useUiStore } from '../store/uiStore'
import { appError } from '../types/errors'

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** Lets the scheduler's queueMicrotask run. */
const tick = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function enqueue(overrides: Partial<Parameters<typeof enqueueJob>[0]> = {}) {
  const gate = deferred()
  const execute = vi.fn(() => gate.promise)
  const targetNodeId = `t-${overrides.title ?? Math.random().toString(36).slice(2, 8)}`
  const promise = enqueueJob({
    kind: 'prompt',
    workspaceId: 'ws-1',
    targetNodeId,
    sourceNodeId: 'p1',
    title: 'job',
    execute,
    ...overrides,
  })
  promise.catch(() => undefined)
  return { gate, execute, promise, targetNodeId }
}

function jobIdByTitle(title: string): string {
  const id = queueSnapshot().find((job) => job.title === title)?.id
  if (!id) throw new Error(`no job titled ${title}`)
  return id
}

describe('global run queue', () => {
  beforeEach(() => {
    resetQueueForTests()
    useUiStore.setState({ appSettings: { ...useUiStore.getState().appSettings, queueConcurrency: 1 } })
  })

  afterEach(() => {
    resetQueueForTests()
  })

  it('runs waiting jobs one at a time when concurrency is 1', async () => {
    const first = enqueue({ title: 'first' })
    const second = enqueue({ title: 'second' })
    await tick()
    expect(first.execute).toHaveBeenCalledTimes(1)
    expect(second.execute).not.toHaveBeenCalled()
    expect(queueCounts()).toMatchObject({ running: 1, waiting: 1 })

    first.gate.resolve()
    await tick()
    expect(second.execute).toHaveBeenCalledTimes(1)
    second.gate.resolve()
    await tick()
    expect(queueCounts().total).toBe(0)
  })

  it('does not let a blocked job stall the jobs behind it', async () => {
    // The first job waits on a dependency that lives in a registry store we do
    // not create, so it stays blocked and must not hold the queue.
    const blocked = enqueue({ title: 'blocked', dependsOn: ['missing-response'] })
    const free = enqueue({ title: 'free' })
    await tick()
    expect(blocked.execute).not.toHaveBeenCalled()
    expect(free.execute).toHaveBeenCalledTimes(1)
    free.gate.resolve()
    await tick()
  })

  it('reorders waiting jobs and the scheduler honours the new order', async () => {
    const a = enqueue({ title: 'a' })
    const b = enqueue({ title: 'b' })
    const c = enqueue({ title: 'c' })
    await tick()
    // a is running; b and c are waiting. Moving c to the top must run it next.
    expect(moveJob(jobIdByTitle('c'), 'top')).toBe(true)
    a.gate.resolve()
    await tick()
    expect(c.execute).toHaveBeenCalledTimes(1)
    expect(b.execute).not.toHaveBeenCalled()
    c.gate.resolve()
    await tick()
    expect(b.execute).toHaveBeenCalledTimes(1)
    b.gate.resolve()
    await tick()
  })

  it('cancels a waiting job and resolves without executing it', async () => {
    const running = enqueue({ title: 'running' })
    const waiting = enqueue({ title: 'waiting' })
    await tick()
    const jobId = queueSnapshot().find((job) => job.title === 'waiting')?.id
    expect(jobId).toBeDefined()
    const { cancelJob } = await import('./runQueue')
    expect(cancelJob(jobId!)).toBe(true)
    expect(waiting.execute).not.toHaveBeenCalled()
    running.gate.resolve()
    await tick()
  })

  it('pauses automatically on an infrastructure error and keeps waiting jobs', async () => {
    enqueue({
      title: 'offline',
      execute: () => Promise.reject(appError('OFFLINE', 'LM Studio is unreachable.')),
    })
    const later = enqueue({ title: 'later' })
    await tick()
    await tick()
    expect(useQueueStore.getState().paused).toBe(true)
    expect(later.execute).not.toHaveBeenCalled()
    resumeQueue()
    await tick()
    expect(later.execute).toHaveBeenCalledTimes(1)
    later.gate.resolve()
    await tick()
  })

  it('reports a 1-based position among the jobs still to run', async () => {
    const a = enqueue({ title: 'a' })
    const b = enqueue({ title: 'b' })
    const c = enqueue({ title: 'c' })
    await tick()
    const ids = queueSnapshot()
    const idA = ids.find((job) => job.title === 'a')?.id
    const idB = ids.find((job) => job.title === 'b')?.id
    const idC = ids.find((job) => job.title === 'c')?.id
    expect(queuePosition(idA!)).toBe(1)
    expect(queuePosition(idB!)).toBe(2)
    expect(queuePosition(idC!)).toBe(3)
    a.gate.resolve()
    b.gate.resolve()
    c.gate.resolve()
    await tick()
  })

  it('clearQueue leaves running jobs alone', async () => {
    const running = enqueue({ title: 'running' })
    const waiting = enqueue({ title: 'waiting' })
    await tick()
    clearQueue()
    expect(queueSnapshot().some((job) => job.state === 'running')).toBe(true)
    expect(waiting.execute).not.toHaveBeenCalled()
    running.gate.resolve()
    await tick()
  })

  it('pauseQueue stops new dispatches until resumeQueue', async () => {
    pauseQueue('manual')
    const job = enqueue({ title: 'paused' })
    await tick()
    expect(job.execute).not.toHaveBeenCalled()
    resumeQueue()
    await tick()
    expect(job.execute).toHaveBeenCalledTimes(1)
    job.gate.resolve()
    await tick()
  })
})
