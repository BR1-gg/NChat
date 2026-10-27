import { getLLMClient } from '../llm/client'
import { estimateMessages } from '../llm/tokens'
import type { ChatMessage } from '../llm/types'
import { assembleMessages } from '../logic/assemble'
import {
  chunkTranscript,
  coverageHash,
  parseCompactCommand,
  planSummaryRelink,
  renderTranscript,
} from '../logic/compact'
import { enqueueJob } from '../queue/runQueue'
import { useRunStore } from '../store/runStore'
import { useUiStore } from '../store/uiStore'
import {
  getActiveWorkspaceStore,
  workspaceDocumentFromState,
  type WorkspaceStoreApi,
} from '../store/workspaceStore'
import type { SummaryNodeData } from '../types/document'
import { appError, isAppError } from '../types/errors'
import { DEFAULT_APP_SETTINGS } from '../types/settings'

interface UndoPlan {
  promptId: string
  removedEdgeIds: string[]
  summaryId: string
}

const undoPlans = new Map<string, UndoPlan>()

/** Context of the target prompt without the final user message and without system. */
function contextMessages(messages: ChatMessage[]): ChatMessage[] {
  const withoutSystem = messages.filter((message) => message.role !== 'system')
  const lastUserIndex = withoutSystem.map((message) => message.role).lastIndexOf('user')
  return lastUserIndex >= 0 ? withoutSystem.slice(0, lastUserIndex) : withoutSystem
}

/** Response ids whose text actually appears in the summarised messages. */
function coveredResponses(messages: ChatMessage[], store: WorkspaceStoreApi): string[] {
  const state = store.getState()
  const covered: string[] = []
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    const response = state.nodes.find(
      (node) => node.data.kind === 'response' && node.data.text === message.content,
    )
    if (response) covered.push(response.id)
  }
  return covered
}

function buildSummaryData(
  messages: ChatMessage[],
  instructions: string,
  model: string,
  systemPrompt: string,
  maxTokens: number,
  coveredNodeIds: string[],
): SummaryNodeData {
  return {
    kind: 'summary',
    text: '',
    status: 'queued',
    ...(instructions ? { instructions } : {}),
    coveredNodeIds,
    coveredMessageCount: messages.length,
    tokensBefore: estimateMessages(messages),
    tokensAfter: 0,
    coverageHash: coverageHash(messages),
    requestSnapshot: {
      model,
      params: { temperature: 0.2, topP: 1, maxTokens, stop: null },
      systemPrompt,
      messageCount: messages.length,
      estPromptTokens: estimateMessages(messages),
    },
    stats: { startedAt: Date.now() },
  }
}

function summarySettings(store: WorkspaceStoreApi) {
  const state = store.getState()
  return { ...DEFAULT_APP_SETTINGS, ...state.settings }
}

async function runSummaryJob(
  summaryId: string,
  messages: ChatMessage[],
  instructions: string,
  store: WorkspaceStoreApi,
): Promise<void> {
  const settings = summarySettings(store)
  const client = getLLMClient(settings)
  const chunks = chunkTranscript(messages, 6000)
  const startedAt = Date.now()
  const controller = new AbortController()
  useRunStore.getState().start(summaryId, controller, store.getState().workspaceId)
  let text = ''
  try {
    /**
     * Map-reduce: each chunk is summarised on its own, then the partial
     * summaries are merged. A single oversized history therefore never has to
     * fit in one context.
     */
    const partials: string[] = []
    const guidance = instructions.trim()
      ? `\n\nFollow these instructions for the summary: ${instructions.trim()}`
      : ''
    for (const [index, chunk] of chunks.entries()) {
      const prompt =
        chunks.length === 1
          ? `Summarize the following conversation faithfully.${guidance}\n\n${renderTranscript(chunk)}`
          : `Summarize this part (${index + 1} of ${chunks.length}) of a longer conversation faithfully.${guidance}\n\n${renderTranscript(chunk)}`
      let chunkText = ''
      await client.chatCompletionStream(
        {
          model: settings.defaultModel ?? '',
          messages: [
            { role: 'system', content: settings.compactSystemPrompt },
            { role: 'user', content: prompt },
          ],
          temperature: 0.2,
          topP: 1,
          maxTokens: settings.compactMaxTokens,
          stream: settings.streaming,
        },
        {
          onChunk: (delta) => {
            chunkText += delta
            text = partials.length > 0 ? `${partials.join('\n\n')}\n\n${chunkText}` : chunkText
            store.getState().patchSummary(summaryId, { text })
          },
        },
        controller.signal,
      )
      partials.push(chunkText)
      if (chunks.length > 1) {
        store
          .getState()
          .patchSummary(summaryId, { text: partials.join('\n\n') })
        useUiStore
          .getState()
          .addAnnouncement(`Summary ${index + 1} of ${chunks.length} chunks done`)
      }
    }

    let finalText = partials.join('\n\n')
    if (partials.length > 1) {
      let merged = ''
      await client.chatCompletionStream(
        {
          model: settings.defaultModel ?? '',
          messages: [
            { role: 'system', content: settings.compactSystemPrompt },
            {
              role: 'user',
              content: `Merge these partial summaries into one faithful summary.\n\n${finalText}`,
            },
          ],
          temperature: 0.2,
          topP: 1,
          maxTokens: settings.compactMaxTokens,
          stream: settings.streaming,
        },
        {
          onChunk: (delta) => {
            merged += delta
            store.getState().patchSummary(summaryId, { text: merged })
          },
        },
        controller.signal,
      )
      finalText = merged
    }

    store.getState().patchSummary(summaryId, {
      text: finalText,
      status: 'done',
      coverageHash: coverageHash(messages),
      tokensAfter: estimateMessages([{ role: 'assistant', content: finalText }]),
      stats: {
        startedAt,
        finishedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        finishReason: 'stop',
      },
    })
  } catch (error: unknown) {
    const mapped = isAppError(error) ? error : appError('INTERNAL', 'The summary could not be generated.')
    store.getState().patchSummary(summaryId, {
      status: mapped.kind === 'ABORTED' ? 'aborted' : 'error',
      text,
      error: mapped.kind === 'ABORTED' ? undefined : mapped,
      stats: { startedAt, finishedAt: Date.now(), durationMs: Date.now() - startedAt },
    })
    if (mapped.kind !== 'ABORTED') {
      useUiStore
        .getState()
        .addToast({ tone: 'error', title: mapped.message, message: mapped.hint, sticky: true })
    }
  } finally {
    useRunStore.getState().finish(summaryId)
  }
}

