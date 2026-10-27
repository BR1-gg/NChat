import { estimateMessages } from '../llm/tokens'
import type { ChatMessage } from '../llm/types'
import type { AppEdge, NodeId, ResponseStats, SummaryNodeData, WorkspaceDocument } from '../types/document'
import { createDefaultRequestSnapshot } from '../types/document'

export interface CompactCommand {
  instructions: string
}

export function parseCompactCommand(text: string): CompactCommand | null {
  if (!/^\/compact(?:\s|$)/i.test(text.trimStart())) return null
  return { instructions: text.trimStart().replace(/^\/compact\s*/i, '').trim() }
}

export function renderTranscript(messages: ChatMessage[]): string {
  return messages
    .filter((message) => message.role !== 'system')
    .map((message) => `${message.role === 'user' ? 'USER' : 'ASSISTANT'}: ${message.content}`)
    .join('\n\n')
}

export function chunkTranscript(messages: ChatMessage[], maxTokensPerChunk: number): ChatMessage[][] {
  const chunks: ChatMessage[][] = []
  let current: ChatMessage[] = []
  let currentTokens = 0
  for (const message of messages) {
    const messageTokens = estimateMessages([message])
    if (current.length > 0 && currentTokens + messageTokens > maxTokensPerChunk) {
      chunks.push(current)
      current = []
      currentTokens = 0
    }
    current.push(message)
    currentTokens += messageTokens
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

export function coverageHash(messages: ChatMessage[]): string {
  let hash = 2166136261
  for (const message of messages) {
    const value = `${message.role}:${message.content}`
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function buildSummaryData(
  messages: ChatMessage[],
  instructions: string,
  stats: ResponseStats,
  text = '',
): SummaryNodeData {
  return {
    kind: 'summary',
    text,
    status: 'queued',
    ...(instructions ? { instructions } : {}),
    coveredNodeIds: [],
    coveredMessageCount: messages.length,
    tokensBefore: estimateMessages(messages),
    tokensAfter: estimateMessages([{ role: 'assistant', content: text }]),
    coverageHash: coverageHash(messages),
    requestSnapshot: createDefaultRequestSnapshot(),
    stats,
  }
}

export interface RelinkPlan {
  removedContextEdgeIds: string[]
  addedContextEdge: AppEdge
}

/** Non-destructive relinking plan: original nodes and edges are never deleted here. */
export function planSummaryRelink(
  document: WorkspaceDocument,
  promptId: NodeId,
  summaryId: NodeId,
  createdAt = Date.now(),
): RelinkPlan {
  const removedContextEdgeIds = document.edges
    .filter((edge) => edge.kind === 'context' && edge.target === promptId)
    .map((edge) => edge.id)
  return {
    removedContextEdgeIds,
    addedContextEdge: {
      id: `summary-${summaryId}`,
      source: summaryId,
      target: promptId,
      sourceHandle: 'context',
      targetHandle: 'context',
      kind: 'context',
      createdAt,
      label: 'summary context',
    },
  }
}
