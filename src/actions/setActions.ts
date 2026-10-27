import { getLLMClient, liveSettings } from '../llm/client'
import { collectAggregate } from '../logic/aggregation/registry'
import { formatAggregate } from '../logic/aggregation/strategies'
import { readingOrder } from '../logic/setOrder'
import { enqueueJob } from '../queue/runQueue'
import { useRunStore } from '../store/runStore'
import { useUiStore } from '../store/uiStore'
import { downloadBlob, formatBytes } from '../utils/download'
import {
  getActiveWorkspaceStore,
  type WorkspaceStoreApi,
  workspaceDocumentFromState,
} from '../store/workspaceStore'
import type { SetFormatStrategy } from '../types/document'
import { appError, isAppError } from '../types/errors'
// Le impostazioni dell'app non si prendono piu da `DEFAULT_APP_SETTINGS` ne dalla
// copia del workspace: si prendono vive, con `liveSettings()`. Vedi `llm/client.ts`.

/** Node types whose text can be aggregated. */
// Una nota e' tra i raccoglibili da quando puo' essere collegata: senza questa voce
// il menu offriva "Raggruppa" e il gruppo risultava senza la nota, cioe' con un membro
// che l'aveva perso per strada senza avvisare.
const AGGREGATABLE = new Set([
  'response',
  'set',
  'summary',
  'output',
  'image',
  'file',
  'folder',
  'note',
])
/** Kept so an explicit "use the answers of these prompts" choice is possible. */
const PROMPT_ANSWERS = new Set(['prompt'])

type Doc = ReturnType<typeof workspaceDocumentFromState>

export function classifySelection(
  document: Doc,
  selectedIds: string[],
): { members: string[]; prompts: string[]; skipped: number } {
  const members: string[] = []
  const prompts: string[] = []
  let skipped = 0
  for (const id of selectedIds) {
    const type = document.nodes.find((node) => node.id === id)?.type
    if (type && AGGREGATABLE.has(type)) members.push(id)
    else if (type && PROMPT_ANSWERS.has(type)) prompts.push(id)
    else skipped += 1
  }
  return { members, prompts, skipped }
}

function selectionBox(
  document: Doc,
  ids: string[],
): { x: number; y: number; maxX: number } {
  const nodes = ids
    .map((id) => document.nodes.find((node) => node.id === id))
    .filter((node): node is NonNullable<typeof node> => Boolean(node))
  if (nodes.length === 0) return { x: 200, y: 200, maxX: 520 }
  const minY = Math.min(...nodes.map((node) => node.position.y))
  return {
    x: Math.max(0, ...nodes.map((node) => node.position.x)),
    y: minY,
    maxX: Math.max(...nodes.map((node) => node.position.x + (node.width ?? 320))),
  }
}

/** Aggregates the members into the text an output node shows. */
export function aggregateText(
  document: Doc,
  memberIds: string[],
  format: SetFormatStrategy,
  includePromptText: boolean,
): string {
  if (memberIds.length === 0) return ''
  // Each member is collected through its own adapter, so a member can be a
  // response, another aggregate, or a prompt's answers.
  const items = memberIds.flatMap((id) => {
    const member = document.nodes.find((node) => node.id === id)
    return member ? collectAggregate(document, member, { includePromptText }) : []
  })
  return formatAggregate(format, items, includePromptText)
}

function createAggregateOutput(
  document: Doc,
  memberIds: string[],
  store: WorkspaceStoreApi,
  options: { title: string; includePromptText: boolean },
): string {
  const box = selectionBox(document, memberIds)
  const sources = readingOrder(document, memberIds)
  // Il nodo nasce gia sulla selezione: il riquadro viene poi riallineato
  // esattamente sulle risposte da computeGroupFrame, quindi la posizione qui e
  // solo un punto di partenza.
  const id = store.getState().addNode(
    'output',
    { x: box.x, y: box.y },
    {
      title: options.title,
      sourceNodeIds: sources,
      // `plain`: un gruppo di risposte alla stessa domanda avrebbe stampato lo
      // stesso titolo `###` davanti a ogni blocco.
      format: 'plain',
      includePromptText: options.includePromptText,
    },
  )
  store
    .getState()
    .patchOutput(id, { text: aggregateText(document, sources, 'plain', options.includePromptText) })
  return id
}

/**
 * Groups a selection of answers into **one** output node placed on the selection,
 * ready to be plugged into another node. No intermediate node is created: the
 * group is the frame drawn around the members, and dragging that frame moves
 * everything inside it.
 */