/**
 * Non-destructive compaction of everything reaching a prompt: a Summary node is
 * created to its left, the original context edges are kept in the undo plan and
 * replaced by a single summary -> prompt edge.
 *
 * Returns the id of the Summary node it created, or `null` when there was nothing
 * to compact. Il ritorno serve alla finestra di anteprima, che altrimenti
 * dovrebbe cercare il nodo per indovinarlo — e potrebbe trovarne uno vecchio,
 * mostrando il riassunto di una compattazione passata come se fosse questa.
 */
export async function compactPromptContext(
  promptId: string,
  store: WorkspaceStoreApi = getActiveWorkspaceStore(),
): Promise<string | null> {
  const document = workspaceDocumentFromState(store.getState())
  const prompt = document.nodes.find((node) => node.id === promptId && node.data.kind === 'prompt')
  if (!prompt || prompt.data.kind !== 'prompt') return null
  const command = parseCompactCommand(typeof prompt.data.text === 'string' ? prompt.data.text : '')
  const assembled = assembleMessages(document, promptId)
  const messages = contextMessages(assembled.messages)
  if (messages.length === 0) {
    useUiStore
      .getState()
      .addToast({ tone: 'warning', title: 'There is no earlier conversation to compact.' })
    return null
  }
  const settings = summarySettings(store)
  const summaryId = store.getState().createSummaryNode(
    { x: Math.max(0, prompt.position.x - 390), y: prompt.position.y },
    buildSummaryData(
      messages,
      command?.instructions ?? '',
      String(settings.defaultModel ?? ''),
      settings.compactSystemPrompt,
      settings.compactMaxTokens,
      coveredResponses(messages, store),
    ),
  )
  store.getState().updateNodeData(promptId, { text: '' })

  const plan = planSummaryRelink(document, promptId, summaryId)
  for (const edgeId of plan.removedContextEdgeIds) store.getState().removeEdge(edgeId)
  store.getState().addConnection({
    source: plan.addedContextEdge.source,
    sourceHandle: plan.addedContextEdge.sourceHandle ?? 'context',
    target: plan.addedContextEdge.target,
    targetHandle: plan.addedContextEdge.targetHandle ?? 'context',
  })
  undoPlans.set(summaryId, {
    promptId,
    removedEdgeIds: plan.removedContextEdgeIds,
    summaryId,
  })
  useUiStore.getState().addToast({
    tone: 'info',
    title: 'Compaction queued',
    message: 'The original history is preserved and can be restored with Undo.',
    actionLabel: 'Restore original links',
    onAction: () => restoreSummaryLinks(summaryId, store),
  })

  await enqueueJob({
    kind: 'summary',
    workspaceId: store.getState().workspaceId,
    targetNodeId: summaryId,
    sourceNodeId: promptId,
    title: 'Compact conversation',
    execute: () => runSummaryJob(summaryId, messages, command?.instructions ?? '', store),
  })
  return summaryId
}

/**
 * "Compact up to here" from a response: compacts the context of the prompt that
 * consumes this answer, which is the same non-destructive relink.
 */
export async function compactUpTo(
  responseId: string,
  store: WorkspaceStoreApi = getActiveWorkspaceStore(),
): Promise<void> {
  const document = workspaceDocumentFromState(store.getState())
  const targetId = document.edges.find(
    (edge) => edge.kind === 'context' && edge.source === responseId,
  )?.target
  if (!targetId) {
    useUiStore.getState().addToast({
      tone: 'info',
      title: 'This answer feeds no prompt yet.',
      message: 'Connect it to a prompt, then compact from there.',
    })
    return
  }
  await compactPromptContext(targetId, store)
}

