import type {
  AppEdge,
  AppNode,
  EdgeKind,
  NodeId,
  ResponseNode,
  SummaryNode,
  WorkspaceDocument,
} from '../types/document'
import { appError, type AppError } from '../types/errors'

export function nodeById(document: WorkspaceDocument, id: NodeId): AppNode | undefined {
  return document.nodes.find((node) => node.id === id)
}

export function edgesOf(document: WorkspaceDocument, id: NodeId): AppEdge[] {
  return document.edges.filter((edge) => edge.source === id || edge.target === id)
}

export function incomingContextEdges(
  document: WorkspaceDocument,
  promptId: NodeId,
): AppEdge[] {
  return document.edges
    .filter(
      (edge) =>
        edge.kind === 'context' &&
        edge.target === promptId &&
        edge.targetHandle === 'context',
    )
    .sort((a, b) => a.createdAt - b.createdAt)
}

export function incomingSystemEdge(
  document: WorkspaceDocument,
  promptId: NodeId,
): AppEdge | undefined {
  return document.edges
    .filter(
      (edge) =>
        edge.kind === 'system' && edge.target === promptId && edge.targetHandle === 'system',
    )
    .sort((a, b) => b.createdAt - a.createdAt)[0]
}

export function outgoingRunEdges(document: WorkspaceDocument, promptId: NodeId): AppEdge[] {
  return document.edges
    .filter((edge) => edge.kind === 'run' && edge.source === promptId)
    .sort((a, b) => a.createdAt - b.createdAt)
}

export function siblingsOf(document: WorkspaceDocument, promptId: NodeId): ResponseNode[] {
  const siblingIds = new Set(
    outgoingRunEdges(document, promptId).map((edge) => edge.target),
  )
  return document.nodes
    .filter(
      (node): node is ResponseNode =>
        siblingIds.has(node.id) && node.data.kind === 'response',
    )
    .sort((a, b) => a.data.runIndex - b.data.runIndex)
}

export function descendants(document: WorkspaceDocument, id: NodeId): Set<NodeId> {
  const found = new Set<NodeId>()
  const pending: NodeId[] = [id]
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) continue
    for (const edge of document.edges) {
      if (edge.source === current && !found.has(edge.target)) {
        found.add(edge.target)
        pending.push(edge.target)
      }
    }
  }
  return found
}

export function wouldCreateCycle(
  document: WorkspaceDocument,
  sourceId: NodeId,
  targetId: NodeId,
): boolean {
  if (sourceId === targetId) return true
  const source = nodeById(document, sourceId)
  if (
    source?.data.kind === 'set' &&
    source.data.memberIds.includes(targetId) &&
    nodeById(document, targetId)?.data.kind === 'prompt'
  ) {
    return true
  }
  const visited = new Set<NodeId>()
  const pending = [targetId]
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) continue
    if (current === sourceId) return true
    if (visited.has(current)) continue
    visited.add(current)
    for (const edge of document.edges) {
      if (edge.source === current) pending.push(edge.target)
    }
  }
  return false
}

export function graphHasCycle(document: WorkspaceDocument): boolean {
  const visiting = new Set<NodeId>()
  const visited = new Set<NodeId>()
  const visit = (id: NodeId): boolean => {
    if (visiting.has(id)) return true
    if (visited.has(id)) return false
    visiting.add(id)
    for (const edge of document.edges) {
      if (edge.source === id && visit(edge.target)) return true
    }
    visiting.delete(id)
    visited.add(id)
    return false
  }
  return document.nodes.some((node) => visit(node.id))
}

export function nextRunIndex(document: WorkspaceDocument, promptId: NodeId): number {
  const prompt = nodeById(document, promptId)
  const siblingMaximum = siblingsOf(document, promptId).reduce(
    (maximum, response) => Math.max(maximum, response.data.runIndex + 1),
    0,
  )
  return Math.max(siblingMaximum, prompt?.data.kind === 'prompt' ? prompt.data.runCount : 0)
}

