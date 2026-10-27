import dagre from 'dagre'
import type { NodeId, WorkspaceDocument } from '../types/document'
import { descendants, nodeById, siblingsOf } from './graph'

export const NODE_WIDTH = 320
export const X_GAP = 90
export const Y_GAP = 40

export function estimateNodeHeight(
  document: WorkspaceDocument,
  nodeId: NodeId,
): number {
  const node = nodeById(document, nodeId)
  if (!node) return 140
  if (node.measured?.height) return node.measured.height
  if (node.height) return node.height

  if (node.data.kind === 'prompt') return 220
  if (node.data.kind === 'system') return 170
  if (node.data.kind === 'note') return 160
  const text = typeof node.data.text === 'string' ? node.data.text : ''
  const lines = text.split('\n').length
  const wrappedLines = Math.max(lines, Math.ceil(text.length / 48))
  return Math.min(640, Math.max(140, 100 + wrappedLines * 22))
}

export function placeResponseNode(
  document: WorkspaceDocument,
  promptId: NodeId,
): { x: number; y: number } {
  const prompt = nodeById(document, promptId)
  if (!prompt) return { x: 0, y: 0 }

  const promptWidth = prompt.width ?? prompt.measured?.width ?? NODE_WIDTH
  const x = prompt.position.x + promptWidth + X_GAP
  const siblings = siblingsOf(document, promptId)
  const last = siblings.at(-1)
  if (!last) return { x, y: prompt.position.y }

  const subtreeIds = descendants(document, last.id)
  subtreeIds.add(last.id)
  let subtreeBottom = last.position.y + estimateNodeHeight(document, last.id)
  for (const id of subtreeIds) {
    const node = nodeById(document, id)
    if (node) {
      subtreeBottom = Math.max(
        subtreeBottom,
        node.position.y + estimateNodeHeight(document, id),
      )
    }
  }
  return { x, y: subtreeBottom + Y_GAP }
}

export function autoLayout(document: WorkspaceDocument): Map<NodeId, { x: number; y: number }> {
  const graph = new dagre.graphlib.Graph({ multigraph: true, directed: true })
  graph.setGraph({
    rankdir: 'LR',
    nodesep: 50,
    ranksep: 110,
    marginx: 30,
    marginy: 30,
  })
  graph.setDefaultEdgeLabel(() => ({}))

  const orderedNodes = [...document.nodes].sort(
    (a, b) => a.position.x - b.position.x || a.id.localeCompare(b.id),
  )
  for (const node of orderedNodes) {
    graph.setNode(node.id, {
      width: node.width || NODE_WIDTH,
      height: estimateNodeHeight(document, node.id),
    })
  }
  for (const edge of document.edges) {
    graph.setEdge(edge.source, edge.target, {}, edge.id)
  }
  dagre.layout(graph)

  const positions = new Map<NodeId, { x: number; y: number }>()
  for (const node of orderedNodes) {
    const laidOut = graph.node(node.id) as { x?: number; y?: number } | undefined
    if (typeof laidOut?.x !== 'number' || typeof laidOut.y !== 'number') continue
    positions.set(node.id, {
      x: laidOut.x - (node.width || NODE_WIDTH) / 2,
      y: laidOut.y - estimateNodeHeight(document, node.id) / 2,
    })
  }
  return positions
}