/** Re-runs a summary with the same instructions and the same source history. */
export async function regenerateSummary(
  summaryId: string,
  store: WorkspaceStoreApi = getActiveWorkspaceStore(),
): Promise<void> {
  const document = workspaceDocumentFromState(store.getState())
  const summary = document.nodes.find(
    (node) => node.id === summaryId && node.data.kind === 'summary',
  )
  if (!summary || summary.data.kind !== 'summary') return
  const plan = undoPlans.get(summaryId)
  const promptId = document.edges.find(
    (edge) => edge.kind === 'context' && edge.source === summaryId,
  )?.target
  if (!promptId) {
    useUiStore.getState().addToast({ tone: 'warning', title: 'This Summary is no longer linked to a prompt.' })
    return
  }
  // Rebuild the history from the original links so the same material is used.
  if (plan) {
    for (const edgeId of plan.removedEdgeIds) {
      if (!document.edges.some((edge) => edge.id === edgeId)) {
        void edgeId
      }
    }
  }
  restoreSummaryLinks(summaryId, store, { silent: true })
  const restored = workspaceDocumentFromState(store.getState())
  const originalEdges = plan
    ? plan.removedEdgeIds
        .map((id) => document.edges.find((edge) => edge.id === id))
        .filter((edge): edge is NonNullable<typeof edge> => Boolean(edge))
    : []
  for (const edge of originalEdges) {
    store.getState().addConnection({
      source: edge.source,
      sourceHandle: edge.sourceHandle ?? 'context',
      target: edge.target,
      targetHandle: edge.targetHandle ?? 'context',
    })
  }
  store.getState().removeNodes([summaryId])
  await compactPromptContext(promptId, store)
  void restored
}

/** True when the history behind a Summary no longer matches its coverage hash. */
export function summaryIsOutdated(
  summaryId: string,
  store: WorkspaceStoreApi = getActiveWorkspaceStore(),
): boolean {
  const document = workspaceDocumentFromState(store.getState())
  const summary = document.nodes.find(
    (node) => node.id === summaryId && node.data.kind === 'summary',
  )
  if (!summary || summary.data.kind !== 'summary' || !summary.data.coverageHash) return false
  const promptId = document.edges.find(
    (edge) => edge.kind === 'context' && edge.source === summaryId,
  )?.target
  if (!promptId) return false
  const plan = undoPlans.get(summaryId)
  if (!plan) return false
  // Re-derive the history with the original edges restored in memory.
  const probe: typeof document = {
    ...document,
    edges: [
      ...document.edges.filter((edge) => !(edge.source === summaryId && edge.target === promptId)),
      ...plan.removedEdgeIds
        .map((id) => document.edges.find((edge) => edge.id === id))
        .filter((edge): edge is NonNullable<typeof edge> => Boolean(edge)),
    ],
  }
  try {
    const messages = contextMessages(assembleMessages(probe, promptId).messages)
    if (messages.length === 0) return false
    return coverageHash(messages) !== summary.data.coverageHash
  } catch {
    return false
  }
}

/** Selects the summarised nodes so the original branch is visible again. */
export function showOriginalHistory(
  summaryId: string,
  store: WorkspaceStoreApi = getActiveWorkspaceStore(),
): void {
  const document = workspaceDocumentFromState(store.getState())
  const summary = document.nodes.find(
    (node) => node.id === summaryId && node.data.kind === 'summary',
  )
  if (!summary || summary.data.kind !== 'summary') return
  const covered = summary.data.coveredNodeIds
  for (const node of store.getState().nodes) {
    store.getState().setNodeSelected(node.id, covered.includes(node.id))
  }
  const promptId = document.edges.find(
    (edge) => edge.kind === 'context' && edge.source === summaryId,
  )?.target
  if (promptId) useUiStore.getState().setSelectedNode(promptId)
  useUiStore.getState().addAnnouncement(
    `Original history highlighted: ${covered.length} nodes`,
  )
}

export function restoreSummaryLinks(
  summaryId: string,
  store: WorkspaceStoreApi = getActiveWorkspaceStore(),
  options: { silent?: boolean } = {},
): void {
  const plan = undoPlans.get(summaryId)
  if (!plan) return
  const document = workspaceDocumentFromState(store.getState())
  for (const edge of document.edges) {
    if (edge.source === summaryId && edge.kind === 'context' && edge.target === plan.promptId) {
      store.getState().removeEdge(edge.id)
    }
  }
  for (const edgeId of plan.removedEdgeIds) {
    const edge = document.edges.find((candidate) => candidate.id === edgeId)
    if (!edge) continue
    store.getState().addConnection({
      source: edge.source,
      sourceHandle: edge.sourceHandle ?? 'context',
      target: edge.target,
      targetHandle: edge.targetHandle ?? 'context',
    })
  }
  undoPlans.delete(summaryId)
  if (!options.silent) {
    useUiStore.getState().addToast({ tone: 'success', title: 'Original context links restored.' })
  }
}
