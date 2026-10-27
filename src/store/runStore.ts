import { create } from 'zustand'
import type { NodeId } from '../types/document'

export interface ActiveRun {
  workspaceId: string
  controller: AbortController
  startedAt: number
  lastFlushAt: number
}

interface RunState {
  runs: Record<NodeId, ActiveRun>
  start: (id: NodeId, controller: AbortController, workspaceId?: string) => void
  finish: (id: NodeId) => void
  stop: (id: NodeId) => void
  stopAll: () => void
  controllerFor: (id: NodeId) => AbortController | undefined
}

export const useRunStore = create<RunState>((set, get) => ({
  runs: {},
  start(id, controller, workspaceId = '__default__') {
    get().runs[id]?.controller.abort()
    set({
      runs: {
        ...get().runs,
        [id]: {
          workspaceId,
          controller,
          startedAt: performance.now(),
          lastFlushAt: 0,
        },
      },
    })
  },
  finish(id) {
    const runs = { ...get().runs }
    delete runs[id]
    set({ runs })
  },
  stop(id) {
    get().runs[id]?.controller.abort()
  },
  stopAll() {
    for (const run of Object.values(get().runs)) run.controller.abort()
  },
  controllerFor(id) {
    return get().runs[id]?.controller
  },
}))
