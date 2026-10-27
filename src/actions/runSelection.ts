import { runPrompt } from './runPrompt'
import { getActiveWorkspaceStore, workspaceDocumentFromState, type WorkspaceStoreApi } from '../store/workspaceStore'
import type { NodeId, WorkspaceDocument } from '../types/document'

/**
 * Orders prompts so a prompt always runs after the responses it depends on.
 * Pure: returns the same ids reordered, which is what the queue needs to keep
 * a multi-selection run in topological order.
 */
export function topologicalOrder(
  document: WorkspaceDocument,
  promptIds: NodeId[],
): NodeId[] {
  const wanted = new Set(
    promptIds.filter((id) => document.nodes.find((node) => node.id === id)?.data.kind === 'prompt'),
  )
  const visited = new Set<NodeId>()
  const ordered: NodeId[] = []

  const visit = (id: NodeId, trail: Set<NodeId>): void => {
    if (visited.has(id) || !wanted.has(id)) return
    if (trail.has(id)) return // a cycle is impossible here: cycles are rejected on connect
    const nextTrail = new Set(trail)
    nextTrail.add(id)
    for (const dependency of contextResponseParents(document, id)) {
      visit(dependency, nextTrail)
    }
    visited.add(id)
    ordered.push(id)
  }

  for (const id of promptIds) visit(id, new Set())
  return ordered
}

/** Parent prompt ids of every response feeding this prompt, directly or not. */
function contextResponseParents(document: WorkspaceDocument, promptId: NodeId): NodeId[] {
  const found = new Set<NodeId>()
  const seenPrompts = new Set<NodeId>([promptId])
  const queue: NodeId[] = [promptId]
  while (queue.length > 0) {
    const current = queue.pop()
    if (!current) continue
    for (const edge of document.edges) {
      if (edge.kind !== 'context' || edge.target !== current) continue
      const source = document.nodes.find((node) => node.id === edge.source)
      if (!source) continue
      if (source.data.kind === 'response') {
        const parent = source.data.parentPromptId
        if (parent && !found.has(parent)) {
          found.add(parent)
          if (!seenPrompts.has(parent)) {
            seenPrompts.add(parent)
            queue.push(parent)
          }
        }
      } else if (source.data.kind === 'set') {
        for (const memberId of source.data.memberIds) queue.push(memberId)
      } else if (source.data.kind === 'output' && source.data.sourceNodeIds) {
        for (const memberId of source.data.sourceNodeIds) queue.push(memberId)
      }
    }
  }
  return [...found]
}

/** Enqueues a multi-selection of prompts in topological order. */
export async function runSelectionTopologically(
  promptIds: NodeId[],
  store: WorkspaceStoreApi = getActiveWorkspaceStore(),
): Promise<number> {
  const document = workspaceDocumentFromState(store.getState())
  const prompts = promptIds.filter(
    (id) => document.nodes.find((node) => node.id === id)?.data.kind === 'prompt',
  )
  const ordered = topologicalOrder(document, prompts)
  for (const id of ordered) void runPrompt(id, store)
  return ordered.length
}
