import { create } from 'zustand'

export type QueueJobState = 'waiting' | 'blocked' | 'running' | 'done' | 'error' | 'cancelled'
export type QueueJobKind = 'prompt' | 'retry' | 'summary' | 'set-synthesis'

export interface QueueJobView {
  id: string
  kind: QueueJobKind
  workspaceId: string
  targetNodeId: string
  sourceNodeId: string
  enqueuedAt: number
  state: QueueJobState
  dependsOn: string[]
  /** Prompt text captured at click time, so I-4 holds for queued runs. */
  promptTextSnapshot?: string
  title: string
  errorMessage?: string
}

interface QueueState {
  jobs: QueueJobView[]
  paused: boolean
  pauseReason: string | null
  setJobs: (jobs: QueueJobView[]) => void
  upsert: (job: QueueJobView) => void
  remove: (id: string) => void
  setPaused: (paused: boolean, reason?: string | null) => void
  clearFinished: () => void
}

export const useQueueStore = create<QueueState>((set) => ({
  jobs: [],
  paused: false,
  pauseReason: null,
  setJobs(jobs) {
    set({ jobs })
  },
  upsert(job) {
    set((state) => {
      const index = state.jobs.findIndex((item) => item.id === job.id)
      const jobs = [...state.jobs]
      if (index < 0) jobs.push(job)
      else jobs[index] = job
      return { jobs }
    })
  },
  remove(id) {
    set((state) => ({ jobs: state.jobs.filter((job) => job.id !== id) }))
  },
  setPaused(paused, reason = null) {
    set({ paused, pauseReason: paused ? reason : null })
  },
  clearFinished() {
    set((state) => ({ jobs: state.jobs.filter((job) => job.state === 'waiting' || job.state === 'blocked' || job.state === 'running') }))
  },
}))
