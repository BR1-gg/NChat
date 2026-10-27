import { useEffect } from 'react'
import { getRepository } from '../persistence/bootstrap'
import { REPOSITORY_CLIENT_ID } from '../persistence/repository'
import { serializeDocument } from '../persistence/storage'
import { useRunStore } from '../store/runStore'
import { useUiStore } from '../store/uiStore'
import { useWorkspace, useWorkspaceStoreApi, workspaceDocumentFromState } from '../store/workspaceStore'

const SAVE_DEBOUNCE_MS = 500
const timers = new Map<string, number>()

export function useAutosave(): void {
  const dirty = useWorkspace((state) => state.dirty)
  const store = useWorkspaceStoreApi()
  const workspaceId = store.getState().workspaceId

  useEffect(() => {
    if (!dirty) return
    const ui = useUiStore.getState()
    ui.setSaveStatus('saving')
    const previous = timers.get(workspaceId)
    if (previous !== undefined) globalThis.clearTimeout(previous)
    const timer = globalThis.setTimeout(async () => {
      timers.delete(workspaceId)
      const repository = await getRepository()
      const state = store.getState()
      const result = await repository.save(
        workspaceId,
        workspaceDocumentFromState(state),
        state.revision,
      )
      if (result.ok) {
        store.getState().markSaved(result.revision)
        useUiStore.getState().setSaveStatus('saved')
      } else if ('conflict' in result) {
        useUiStore
          .getState()
          .setWorkspaceConflict({ workspaceId, currentRevision: result.currentRevision })
      } else {
        useUiStore.getState().setSaveStatus('error')
        useUiStore.getState().addToast({
          tone: 'error',
          title: result.error.message,
          ...(result.error.hint ? { message: result.error.hint } : {}),
          sticky: true,
        })
      }
    }, SAVE_DEBOUNCE_MS)
    timers.set(workspaceId, timer)
    return () => {
      if (timers.get(workspaceId) === timer) {
        globalThis.clearTimeout(timer)
        timers.delete(workspaceId)
      }
    }
  }, [dirty, store, workspaceId])

  useEffect(() => {
    const flush = (): void => {
      const state = store.getState()
      if (!state.dirty) return
      const repository = getRepository()
      void repository.then((repo) =>
        repo.save(workspaceId, workspaceDocumentFromState(state), state.revision).then((result) => {
          if (result.ok) store.getState().markSaved(result.revision)
        }),
      )
    }
    const onBeforeUnload = (): void => {
      useRunStore.getState().stopAll()
      flush()
    }
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('visibilitychange', onVisibility)
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('nchat') : null
    channel?.addEventListener('message', (event: MessageEvent<{ type?: string; workspaceId?: string; clientId?: string; revision?: number }>) => {
      if (event.data?.type !== 'saved' || event.data.workspaceId !== workspaceId) return
      if (event.data.clientId === REPOSITORY_CLIENT_ID) return
      if (store.getState().dirty) {
        useUiStore
          .getState()
          .setWorkspaceConflict({ workspaceId, currentRevision: event.data.revision ?? 0 })
      }
    })
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('visibilitychange', onVisibility)
      channel?.close()
    }
  }, [store, workspaceId])
}

export function flushWorkspaceNow(workspaceId: string): void {
  const timer = timers.get(workspaceId)
  if (timer !== undefined) {
    globalThis.clearTimeout(timer)
    timers.delete(workspaceId)
  }
}

export async function persistWorkspaceNow(store: ReturnType<typeof useWorkspaceStoreApi>) {
  const state = store.getState()
  if (!state.dirty) return
  const repository = await getRepository()
  const result = await repository.save(
    state.workspaceId,
    serializeDocument(workspaceDocumentFromState(state)),
    state.revision,
  )
  if (result.ok) store.getState().markSaved(result.revision)
}

