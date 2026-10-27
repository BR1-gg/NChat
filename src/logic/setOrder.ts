import type { NodeId, WorkspaceDocument } from '../types/document'

/**
 * Orders Set members in reading order (y, then x) so a Set created from a
 * selection lists its prompts the way they are laid out on the canvas.
 */
export function readingOrder(document: WorkspaceDocument, ids: NodeId[]): NodeId[] {
  return [...ids].sort((a, b) => {
    const na = document.nodes.find((node) => node.id === a)
    const nb = document.nodes.find((node) => node.id === b)
    if (!na || !nb) return 0
    return na.position.y - nb.position.y || na.position.x - nb.position.x
  })
}