export function contextResponsesForPrompt(
  document: WorkspaceDocument,
  promptId: NodeId,
): ResponseNode[] {
  const found = new Map<NodeId, ResponseNode>()
  const visitedPrompts = new Set<NodeId>()
  const visit = (id: NodeId): void => {
    if (visitedPrompts.has(id)) return
    visitedPrompts.add(id)
    for (const edge of incomingContextEdges(document, id)) {
      const source = nodeById(document, edge.source)
      if (isResponseNode(source)) {
        if (!found.has(source.id)) found.set(source.id, source)
        visit(source.data.parentPromptId)
      } else if (isSummaryNode(source)) {
        for (const coveredId of source.data.coveredNodeIds) {
          const covered = nodeById(document, coveredId)
          if (isResponseNode(covered) && !found.has(covered.id)) {
            found.set(covered.id, covered)
          }
        }
      }
    }
  }
  visit(promptId)
  return [...found.values()]
}

export function contextSummariesForPrompt(
  document: WorkspaceDocument,
  promptId: NodeId,
): SummaryNode[] {
  return incomingContextEdges(document, promptId)
    .map((edge) => nodeById(document, edge.source))
    .filter(isSummaryNode)
}

export interface ConnectionDescriptor {
  sourceId: NodeId
  sourceHandle: string | null
  targetId: NodeId
  targetHandle: string | null
}

