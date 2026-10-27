import { addableNodeTypes } from '../nodes/registry'
import type {
  AddableNodeType,
  AppNode,
  EdgeKind,
  HandleId,
  WorkspaceDocument,
} from '../types/document'
import { connectionKind, isAppEdge } from './graph'

/**
 * Which nodes a handle can actually be dragged onto.
 *
 * React Flow already refuses an invalid drop, but it refuses it by showing a red
 * handle: you find out that a connection was impossible only by trying it. On a
 * busy canvas that means guessing, and the two handles on a folder look
 * identical while meaning the opposite things, reading from it and writing into
 * it.
 *
 * So the answer is worked out first, as data, and shown as a list. Nothing here
 * creates an edge: `connectionKind` still decides, so a bug in this list can at
 * worst offer a wrong option, never make a wrong edge.
 */

export interface CompatibleTarget {
  nodeId: string
  /** The handle on the target this source connects to. */
  handleId: HandleId
  kind: EdgeKind
  /** What the target is called, for the list. */
  label: string
  /** A few words on what connecting would mean. */
  hint: string
}

/** The handles a node offers, each with a plain description. */
export function handlesOf(node: AppNode): Array<{ id: HandleId; hint: string }> {
  switch (node.type) {
    case 'prompt':
      return [
        { id: 'context', hint: 'as context' },
        { id: 'system', hint: 'as instructions' },
        { id: 'image', hint: 'as the picture' },
      ]
    case 'response':
      return [{ id: 'context', hint: 'as context' }]
    case 'summary':
      return [{ id: 'context', hint: 'as context' }]
    case 'system':
      return [{ id: 'out', hint: 'into a prompt' }]
    case 'image':
      return [{ id: 'out', hint: 'as the picture' }]
    case 'file':
      return [{ id: 'out', hint: 'as context' }]
    case 'folder':
      return [
        { id: 'out', hint: 'as context, or to a Brain' },
        { id: 'in', hint: 'a Brain writes here' },
      ]
    case 'output':
      return [{ id: 'out', hint: 'into a prompt or a group' }]
    case 'brain':
      return [
        { id: 'in', hint: 'a folder to read' },
        { id: 'out', hint: 'a folder to write' },
      ]
    case 'note':
      return [{ id: 'out', hint: 'as context, or into a group' }]
    case 'knowledge':
      // Una sola maniglia e un solo significato: questo nodo **manda** note dell'archivio a un
      // prompt, e non riceve niente. Due maniglie avrebbero suggerito che si possa anche
      // alimentarlo — che si potrebbe, ma non ha senso: il nodo legge gia' l'archivio e non ha
      // niente da ricevere da un altro nodo.
      return [{ id: 'out', hint: 'as context' }]
    case 'set':
      return []
    default:
      return []
  }
}

function labelOf(node: AppNode): string {
  const data = node.data
  switch (data.kind) {
    case 'prompt':
      return data.text.trim().split('\n')[0]?.slice(0, 40) || 'Prompt'
    case 'response':
      return data.title?.trim() || 'Response'
    case 'summary':
      return data.title?.trim() || 'Summary'
    case 'system':
      return data.title?.trim() || 'System'
    case 'image':
      return data.name || 'Image'
    case 'file':
      return data.name || 'File'
    case 'folder':
      return data.name || 'Folder'
    case 'brain':
      return data.title?.trim() || 'Brain'
    case 'knowledge':
      return data.title?.trim() || 'Knowledge'
    case 'output':
      return data.title?.trim() || 'Group'
    default:
      return node.type
  }
}

/**
 * The kinds a source handle can produce, in the order a person means them.
 *
 * A list in document order would put an unrelated node above the one that was
 * meant, and for a folder's `out` handle the difference between "as context" and
 * "to a Brain" is the whole point of the list existing.
 */
const KIND_ORDER: Partial<Record<string, EdgeKind[]>> = {
  context: ['context', 'display'],
  image: ['image'],
  system: ['system'],
  out: ['context', 'flow', 'system', 'image', 'display'],
  in: ['flow', 'context'],
}

/**
 * Every node this source handle may connect to, one entry per target handle.
 *
 * A target with two valid handles appears twice, and each entry says which: that
 * is the honest list, not a merged one, because the two mean different things.
 */
