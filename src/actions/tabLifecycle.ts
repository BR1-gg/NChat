import { getRepository } from '../persistence/bootstrap'
import { navigate } from '../router'
import { useQueueStore } from '../queue/queueStore'
import { useRunStore } from '../store/runStore'
import { useTabsStore } from '../store/tabsStore'
import { useUiStore } from '../store/uiStore'
import { workspaceRegistry } from '../store/workspaceRegistry'
import { cancelJob, clearQueue } from '../queue/runQueue'
import { persistWorkspaceNow } from '../hooks/useAutosave'

function pendingFor(workspaceId: string): number {
  const runs = Object.entries(useRunStore.getState().runs).filter(
    ([, run]) => run.workspaceId === workspaceId && !run.controller.signal.aborted,
  ).length
  const queued = useQueueStore
    .getState()
    .jobs.filter(
      (job) =>
        job.workspaceId === workspaceId &&
        (job.state === 'waiting' || job.state === 'blocked' || job.state === 'running'),
    ).length
  return runs + queued
}

function closeNow(workspaceId: string): void {
  void persistWorkspaceNow(workspaceRegistry.get(workspaceId) ?? workspaceRegistry.get(workspaceId)!)
    .catch(() => undefined)
    .finally(() => {
      workspaceRegistry.close(workspaceId)
      const next = useTabsStore.getState().closeTab(workspaceId)
      navigate(next === 'home' ? { name: 'home' } : { name: 'workspace', workspaceId: next })
    })
}

/**
 * Closing a tab whose jobs are still pending is a decision, not a silent
 * unload: the user either keeps the generation running in the background or
 * stops it. A tab without pending work closes immediately.
 */
export function requestCloseTab(workspaceId: string): void {
  const pending = pendingFor(workspaceId)
  if (pending === 0) {
    closeNow(workspaceId)
    return
  }
  const label = `${pending} generation${pending === 1 ? ' is' : 's are'} still running in this workspace`
  useUiStore.getState().requestConfirm({
    title: 'Close this tab?',
    message: `${label}. You can keep it running in the background: the workspace stays open and saves when the queue is empty.`,
    confirmLabel: 'Keep running in background',
    cancelLabel: 'Stop and close',
    destructive: false,
    onConfirm: () => {
      // The store stays in the registry, so the job keeps writing to it.
      const next = useTabsStore.getState().closeTab(workspaceId)
      navigate(next === 'home' ? { name: 'home' } : { name: 'workspace', workspaceId: next })
      useUiStore
        .getState()
        .addToast({
          tone: 'info',
          title: 'Running in the background',
          message: `${pending} generation${pending === 1 ? '' : 's'} will finish and be saved.`,
          actionLabel: 'Show',
          onAction: () => {
            useTabsStore.getState().openTab(workspaceId)
            navigate({ name: 'workspace', workspaceId })
          },
        })
    },
    onCancel: () => {
      for (const job of useQueueStore.getState().jobs) {
        if (job.workspaceId === workspaceId) cancelJob(job.id)
      }
      clearQueue()
      const next = useTabsStore.getState().closeTab(workspaceId)
      navigate(next === 'home' ? { name: 'home' } : { name: 'workspace', workspaceId: next })
    },
  })
}

/**
 * A workspace deleted in another browser window leaves a dangling tab. This
 * detects it and offers to restore the latest snapshot.
 */
export async function checkForDeletedWorkspace(workspaceId: string): Promise<boolean> {
  const repository = await getRepository()
  const meta = (await repository.listMeta()).some((entry) => entry.id === workspaceId)
  if (meta) return false
  const snapshots = await repository.listSnapshots(workspaceId)
  const latest = snapshots[0]
  useUiStore.getState().addToast({
    tone: 'warning',
    title: 'This workspace was deleted in another window',
    message: latest ? 'A snapshot is available.' : undefined,
    sticky: true,
    ...(latest
      ? {
          actionLabel: 'Restore',
          onAction: () => {
            void repository.restoreSnapshot(latest.id).then((restored) => {
              if (!restored) return
              useTabsStore.getState().openTab(workspaceId)
              navigate({ name: 'workspace', workspaceId })
              window.dispatchEvent(new CustomEvent('nchat:workspaces-changed'))
            })
          },
        }
      : {}),
  })
  const next = useTabsStore.getState().closeTab(workspaceId)
  if (next !== workspaceId) {
    navigate(next === 'home' ? { name: 'home' } : { name: 'workspace', workspaceId: next })
  }
  return true
}
