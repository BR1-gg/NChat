import { appError, type AppError } from '../../types/errors'
import type {
  AppNode,
  NodeId,
  ResponseNode,
  SetPickStrategy,
  WorkspaceDocument,
} from '../../types/document'
import { siblingsOf } from '../graph'
import { fileBlock } from '../filetext'

export interface AggregateItem {
  sourceNodeId: NodeId
  label: string
  question?: string
  text: string
}

export interface CollectOptions {
  includePromptText?: boolean
  /** Set-level choice of which answers to take from a prompt member. */
  pick?: SetPickStrategy
}

export interface AggregatableAdapter<K extends AppNode['type'] = AppNode['type']> {
  kind: K
  canAggregate(node: AppNode): boolean
  collect(document: WorkspaceDocument, node: AppNode, options?: CollectOptions): AggregateItem[]
  readiness(document: WorkspaceDocument, node: AppNode): 'ready' | 'pending' | 'missing' | 'failed'
  dependencies(document: WorkspaceDocument, node: AppNode): NodeId[]
}

function isPrompt(node: AppNode): node is Extract<AppNode, { type: 'prompt' }> {
  return node.type === 'prompt'
}

function responseItem(response: ResponseNode, question: string | undefined): AggregateItem {
  return {
    sourceNodeId: response.id,
    label: `Response #${response.data.runIndex + 1}`,
    ...(question ? { question } : {}),
    text: response.data.text,
  }
}

export const promptAdapter: AggregatableAdapter<'prompt'> = {
  kind: 'prompt',
  canAggregate: isPrompt,
  collect(document, node, options = {}) {
    const responses = siblingsOf(document, node.id).filter(
      (response) => response.data.status === 'done' || response.data.status === 'aborted',
    )
    const pick = options.pick ?? node.data.pick
    const selected = pick === 'all-done' ? responses : responses.slice(-1)
    return selected.map((response) =>
      responseItem(response, options.includePromptText === false ? undefined : String(node.data.text ?? '')),
    )
  },
  readiness(document, node) {
    const children = siblingsOf(document, node.id)
    if (children.length === 0) return 'missing'
    if (children.some((child) => child.data.status === 'error' || child.data.status === 'interrupted')) return 'failed'
    if (children.some((child) => child.data.status !== 'done' && child.data.status !== 'aborted')) return 'pending'
    return 'ready'
  },
  dependencies(document, node) {
    return siblingsOf(document, node.id).map((child) => child.id)
  },
}

export const responseAdapter: AggregatableAdapter<'response'> = {
  kind: 'response',
  canAggregate: (node) => node.type === 'response',
  collect(document, node) {
    if (node.data.kind !== 'response') return []
    const response = node as unknown as ResponseNode
    // "#1" alone is ambiguous once answers from different prompts are merged,
    // so the question that produced the answer becomes the label.
    const parent = document.nodes.find(
      (candidate) => candidate.id === response.data.parentPromptId && candidate.data.kind === 'prompt',
    )
    const question =
      parent && parent.data.kind === 'prompt' && typeof parent.data.text === 'string'
        ? parent.data.text.trim().split('\n')[0]?.slice(0, 60) ?? ''
        : ''
    const item = responseItem(response, question || undefined)
    return question
      ? [{ ...item, label: question || item.label }]
      : [item]
  },
  readiness(_document, node) {
    if (node.data.kind !== 'response') return 'missing'
    if (node.data.status === 'done' || node.data.status === 'aborted') return 'ready'
    if (node.data.status === 'error' || node.data.status === 'interrupted') return 'failed'
    return 'pending'
  },
  dependencies() {
    return []
  },
}

export const summaryAdapter: AggregatableAdapter<'summary'> = {
  kind: 'summary',
  canAggregate: (node) => node.type === 'summary',
  collect(_document, node) {
    if (node.data.kind !== 'summary') return []
    return [{ sourceNodeId: node.id, label: node.data.title || 'Summary', text: node.data.text }]
  },
  readiness(_document, node) {
    if (node.data.kind !== 'summary') return 'missing'
    if (node.data.status === 'done' || node.data.status === 'aborted') return 'ready'
    if (node.data.status === 'error' || node.data.status === 'interrupted') return 'failed'
    return 'pending'
  },
  dependencies() {
    return []
  },
}