export function createSetFromSelection(
  selectedIds: string[],
  store: WorkspaceStoreApi = getActiveWorkspaceStore(),
): string | null {
  const document = workspaceDocumentFromState(store.getState())
  const { members, skipped } = classifySelection(document, selectedIds)
  if (skipped > 0) {
    useUiStore
      .getState()
      .addToast({
        tone: 'info',
        title: `${skipped} node${skipped === 1 ? '' : 's'} skipped`,
        message: 'Only answers can be grouped.',
      })
  }
  if (members.length < 1) {
    useUiStore.getState().addToast({
      tone: 'info',
      title: 'Select one or more answer nodes.',
      message: 'Grouping combines generated text.',
    })
    return null
  }
  const id = createAggregateOutput(document, members, store, {
    title: `Output of ${members.length} answers`,
    includePromptText: true,
  })
  useUiStore
    .getState()
    .addToast({ tone: 'success', title: 'Answers grouped', message: 'One output is ready to connect.' })
  return id
}

/** Explicit alternative: group the answers of a few prompts. */
export function createSetFromPromptAnswers(
  promptIds: string[],
  store: WorkspaceStoreApi = getActiveWorkspaceStore(),
): string | null {
  const document = workspaceDocumentFromState(store.getState())
  const members: string[] = []
  for (const id of promptIds) {
    const prompt = document.nodes.find((node) => node.id === id)
    if (!prompt || prompt.type !== 'prompt') continue
    const children = document.edges
      .filter((edge) => edge.kind === 'run' && edge.source === id)
      .map((edge) => document.nodes.find((node) => node.id === edge.target))
      .filter(
        (node): node is NonNullable<typeof node> =>
          Boolean(node) && node!.data.kind === 'response' && node!.data.status === 'done',
      )
    members.push(...children.map((child) => child.id))
  }
  if (members.length === 0) {
    useUiStore.getState().addToast({
      tone: 'warning',
      title: 'Those prompts have no finished answers yet.',
      message: 'Run them first, or select the answer nodes directly.',
    })
    return null
  }
  const id = createAggregateOutput(document, members, store, {
    title: `Output of ${members.length} answers`,
    includePromptText: true,
  })
  useUiStore.getState().addToast({ tone: 'success', title: 'Answers grouped' })
  return id
}

/** Re-computes the text of every output that aggregates a set of answers. */
export function refreshOutputs(store: WorkspaceStoreApi = getActiveWorkspaceStore()): void {
  const state = store.getState()
  const document = workspaceDocumentFromState(state)
  for (const output of state.nodes.filter((node) => node.type === 'output')) {
    // An output that owns a group always recomputes from its members.
    if (output.data.kind === 'output' && output.data.sourceNodeIds?.length) {
      try {
        const text =
          output.data.synthesis?.status === 'done' && output.data.format === 'llm-synthesis'
            ? output.data.synthesis.text
            : aggregateText(
                document,
                output.data.sourceNodeIds,
                output.data.format ?? 'sections',
                output.data.includePromptText ?? true,
              )
        store.getState().patchOutput(output.id, { text })
      } catch {
        store.getState().patchOutput(output.id, { text: '' })
      }
      continue
    }
    const edge = document.edges
      .filter((candidate) => candidate.kind === 'display' && candidate.target === output.id)
      .sort((a, b) => a.createdAt - b.createdAt)[0]
    if (!edge) continue
    const source = document.nodes.find((node) => node.id === edge.source)
    if (!source) continue
    try {
      const items = collectAggregate(document, source)
      const format = source.data.kind === 'set' ? source.data.format : 'sections'
      const includePromptText = source.data.kind === 'set' ? source.data.includePromptText : true
      const text =
        source.data.kind === 'set' && source.data.synthesis?.status === 'done'
          ? source.data.synthesis.text
          : formatAggregate(format, items, includePromptText)
      store.getState().patchOutput(output.id, { text })
    } catch (error: unknown) {
      if (isAppError(error)) store.getState().patchOutput(output.id, { text: '' })
    }
  }
}

