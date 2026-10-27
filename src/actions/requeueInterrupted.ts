import { retryResponse } from './runPrompt'
import { getActiveWorkspaceStore, workspaceDocumentFromState } from '../store/workspaceStore'
import { useUiStore } from '../store/uiStore'
import type { WorkspaceStoreApi } from '../store/workspaceStore'

/**
 * Reloading or closing the page turns queued/streaming nodes into
 * `interrupted`. This puts them back in the queue as retries, in document
 * order, so a long session can be resumed without rebuilding the graph.
 */
export async function requeueInterrupted(
  store: WorkspaceStoreApi = getActiveWorkspaceStore(),
): Promise<number> {
  const document = workspaceDocumentFromState(store.getState())
  const targets = document.nodes.filter(
    (node) => node.data.kind === 'response' && node.data.status === 'interrupted',
  )
  if (targets.length === 0) {
    useUiStore.getState().addToast({ tone: 'info', title: 'Nothing to re-queue.' })
    return 0
  }
  for (const node of targets) {
    store.getState().patchResponse(node.id, { status: 'queued' })
    void retryResponse(node.id, store)
  }
  useUiStore
    .getState()
    .addAnnouncement(`Re-queued ${targets.length} interrupted generations`)
  return targets.length
}