export const setAdapter: AggregatableAdapter<'set'> = {
  kind: 'set',
  canAggregate: (node) => node.type === 'set',
  collect(document, node, options = {}) {
    if (node.data.kind !== 'set') return []
    const visiting = new Set<NodeId>()
    const visit = (id: NodeId): AggregateItem[] => {
      if (visiting.has(id)) {
        throw appError('GRAPH_CYCLE', 'This Set contains a loop.', { hint: 'Remove the circular Set membership.' })
      }
      visiting.add(id)
      const member = document.nodes.find((candidate) => candidate.id === id)
      if (!member) return []
      if (member.data.kind === 'set') {
        return member.data.memberIds.flatMap(visit)
      }
      if (member.data.kind === 'prompt') {
        // The Set decides which answers to take, not the prompt.
        return promptAdapter.collect(document, member, { ...options, pick: node.data.pick as SetPickStrategy })
      }
      if (member.data.kind === 'response') return responseAdapter.collect(document, member, options)
      if (member.data.kind === 'summary') return summaryAdapter.collect(document, member, options)
      if (member.data.kind === 'output') return outputAdapter.collect(document, member, options)
      if (member.data.kind === 'image') return imageAdapter.collect(document, member, options)
      if (member.data.kind === 'file') return fileAdapter.collect(document, member, options)
      if (member.data.kind === 'folder') return folderAdapter.collect(document, member, options)
      return []
    }
    const items = node.data.memberIds.flatMap(visit)
    visiting.clear()
    return items
  },
  readiness(document, node) {
    if (node.data.kind !== 'set') return 'missing'
    const states = node.data.memberIds.map((id) => {
      const member = document.nodes.find((candidate) => candidate.id === id)
      if (!member) return 'missing' as const
      if (member.data.kind === 'set') return setAdapter.readiness(document, member)
      if (member.data.kind === 'output') return outputAdapter.readiness(document, member)
      if (member.data.kind === 'prompt') return promptAdapter.readiness(document, member)
      if (member.data.kind === 'response') return responseAdapter.readiness(document, member)
      return 'ready' as const
    })
    if (states.includes('failed')) return 'failed'
    if (states.includes('pending')) return 'pending'
    if (states.includes('missing')) return 'missing'
    return 'ready'
  },
  dependencies(document, node) {
    if (node.data.kind !== 'set') return []
    return node.data.memberIds.flatMap((id) => {
      const member = document.nodes.find((candidate) => candidate.id === id)
      if (!member) return []
      if (member.data.kind === 'set') return setAdapter.dependencies(document, member)
      if (member.data.kind === 'output') return outputAdapter.dependencies(document, member)
      if (member.data.kind === 'prompt') return promptAdapter.dependencies(document, member)
      return []
    })
  },
}

export const outputAdapter: AggregatableAdapter<'output'> = {
  kind: 'output',
  canAggregate: (node) => node.type === 'output',
  collect(document, node, options = {}) {
    if (node.data.kind !== 'output') return []
    // An output that owns a group contributes the answers it groups, so groups
    // can be nested without collapsing into duplicated text.
    if (node.data.sourceNodeIds?.length) {
      return node.data.sourceNodeIds.flatMap((id) => {
        const member = document.nodes.find((candidate) => candidate.id === id)
        if (!member) return []
        return collectAggregate(document, member, options)
      })
    }
    const text = node.data.synthesis?.status === 'done' ? node.data.synthesis.text : node.data.text
    if (!text.trim()) return []
    return [{ sourceNodeId: node.id, label: node.data.title || 'Output', text }]
  },
  readiness(document, node) {
    if (node.data.kind !== 'output') return 'missing'
    if (node.data.sourceNodeIds?.length) {
      const states = node.data.sourceNodeIds.map((id) => {
        const member = document.nodes.find((candidate) => candidate.id === id)
        if (!member) return 'missing' as const
        return getAdapter(member.type)?.readiness(document, member) ?? 'ready'
      })
      if (states.includes('failed')) return 'failed'
      if (states.includes('pending')) return 'pending'
      if (states.includes('missing')) return 'missing'
      return 'ready'
    }
    return node.data.text.trim() ? 'ready' : 'pending'
  },
  dependencies(_document, node) {
    if (node.data.kind !== 'output') return []
    return node.data.sourceNodeIds ?? []
  },
}

