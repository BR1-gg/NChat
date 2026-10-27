import { cancelJob, clearQueue, queueCounts } from '../queue/runQueue'
import { useRunStore } from '../store/runStore'
import { useUiStore } from '../store/uiStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { workspaceRegistry } from '../store/workspaceRegistry'

export function stopRun(responseId: string): void {
  const cancelled = cancelJob(responseId)
  useRunStore.getState().stop(responseId)
  const store = workspaceRegistry.get(useWorkspaceStore.getState().workspaceId)
  const target = store ?? useWorkspaceStore
  const response = target.getState().nodes.find(
    (node) => node.id === responseId && node.data.kind === 'response',
  )
  if (response?.data.kind === 'response' && response.data.status !== 'done') {
    target.getState().patchResponse(responseId, {
      status: 'aborted',
      error: undefined,
      stats: { ...response.data.stats, finishedAt: Date.now() },
    })
  }
  if (cancelled) {
    useUiStore.getState().addAnnouncement('Queued generation cancelled before it started')
  }
}

/**
 * Stops every active run and empties the queue. A confirmation is required when
 * more than three jobs are still waiting, since they are discarded silently.
 */
export function stopAllRuns(): void {
  const { waiting } = queueCounts()
  const perform = (): void => {
    for (const responseId of Object.keys(useRunStore.getState().runs)) stopRun(responseId)
    useRunStore.getState().stopAll()
    clearQueue()
    useUiStore.getState().addAnnouncement('All generations stopped and the queue cleared')
  }
  if (waiting > 3) {
    useUiStore.getState().requestConfirm({
      title: 'Stop everything?',
      message: `${waiting} queued generations will be discarded.`,
      confirmLabel: 'Stop all',
      destructive: true,
      onConfirm: perform,
    })
    return
  }
  perform()
}