export function compatibleTargets(
  document: WorkspaceDocument,
  sourceId: string,
  sourceHandle: HandleId | null,
): CompatibleTarget[] {
  const source = document.nodes.find((node) => node.id === sourceId)
  if (!source) return []
  const wanted = KIND_ORDER[sourceHandle ?? 'out'] ?? []
  const found: CompatibleTarget[] = []
  for (const target of document.nodes) {
    if (target.id === sourceId) continue
    for (const handle of handlesOf(target)) {
      // The real document, not a subset: `connectionKind` checks for cycles, and
      // that check walks the edges. A narrowed argument would be a cast, and a
      // cast here is how a "compatible" list starts offering connections that the
      // graph then refuses.
      const kind = connectionKind(document, {
        sourceId,
        sourceHandle: sourceHandle ?? null,
        targetId: target.id,
        targetHandle: handle.id,
      })
      if (!isAppEdge(kind)) continue
      found.push({
        nodeId: target.id,
        handleId: handle.id,
        kind,
        label: labelOf(target),
        hint: handle.hint,
      })
    }
  }
  const rank = (entry: CompatibleTarget): number => {
    const index = wanted.indexOf(entry.kind)
    return index === -1 ? wanted.length : index
  }
  return found.sort((a, b) => rank(a) - rank(b))
}

/**
 * A node of a given type, with nothing in it, for asking what it would accept.
 *
 * A stub rather than a real node because the question is about **type**, not
 * about any particular node: "would a Prompt accept this?" is the same question
 * whatever the prompt says. `connectionKind` reads only the type and the kind, and
 * the cycle check reads the edges, which the stub does not touch.
 */
function stubOf(type: AddableNodeType, id: string): AppNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: { kind: type },
  } as unknown as AppNode
}

/**
 * The document as it would look with a fresh node of this type in it.
 *
 * The stub has to be **inside** the document, not merely named by its id:
 * `connectionKind` resolves both nodes from the document, so a node that is not
 * there counts as missing and every connection is refused. The stub has no edges,
 * so it cannot be part of a cycle and the cycle check is unaffected.
 */
function withStub(
  document: WorkspaceDocument,
  type: AddableNodeType,
): { document: WorkspaceDocument; stub: AppNode } {
  const stub = stubOf(type, `__probe__${type}`)
  return { document: { ...document, nodes: [...document.nodes, stub] }, stub }
}

/**
 * Which node types could accept a connection from this handle.
 *
 * This is what the palette offers after a drag is released on empty canvas: only
 * the types that would actually connect. Offering the full list and letting the
 * user guess is what made the previous attempt useless, and a refusal after the
 * fact is the worst possible answer, because the node is already created.
 */
export function compatibleTypes(
  document: WorkspaceDocument,
  sourceId: string,
  sourceHandle: HandleId | null,
): AddableNodeType[] {
  const wanted = KIND_ORDER[sourceHandle ?? 'out'] ?? []
  /** Where this type lands in the wanted order, or Infinity if nowhere. */
  const rankOf = (type: AddableNodeType): number => {
    const probe = withStub(document, type)
    for (const handle of handlesOf(probe.stub)) {
      const kind = connectionKind(probe.document, {
        sourceId,
        sourceHandle: sourceHandle ?? null,
        targetId: probe.stub.id,
        targetHandle: handle.id,
      })
      if (!isAppEdge(kind)) continue
      const index = wanted.indexOf(kind)
      return index === -1 ? wanted.length : index
    }
    return Number.POSITIVE_INFINITY
  }
  return addableNodeTypes
    .filter((type) => Number.isFinite(rankOf(type)))
    .sort((a, b) => rankOf(a) - rankOf(b))
}

/**
 * Which handle on a **new** node of this type the connection should arrive at.
 *
 * Worked out with the same check that decides the connection, and in the same
 * order the palette lists the types, so the handle used is the one the offer was
 * based on. Picking it by hand would be the kind of shortcut that works until a
 * node grows a second input.
 */
export function targetHandleFor(
  document: WorkspaceDocument,
  sourceId: string,
  sourceHandle: HandleId | null,
  type: AddableNodeType,
): HandleId | null {
  const wanted = KIND_ORDER[sourceHandle ?? 'out'] ?? []
  const probe = withStub(document, type)
  const candidates = handlesOf(probe.stub)
    .map((handle) => {
      const kind = connectionKind(probe.document, {
        sourceId,
        sourceHandle: sourceHandle ?? null,
        targetId: probe.stub.id,
        targetHandle: handle.id,
      })
      if (!isAppEdge(kind)) return null
      const index = wanted.indexOf(kind)
      return { id: handle.id, rank: index === -1 ? wanted.length : index }
    })
    .filter((entry): entry is { id: HandleId; rank: number } => entry !== null)
    .sort((a, b) => a.rank - b.rank)
  return candidates[0]?.id ?? null
}
