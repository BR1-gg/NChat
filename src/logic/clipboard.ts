import { nanoid } from 'nanoid'
import type { AppEdge, AppNode, NodeId, WorkspaceDocument } from '../types/document'
import { serializeDocument } from '../persistence/storage'

export const CLIPBOARD_MARKER = 'nchat/clipboard'

export interface ClipboardPayload {
  type: typeof CLIPBOARD_MARKER
  version: 2
  sourceWorkspaceId: string
  nodes: AppNode[]
  edges: AppEdge[]
  bounds: { x: number; y: number; width: number; height: number }
}

export interface PasteWarning {
  code: 'parent-included' | 'set-members-removed' | 'response-interrupted'
  message: string
}

export interface MaterializeResult {
  nodes: AppNode[]
  edges: AppEdge[]
  warnings: PasteWarning[]
}

function boundsOf(nodes: AppNode[]) {
  if (nodes.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
  const minX = Math.min(...nodes.map((node) => node.position.x))
  const minY = Math.min(...nodes.map((node) => node.position.y))
  const maxX = Math.max(...nodes.map((node) => node.position.x + (node.width ?? 320)))
  const maxY = Math.max(...nodes.map((node) => node.position.y + (node.height ?? 180)))
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export function buildClipboardPayload(
  document: WorkspaceDocument,
  selectedIds: NodeId[],
): ClipboardPayload {
  const selected = new Set(selectedIds)
  const warnings: string[] = []
  for (const id of [...selected]) {
    const node = document.nodes.find((candidate) => candidate.id === id)
    if (node?.data.kind === 'response' && !selected.has(node.data.parentPromptId)) {
      selected.add(node.data.parentPromptId)
      warnings.push('Parent prompt included')
    }
  }
  const nodes = document.nodes
    .filter((node) => selected.has(node.id))
    .map((node) => structuredClone(serializeDocument({ ...document, nodes: [node], edges: [] }).nodes[0]!))
  const edges = document.edges.filter(
    (edge) => selected.has(edge.source) && selected.has(edge.target),
  )
  return {
    type: CLIPBOARD_MARKER,
    version: 2,
    sourceWorkspaceId: 'unknown',
    nodes,
    edges: edges.map((edge) => structuredClone(serializeDocument({ ...document, nodes: [], edges: [edge] }).edges[0]!)),
    bounds: boundsOf(nodes),
  }
}

export function isClipboardPayload(value: unknown): value is ClipboardPayload {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    candidate.type === CLIPBOARD_MARKER &&
    candidate.version === 2 &&
    Array.isArray(candidate.nodes) &&
    Array.isArray(candidate.edges)
  )
}

export function materializePaste(
  payload: ClipboardPayload,
  targetDocument: WorkspaceDocument,
  anchor: { x: number; y: number },
  idFactory: () => string = () => nanoid(12),
): MaterializeResult {
  const warnings: PasteWarning[] = []
  const sourceIds = new Set(payload.nodes.map((node) => node.id))
  const ids = new Map<NodeId, NodeId>()
  for (const node of payload.nodes) ids.set(node.id, idFactory())
  const nodes = payload.nodes.map((node) => {
    const copy = structuredClone(node)
    copy.id = ids.get(node.id)!
    copy.position = {
      x: anchor.x + (node.position.x - payload.bounds.x),
      y: anchor.y + (node.position.y - payload.bounds.y),
    }
    copy.selected = false
    if (copy.data.kind === 'response') {
      if (copy.data.status === 'queued' || copy.data.status === 'streaming') {
        copy.data.status = 'interrupted'
        warnings.push({ code: 'response-interrupted', message: 'Active responses were pasted as interrupted.' })
      }
      copy.data.parentPromptId = ids.get(copy.data.parentPromptId) ?? copy.data.parentPromptId
    } else if (copy.data.kind === 'set') {
      const members: NodeId[] = []
      for (const memberId of copy.data.memberIds) {
        if (ids.has(memberId)) members.push(ids.get(memberId)!)
        else if (targetDocument.nodes.some((node) => node.id === memberId)) members.push(memberId)
        else warnings.push({ code: 'set-members-removed', message: 'A Set member was not copied and was removed.' })
      }
      copy.data.memberIds = members
    } else if (copy.data.kind === 'output' && copy.data.sourceNodeIds) {
      // Only keep grouped answers that came along with the paste.
      copy.data.sourceNodeIds = copy.data.sourceNodeIds.filter(
        (id) => ids.has(id) || targetDocument.nodes.some((node) => node.id === id),
      )
    }
    return copy
  })
  const edges = payload.edges
    .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
    .map((edge) => ({
      ...structuredClone(edge),
      id: idFactory(),
      source: ids.get(edge.source)!,
      target: ids.get(edge.target)!,
      selected: false,
    }))
  for (const node of nodes) {
    if (node.data.kind !== 'prompt') continue
    const children = nodes.filter(
      (candidate) => candidate.data.kind === 'response' && candidate.data.parentPromptId === node.id,
    )
    if (children.length > 0) {
      node.data.runCount = Math.max(
        node.data.runCount,
        ...children.map((child) => child.data.kind === 'response' ? child.data.runIndex + 1 : 0),
      )
    }
  }
  if (payload.nodes.some((node) => node.data.kind === 'response')) {
    warnings.push({ code: 'parent-included', message: 'Parent prompts are included to preserve run edges.' })
  }
  void sourceIds
  return { nodes, edges, warnings }
}

export function parseClipboardText(text: string): ClipboardPayload | null {
  try {
    const value: unknown = JSON.parse(text)
    return isClipboardPayload(value) ? value : null
  } catch {
    return null
  }
}

export function externalTextToPrompt(text: string, position: { x: number; y: number }): AppNode {
  return {
    id: nanoid(12),
    type: 'prompt',
    position,
    data: {
      kind: 'prompt',
      text,
      params: { temperature: null, topP: null, maxTokens: null, stop: null },
      runCount: 0,
    },
  }
}