export function connectionKind(
  document: WorkspaceDocument,
  connection: ConnectionDescriptor,
): EdgeKind | AppError {
  const source = nodeById(document, connection.sourceId)
  const target = nodeById(document, connection.targetId)
  if (!source || !target) {
    return appError('INVALID_CONNECTION', 'One of the selected nodes no longer exists.')
  }
  if (source.id === target.id) {
    return appError('INVALID_CONNECTION', 'A node cannot connect to itself.')
  }

  const contextSource =
    (source.data.kind === 'response' || source.data.kind === 'summary') &&
    connection.sourceHandle === 'context'
  if (contextSource && target.data.kind === 'prompt' && connection.targetHandle === 'context') {
    return cycleGuard(document, source.id, target.id, 'context')
  }

  if (
    (source.data.kind === 'set' || source.data.kind === 'output') &&
    (connection.sourceHandle === 'out' || connection.sourceHandle === 'context') &&
    target.data.kind === 'prompt' &&
    connection.targetHandle === 'context'
  ) {
    return cycleGuard(document, source.id, target.id, 'context')
  }

  // A file or a folder is text, so it plugs into the ordinary context input and
  // needs no handle of its own. The check lives here because forgetting it makes
  // the connection fail silently: no edge, no error, nothing in the console.
  if (
    (source.data.kind === 'file' || source.data.kind === 'folder') &&
    connection.sourceHandle === 'out' &&
    target.data.kind === 'prompt' &&
    connection.targetHandle === 'context'
  ) {
    return cycleGuard(document, source.id, target.id, 'context')
  }

  /*
   * Una nota e' testo, quindi va dove va un file: dentro il contesto di un prompt, o
   * dentro un gruppo comeRisposta.
   *
   * Prima non si poteva collegare niente: la nota non aveva maniglie e la regola qui
   * non c'era. Il risultato era che una nota — che e' il posto naturale per mettere
   * un appunto che si vuole ricordare al modello — finiva per essere solo un foglio
   * sulla tela, con il testo che nessuno poteva usare. E il doppio click per aggiungere
   * un prompt accanto era l'unico modo per portarla dentro.
   */
  if (
    source.data.kind === 'note' &&
    connection.sourceHandle === 'out' &&
    target.data.kind === 'prompt' &&
    connection.targetHandle === 'context'
  ) {
    return cycleGuard(document, source.id, target.id, 'context')
  }

  /*
   * Un nodo Knowledge manda note dell'archivio a un prompt, quindi va dove va un file.
   *
   * E' una riga sua e non una condizione aggiunta a quella del file perche' la regola deve
   * stare **qui**: `connectionKind` e' l'unica cosa che decide se una connessione esiste. Se
   * questa lista si scorda di un tipo di nodo, la connessione semplicemente non si forma —
   * senza errore e senza niente in console. Il sintomo e' un nodo che sembra scollegato e a
   * cui non si puo' collegare niente, che e' il peggiore modo in cui un nuovo tipo di nodo
   * puo' arrivare nell'applicazione senza che nessuno se ne accorga.
   */
  if (
    source.data.kind === 'knowledge' &&
    connection.sourceHandle === 'out' &&
    target.data.kind === 'prompt' &&
    connection.targetHandle === 'context'
  ) {
    return cycleGuard(document, source.id, target.id, 'context')
  }

  if (
    source.data.kind === 'note' &&
    connection.sourceHandle === 'out' &&
    target.data.kind === 'output' &&
    connection.targetHandle === 'in'
  ) {
    return cycleGuard(document, source.id, target.id, 'display')
  }

  // Folder to Brain: files to read. No cycle check is needed, because a Brain
  // never leads back to a folder it read from on its own; the Brain to folder
  // edge below is the one that could, and it is the run that writes, not a graph
  // walk, so it is bounded by the node's own limits instead.
  if (
    source.data.kind === 'folder' &&
    connection.sourceHandle === 'out' &&
    target.data.kind === 'brain' &&
    connection.targetHandle === 'in'
  ) {
    return 'flow'
  }

  // Brain to folder: files to write. This is the edge that touches the disk, so
  // it is kept apart from `context` rather than sharing it: a run must never be
  // reachable by wiring a prompt into a folder.
  if (
    source.data.kind === 'brain' &&
    connection.sourceHandle === 'out' &&
    target.data.kind === 'folder' &&
    connection.targetHandle === 'in'
  ) {
    return 'flow'
  }

  if (
    (source.data.kind === 'set' || source.data.kind === 'response' || source.data.kind === 'summary') &&
    (connection.sourceHandle === 'out' || connection.sourceHandle === 'context') &&
    target.data.kind === 'output' &&
    connection.targetHandle === 'in'
  ) {
    return cycleGuard(document, source.id, target.id, 'display')
  }

  if (
    source.data.kind === 'image' &&
    connection.sourceHandle === 'out' &&
    target.data.kind === 'prompt' &&
    connection.targetHandle === 'image'
  ) {
    // Un'immagine va su un ingresso dedicato, non su contesto: il contesto e
    // testo e finirebbe nel messaggio come stringa.
    return cycleGuard(document, source.id, target.id, 'image')
  }

  if (
    source.data.kind === 'system' &&
    connection.sourceHandle === 'out' &&
    target.data.kind === 'prompt' &&
    connection.targetHandle === 'system'
  ) {
    return cycleGuard(document, source.id, target.id, 'system')
  }

  if (source.data.kind === 'note') {
    return appError('INVALID_CONNECTION', 'A note cannot be connected.')
  }
  return appError('INVALID_CONNECTION', 'Those node handles cannot be connected.')
}

function cycleGuard(
  document: WorkspaceDocument,
  sourceId: NodeId,
  targetId: NodeId,
  kind: EdgeKind,
): EdgeKind | AppError {
  return wouldCreateCycle(document, sourceId, targetId)
    ? appError('INVALID_CONNECTION', 'This would create a loop.')
    : kind
}

export function isAppEdge(value: EdgeKind | AppError): value is EdgeKind {
  return (
    value === 'run' ||
    value === 'context' ||
    value === 'system' ||
    value === 'display' ||
    value === 'image' ||
    value === 'flow'
  )
}

function isResponseNode(node: AppNode | undefined): node is ResponseNode {
  return node?.data.kind === 'response'
}

function isSummaryNode(node: AppNode | undefined): node is SummaryNode {
  return node?.data.kind === 'summary'
}
