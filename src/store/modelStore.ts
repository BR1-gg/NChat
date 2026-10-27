import { create } from 'zustand'
import type { ModelInfo } from '../llm/types'
import type { AppError } from '../types/errors'

export type ModelRuntimeState = 'unloaded' | 'loading' | 'loaded' | 'error'

export interface ModelRuntime {
  state: ModelRuntimeState
  loadStartedAt?: number
  error?: AppError
}

interface ModelStoreState {
  models: ModelInfo[]
  runtimes: Record<string, ModelRuntime>
  setModels: (models: ModelInfo[]) => void
  setRuntime: (id: string, patch: Partial<ModelRuntime>) => void
  runtimeFor: (id: string) => ModelRuntime
}

export const useModelStore = create<ModelStoreState>((set, get) => ({
  models: [],
  runtimes: {},
  setModels(models) {
    set({ models })
  },
  setRuntime(id, patch) {
    set((state) => {
      const previous = state.runtimes[id] ?? { state: 'unloaded' as const }
      return {
        runtimes: {
          ...state.runtimes,
          [id]: { ...previous, ...patch, state: patch.state ?? previous.state },
        },
      }
    })
  },
  runtimeFor(id) {
    return get().runtimes[id] ?? { state: 'unloaded' }
  },
}))
