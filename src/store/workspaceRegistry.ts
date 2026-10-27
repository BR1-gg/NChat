import { createEmptyDocument, type WorkspaceDocument } from '../types/document'
import {
  createWorkspaceStore,
  setActiveWorkspaceStoreGetter,
  type WorkspaceState,
  type WorkspaceStoreApi,
} from './workspaceStore'

// The compatibility store exists before the async database bootstrap finishes.
const bootstrapStore = createWorkspaceStore('__bootstrap__', createEmptyDocument())

const stores = new Map<string, WorkspaceStoreApi>()
let activeWorkspaceId: string | null = null

function fallbackStore(): WorkspaceStoreApi {
  return stores.get(activeWorkspaceId ?? '') ?? bootstrapStore
}

setActiveWorkspaceStoreGetter(fallbackStore)

export const workspaceRegistry = {
  open(id: string, document: WorkspaceDocument, revision = 0): WorkspaceStoreApi {
    const existing = stores.get(id)
    if (existing) {
      existing.getState().replaceDocument(document)
      existing.getState().setRevision(revision)
      existing.getState().markSaved(revision)
      return existing
    }
    const store = createWorkspaceStore(id, document, undefined, revision)
    store.getState().markSaved(revision)
    stores.set(id, store)
    return store
  },

  get(id: string): WorkspaceStoreApi | undefined {
    return stores.get(id)
  },

  activate(id: string | null): void {
    activeWorkspaceId = id
  },

  close(id: string): void {
    stores.delete(id)
    if (activeWorkspaceId === id) activeWorkspaceId = null
  },

  list(): string[] {
    return [...stores.keys()]
  },

  snapshotState(id: string): WorkspaceState | undefined {
    return stores.get(id)?.getState()
  },

  activeId(): string | null {
    return activeWorkspaceId
  },

  resetForTests(): void {
    stores.clear()
    activeWorkspaceId = null
  },
}

export type { WorkspaceState, WorkspaceStoreApi }