export const imageAdapter: AggregatableAdapter<'image'> = {
  kind: 'image',
  canAggregate: (node) => node.type === 'image',
  collect(_document, node) {
    if (node.data.kind !== 'image') return []
    // An image contributes no text worth sending. It only says that there *is* a
    // picture here, so the model knows the marker refers to something it can
    // actually see; the picture itself travels as an image part.
    const label = node.data.name || 'image'
    return [
      {
        sourceNodeId: node.id,
        label,
        text: node.data.isVideo ? `[video: ${label}]` : `[image: ${label}]`,
      },
    ]
  },
  readiness(_document, node) {
    if (node.data.kind !== 'image') return 'missing'
    return node.data.src ? 'ready' : 'missing'
  },
  dependencies() {
    return []
  },
}

export const fileAdapter: AggregatableAdapter<'file'> = {
  kind: 'file',
  canAggregate: (node) => node.type === 'file',
  collect(_document, node) {
    if (node.data.kind !== 'file') return []
    if (node.data.error || !node.data.text.trim()) return []
    return [
      {
        sourceNodeId: node.id,
        label: node.data.name,
        text: fileBlock(node.data),
      },
    ]
  },
  readiness(_document, node) {
    if (node.data.kind !== 'file') return 'missing'
    if (node.data.error) return 'failed'
    return node.data.text.trim() ? 'ready' : 'missing'
  },
  dependencies() {
    return []
  },
}

export const folderAdapter: AggregatableAdapter<'folder'> = {
  kind: 'folder',
  canAggregate: (node) => node.type === 'folder',
  collect(_document, node) {
    if (node.data.kind !== 'folder') return []
    if (node.data.error || !node.data.text.trim()) return []
    return [{ sourceNodeId: node.id, label: node.data.name, text: node.data.text }]
  },
  readiness(_document, node) {
    if (node.data.kind !== 'folder') return 'missing'
    if (node.data.error) return 'failed'
    return node.data.fileCount > 0 ? 'ready' : 'missing'
  },
  dependencies() {
    return []
  },
}

/*
 * Una nota raccoglie il proprio testo, come un file raccoglie il proprio.
 *
 * Senza questo adattatore, raggruppare una nota produceva un Output vuoto: il gruppo
 * la contava fra i membri ma non sapeva cosa leggerne, quindi il risultato finiva
 * col testo delle risposte e senza la nota — che e' il caso peggiore, perche' sembra
 * che la nota sia stata aggiunta e invece e' sparita.
 */
export const noteAdapter: AggregatableAdapter<'note'> = {
  kind: 'note',
  canAggregate: (node) => node.type === 'note',
  collect(_document, node) {
    if (node.data.kind !== 'note') return []
    const text = node.data.text.trim()
    if (!text) return []
    // Con l'intestazione, per lo stesso motivo del contesto: in un gruppo con altre
    // risposte, il testo nudo non si distinguerebbe da una risposta.
    return [{ sourceNodeId: node.id, label: 'Note', text: `## Note\n${text}` }]
  },
  readiness(_document, node) {
    if (node.data.kind !== 'note') return 'missing'
    return node.data.text.trim() ? 'ready' : 'missing'
  },
  dependencies() {
    return []
  },
}

const adapters: AggregatableAdapter[] = [
  promptAdapter,
  responseAdapter,
  summaryAdapter,
  setAdapter,
  outputAdapter,
  imageAdapter,
  fileAdapter,
  folderAdapter,
  noteAdapter,
]

export function getAdapter(kind: AppNode['type']): AggregatableAdapter | undefined {
  return adapters.find((adapter) => adapter.kind === kind)
}

export function collectAggregate(
  document: WorkspaceDocument,
  node: AppNode,
  options?: CollectOptions,
): AggregateItem[] {
  const adapter = getAdapter(node.type)
  return adapter?.collect(document, node, options) ?? []
}

export function aggregateReadiness(
  document: WorkspaceDocument,
  node: AppNode,
): 'ready' | 'pending' | 'missing' | 'failed' {
  return getAdapter(node.type)?.readiness(document, node) ?? 'missing'
}

export function aggregateDependencies(document: WorkspaceDocument, node: AppNode): NodeId[] {
  return getAdapter(node.type)?.dependencies(document, node) ?? []
}

export function aggregateError(message: string): AppError {
  return appError('INVALID_CONNECTION', message)
}