/** Re-asks the model for a single narrative answer over the grouped text. */
export async function synthesizeOutput(
  outputId: string,
  store: WorkspaceStoreApi = getActiveWorkspaceStore(),
): Promise<void> {
  const state = store.getState()
  const output = state.nodes.find((node) => node.id === outputId)
  if (!output || output.data.kind !== 'output') return
  const content = output.data.text
  if (!content.trim()) {
    useUiStore.getState().addToast({ tone: 'warning', title: 'There is nothing to synthesize yet.' })
    return
  }
  store.getState().patchOutput(outputId, { format: 'llm-synthesis' })
  await enqueueJob({
    kind: 'set-synthesis',
    workspaceId: store.getState().workspaceId,
    targetNodeId: outputId,
    sourceNodeId: outputId,
    title: output.data.title || 'Synthesize answers',
    execute: async () => {
      const settings = liveSettings()
      const client = getLLMClient(settings)
      let text = ''
      const startedAt = Date.now()
      const controller = new AbortController()
      useRunStore.getState().start(`synthesis-${outputId}`, controller, store.getState().workspaceId)
      const patch = (next: Partial<NonNullable<typeof output.data.synthesis>>): void => {
        const current = store.getState().nodes.find((node) => node.id === outputId)
        const previous = current?.data.kind === 'output' ? current.data.synthesis : undefined
        store.getState().patchOutput(outputId, {
          synthesis: {
            text,
            status: 'streaming',
            ...(previous?.stats ? { stats: previous.stats } : {}),
            ...next,
          },
        })
      }
      try {
        const result = await client.chatCompletionStream(
          {
            model: settings.defaultModel ?? '',
            messages: [
              {
                role: 'system',
                content:
                  'Synthesize the following results into one coherent answer. Keep important facts and disagreements.',
              },
              { role: 'user', content },
            ],
            temperature: 0.3,
            topP: 1,
            maxTokens: settings.defaults.maxTokens,
            stream: settings.streaming,
          },
          {
            onChunk: (delta) => {
              text += delta
              patch({})
            },
          },
          controller.signal,
        )
        patch({
          text,
          status: 'done',
          stats: {
            startedAt,
            finishedAt: Date.now(),
            durationMs: Date.now() - startedAt,
            finishReason: result.finishReason,
          },
        })
      } catch (error: unknown) {
        const mapped = isAppError(error) ? error : appError('INTERNAL', 'Synthesis failed.')
        patch({
          text,
          status: mapped.kind === 'ABORTED' ? 'aborted' : 'error',
          ...(mapped.kind === 'ABORTED' ? {} : { error: mapped }),
        })
        if (mapped.kind !== 'ABORTED') {
          useUiStore.getState().addToast({ tone: 'error', title: mapped.message, message: mapped.hint })
        }
      } finally {
        useRunStore.getState().finish(`synthesis-${outputId}`)
      }
    },
  })
}
/** Adds more answers to an existing grouped output. */
export function addSelectionToSet(
  outputId: string,
  selectedIds: string[],
  store: WorkspaceStoreApi = getActiveWorkspaceStore(),
): void {
  const document = workspaceDocumentFromState(store.getState())
  const output = document.nodes.find((node) => node.id === outputId)
  if (!output || output.data.kind !== 'output') return
  const additions = readingOrder(
    document,
    selectedIds.filter((id) => {
      const type = document.nodes.find((node) => node.id === id)?.type
      return Boolean(type && AGGREGATABLE.has(type))
    }),
  )
  if (additions.length === 0) {
    useUiStore.getState().addToast({ tone: 'info', title: 'Only answers can be added.' })
    return
  }
  const sources = readingOrder(document, [
    ...new Set([...(output.data.sourceNodeIds ?? []), ...additions]),
  ])
  store.getState().patchOutput(outputId, { sourceNodeIds: sources })
  refreshOutputs(store)
  useUiStore
    .getState()
    .addToast({ tone: 'success', title: `${additions.length} answers added.` })
}

/** Detaches the selected answers from every grouped output. */
export function removeSelectionFromSets(
  selectedIds: string[],
  store: WorkspaceStoreApi = getActiveWorkspaceStore(),
): void {
  const document = workspaceDocumentFromState(store.getState())
  const selected = new Set(selectedIds)
  let touched = 0
  for (const node of document.nodes) {
    if (node.data.kind !== 'output' || !node.data.sourceNodeIds) continue
    const next = node.data.sourceNodeIds.filter((id) => !selected.has(id))
    if (next.length === node.data.sourceNodeIds.length) continue
    store.getState().patchOutput(node.id, { sourceNodeIds: next })
    touched += 1
  }
  refreshOutputs(store)
  useUiStore
    .getState()
    .addToast({
      tone: 'info',
      title: touched > 0 ? `Removed from ${touched} group${touched === 1 ? '' : 's'}.` : 'Those answers were not grouped.',
    })
}

/** Downloads the aggregated content of an output node as Markdown. */
export function exportOutputMarkdown(outputId: string, fallbackText: string): void {
  const store = getActiveWorkspaceStore()
  const document = workspaceDocumentFromState(store.getState())
  const output = document.nodes.find((node) => node.id === outputId)
  const title =
    (output && 'title' in output.data && typeof output.data.title === 'string' && output.data.title) ||
    'Output'
  const text =
    output && 'text' in output.data ? String(output.data.text ?? fallbackText) : fallbackText
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'output'
  const result = downloadBlob(text, `${slug}.md`, 'text/markdown;charset=utf-8')
  const ui = useUiStore.getState()
  if (result.ok) {
    ui.addToast({ tone: 'success', title: `Exported ${slug}.md`, message: formatBytes(result.bytes) })
  } else {
    ui.addToast({ tone: 'error', title: 'Export failed.', message: result.error, sticky: true })
  }
}