import { getLLMClient, liveSettings } from '../llm/client'
import { ensureLoaded } from './modelManager'
import type { ChatMessage, Usage } from '../llm/types'
import { assembleMessages } from '../logic/assemble'
import { buildChatRequest, resolveParams, systemPromptFromMessages } from '../logic/params'
import { providerSpec } from '../logic/providers'
import { validateRunDetailed } from '../logic/validate'
import { contextResponsesForPrompt } from '../logic/graph'
import { parseCompactCommand } from '../logic/compact'
import { compactPromptContext } from './compactContext'
import { knowledgeEntries, knowledgeHubs } from '../store/knowledgeStore'
import { refreshOutputs } from './setActions'
import { enqueueJob } from '../queue/runQueue'
import { useRunStore } from '../store/runStore'
import { makeUsageRecord, useUsageStore } from '../store/usageStore'
import { log } from '../logging/logger'
import { useUiStore } from '../store/uiStore'
import {
  getActiveWorkspaceStore,
  type WorkspaceStoreApi,
  workspaceDocumentFromState,
} from '../store/workspaceStore'
import type {
  RequestSnapshot,
  ResponseNodeData,
  ResponseStats,
  WorkspaceDocument,
} from '../types/document'
import { makeConcise } from '../logic/concise'
import { appError, isAppError, type AppError } from '../types/errors'
import type { RequiredGenerationParams } from '../logic/params-types'

interface ExecuteOptions {
  store: WorkspaceStoreApi
  responseId: string
  model: string
  messages: ChatMessage[]
  params: RequiredGenerationParams
  /** false sends reasoning_effort: 'none' so the model answers directly. */
  thinking: boolean
}

const flushTimers = new Map<string, number>()

function usageStats(usage: Usage | undefined): Partial<ResponseStats> {
  if (!usage) return {}
  return {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
  }
}

export async function executeResponse({
  store,
  responseId,
  model,
  messages,
  params,
  thinking,
}: ExecuteOptions): Promise<void> {
  const workspace = store.getState()
  const response = workspace.nodes.find(
    (node) => node.id === responseId && node.data.kind === 'response',
  )
  if (!response || response.data.kind !== 'response') return

  const controller = new AbortController()
  useRunStore.getState().start(responseId, controller, workspace.workspaceId)
  const startedAt = performance.now()
  const initialStats = { ...response.data.stats, startedAt: Date.now() }
  let buffer = ''
  let reasoning = ''
  let firstTokenMs: number | undefined
  let usage: Usage | undefined
  let lastFlush = 0
  let timer: number | undefined

  const clearTimer = (): void => {
    if (timer !== undefined) {
      globalThis.clearTimeout(timer)
      timer = undefined
    }
    flushTimers.delete(responseId)
  }

  const flush = (): void => {
    clearTimer()
    lastFlush = performance.now()
    store.getState().patchResponse(responseId, { text: buffer, reasoning })
  }

  const scheduleFlush = (): void => {
    const elapsed = performance.now() - lastFlush
    if (elapsed >= 60) {
      flush()
      return
    }
    if (timer !== undefined) return
    timer = globalThis.setTimeout(flush, 60 - elapsed)
    flushTimers.set(responseId, timer)
  }

  try {
    // Impostazioni vive: la parte dell'app dallo store UI, quella del workspace dal
    // suo store. Leggere la copia del workspace faceva partire la richiesta verso
    // un provider diverso da quello scelto nella barra.
    const settings = liveSettings()
    const client = getLLMClient(settings)
    const activeModel = useUiStore.getState().appSettings.defaultModel
    if (activeModel) {
      await ensureLoaded(activeModel)
    }
    const request = buildChatRequest(
      model,
      messages,
      params,
      settings.streaming,
      thinking,
      settings.provider,
    )
    /*
     * Se il provider ha ridotto la temperatura, lo si dice **prima** che l'utente legga
     * la risposta. Una richiesta partita con 1.4 e risposta come se fosse 1.0 sembra un
     * modello strano; detta qui diventa quello che e' un limite noto del provider.
     */
    const spec = providerSpec(settings.provider)
    if (spec.maxTemperature !== undefined && params.temperature > spec.maxTemperature) {
      useUiStore.getState().addToast({
        tone: 'warning',
        title: `Temperature reduced to ${spec.maxTemperature}.`,
        message: `${spec.label} accepts a temperature from 0 to ${spec.maxTemperature}.`,
      })
    }
    /**
     * A reasoning model can emit many tokens of thinking before the first
     * visible character, so the streaming state must start on whichever
     * signal arrives first.
     */
    const markStreaming = (): void => {
      if (firstTokenMs !== undefined) return
      firstTokenMs = performance.now() - startedAt
      const current = store
        .getState()
        .nodes.find((node) => node.id === responseId)
      store.getState().patchResponse(responseId, {
        status: 'streaming',
        stats: {
          ...(current?.data.kind === 'response' ? current.data.stats : {}),
          startedAt: initialStats.startedAt,
          firstTokenMs,
        },
      })
    }
    const result = await client.chatCompletionStream(
      request,
      {
        onChunk: (delta) => {
          markStreaming()
          buffer += delta
          scheduleFlush()
        },
        onReasoning: (delta) => {
          markStreaming()
          reasoning += delta
          scheduleFlush()
        },
        onUsage: (value) => {
          usage = value
        },
      },
      controller.signal,
    )
    flush()
    const finishedAt = Date.now()
    /*
     * Il consumo si registra qui, e solo qui.
     *
     * `usage` arriva dal provider ed e' l'unico numero misurato: la stima
     * `length/4` va bene per avvisare prima di partire e non sopporta un peso in una
     * schermata di spese. Il record resta con `tokensKnown: false` quando il provider
     * non manda nulla, cosi' un totale senza questi record si sa che e' parziale
     * invece di sembrare piu' basso di quanto sia.
     *
     * Non viene registrato il fallimento: un 401 non ha consumato token e lo
     * conteggiare come una corsa da zero gonfierebbe il numero di richieste senza
     * che nessun token sia passato.
     */
    useUsageStore
      .getState()
      .add(
        makeUsageRecord({
          provider: settings.provider,
          model: response.data.requestSnapshot.model,
          ...(usage
            ? { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens }
            : {}),
        }),
      )
    // A reasoning model can spend its whole budget on thinking and return no
    // visible answer. Report that on the node instead of storing an empty one.
    const emptyAnswer = buffer.trim().length === 0
    const emptyAnswerError = emptyAnswer
      ? appError(
          'BAD_RESPONSE',
          reasoning.trim()
            ? 'The model used its whole output budget for reasoning and returned no answer.'
            : 'The model returned an empty answer.',
          {
            hint: 'Increase Max output tokens for this run, or pick a model that answers directly.',
          },
        )
      : undefined
    if (emptyAnswerError) {
      useUiStore.getState().addToast({
        tone: 'warning',
        title: emptyAnswerError.message,
        ...(emptyAnswerError.hint ? { message: emptyAnswerError.hint } : {}),
        sticky: true,
      })
    }
    store.getState().patchResponse(responseId, {
      status: emptyAnswerError ? 'error' : 'done',
      error: emptyAnswerError,
      stats: {
        ...initialStats,
        ...(firstTokenMs !== undefined ? { firstTokenMs } : {}),
        finishedAt,
        durationMs: performance.now() - startedAt,
        ...usageStats(usage),
        finishReason: result.finishReason,
      },
    })
  } catch (error: unknown) {
    flush()
    clearTimer()
    const appErr: AppError = isAppError(error)
      ? error
      : appError('INTERNAL', 'The response could not be completed.', {
          raw: error instanceof Error ? error.message : String(error),
        })
    const aborted = appErr.kind === 'ABORTED'
    if (!aborted) {
      /*
       * L'errore di una corsa e la cosa che l'utente vede e quella che vuole
       * capire. Il toast sparisce, il nodo mostra una riga: il registro e l'unico
       * posto dove restano il provider, lo stato e quello che ha risposto.
       */
      log.error('llm', `Corsa fallita: ${appErr.message}`, {
        risposta: responseId,
        provider: useUiStore.getState().appSettings.provider,
        tipo: appErr.kind,
        stato: appErr.status,
        suggerimento: appErr.hint,
        grezzo: appErr.raw,
        testoParziale: buffer ? `${buffer.length} caratteri` : undefined,
      })
    }
    store.getState().patchResponse(responseId, {
      status: aborted ? 'aborted' : 'error',
      text: buffer,
      error: aborted ? undefined : appErr,
      stats: {
        ...initialStats,
        ...(firstTokenMs !== undefined ? { firstTokenMs } : {}),
        finishedAt: Date.now(),
        durationMs: performance.now() - startedAt,
        ...usageStats(usage),
      },
    })
    if (!aborted) {
      useUiStore.getState().addToast({
        tone: 'error',
        title: appErr.message,
        ...(appErr.hint ? { message: appErr.hint } : {}),
        sticky: true,
      })
    }
  } finally {
    clearTimer()
    // A Set may have gained this response, so any Output fed by it must refresh.
    refreshOutputs(store)
    useRunStore.getState().finish(responseId)
  }
}

function snapshotFor(
  model: string,
  params: RequiredGenerationParams,
  messages: ChatMessage[],
): RequestSnapshot {
  return {
    model,
    params,
    systemPrompt: systemPromptFromMessages(messages),
    messageCount: messages.length,
    estPromptTokens: 0,
  }
}

export async function runPrompt(
  promptId: string,
  store: WorkspaceStoreApi = getActiveWorkspaceStore(),
): Promise<void> {
  const workspace = store.getState()
  const document = workspaceDocumentFromState(workspace)
  const prompt = document.nodes.find(
    (node) => node.id === promptId && node.data.kind === 'prompt',
  )
  if (prompt && parseCompactCommand(typeof prompt.data.text === 'string' ? prompt.data.text : '')) {
    await compactPromptContext(promptId, store)
    return
  }
/*
   * Nessuna conoscenza passa di qui, e questa e' una scelta.
   *
   * Fino a poco fa questa funzione faceva il recupero automatico e mandava il blocco con
   * **qualsiasi** prompt, anche a una domanda che dell'archivio non sapeva niente. Il blocco
   * contiene le istruzioni al modello, e le istruzioni costano piu' delle note: si pagava un
   * canale aperto senza averlo chiesto, a ogni richiesta, per una domanda che forse non ne
   * aveva bisogno. Il numero in alto saliva e la causa era invisibile, perche' niente nella
   * schermata diceva «ti ho aggiunto delle note che non hai chiesto».
   *
   * Ora il recupero e' una **scelta** e vive nei nodi Knowledge (vedi il ramo `auto` in
   * `assemble.ts`), perche' e' l'unico posto in cui la domanda e' disponibile. Un prompt senza
   * quel nodo non costa nulla, e un prompt con il nodo costa quello che hai chiesto tu.
   *
   * Restano qui sotto i due parametri che servono ai nodi, e non per il recupero: l'archivio
   * intero, perche' i nodi lo risolvano da soli, e i parametri sono arrivati fin qui perche' il
   * conteggio dei token esce da questo punto. Aggiungere la conoscenza dopo direbbe che la
   * richiesta e' piu' piccola di quanto e', e quella e' proprio la cifra che serve all'utente
   * per capire quanto sta costando.
   */
  const validation = validateRunDetailed(document, promptId, {
    allowPendingContext: true,
    // Il modello scelto vive nelle impostazioni dell'app, non nel documento.
    model: useUiStore.getState().appSettings.defaultModel,
    // E il provider, per la stessa ragione: altrimenti la validazione decideva con
    // la copia del documento e poteva rifiutare la corsa a nome di LM Studio mentre
    // l'utente aveva un provider cloud selezionato.
    provider: useUiStore.getState().appSettings.provider,
    /*
     * L'archivio intero, per i nodi che lo **puntano**.
     *
     * Nessun testo preparato: i nodi risolvono le note da soli e restituiscono quello che
     * mandano, quindi qui basta passare i dati. Il parametro arriva in questo punto e non
     * piu' avanti perche' il conteggio dei token esce da qui: aggiungere la conoscenza dopo
     * direbbe che la richiesta e' piu' piccola di quanto e', ed e' proprio la cifra che
     * serve all'utente per capire quanto sta costando.
     */
    knowledgeEntries: knowledgeEntries(),
    knowledgeHubs: knowledgeHubs(),
  })
  const params = prompt?.data.kind === 'prompt'
    ? resolveParams(prompt.data.params, document.settings)
    : {
        temperature: document.settings.defaults.temperature,
        topP: document.settings.defaults.topP,
        maxTokens: document.settings.defaults.maxTokens,
        stop: null,
      }
  /*
   * Il modello viene dalle impostazioni **vive**, non dal documento.
   *
   * Il documento ne ha una copia che si aggiorna solo al salvataggio, e tra una
   * scelta e l'altra resta indietro. Con un provider cloud e un catalogo nuovo,
   * questo mandava a un servizio un id di modello dell'altro provider: la
   * richiesta partiva, il provider rispondeva 404 su un modello che non ha, e la
   * colpa apparentemente era dell'app.
   */
  const model = useUiStore.getState().appSettings.defaultModel?.trim() ?? ''
  const messages = validation.assembled?.messages ?? []
  const responseId = store
    .getState()
    .createResponseNode(promptId, snapshotFor(model, params, messages))
  if (!responseId) return

  if (validation.error) {
    useUiStore.getState().setPromptError(promptId, validation.error)
    log.warn('llm', `Corsa rifiutata prima di partire: ${validation.error.message}`, {
      prompt: promptId,
      tipo: validation.error.kind,
      suggerimento: validation.error.hint,
    })
    store.getState().patchResponse(responseId, {
      status: 'error',
      error: validation.error,
      stats: {
        startedAt: Date.now(),
        finishedAt: Date.now(),
      },
    })
    useUiStore.getState().addToast({
      tone: 'error',
      title: validation.error.message,
      ...(validation.error.hint ? { message: validation.error.hint } : {}),
      sticky: true,
    })
    return
  }

  useUiStore.getState().setPromptError(promptId, null)
  useUiStore.getState().setLastRequestTokens(validation.assembled?.estTokens ?? 0)
  store.getState().patchResponse(responseId, {
    requestSnapshot: {
      ...snapshotFor(model, params, messages),
      estPromptTokens: validation.assembled?.estTokens ?? 0,
    },
    messagesSnapshot: messages,
    /*
     * La traccia: **quali note sono arrivate al modello** in questa risposta.
     *
     * Va qui, e non si ricava dopo dal blocco di testo, perche' dal testo si ricaverebbe
     * solo «c'era un blocco di conoscenza» — e quella informazione la dava gia' il nodo
     * prima di partire, quindi non aggiungerebbe niente a quello che il dubbio non e' gia'
     * stato. Qui invece c'e' l'elenco: il titolo di ogni nota e il punto di contesto in cui
     * sta, accanto alla risposta che e' uscita.
     *
     * E' l'unica prova onesta che si puo' dare. Se il modello ha usato le note si vede
     * dalla risposta — l'avviso nel blocco gli chiede di nominarle — ma nessun programma
     * puo' accorgersi se lo ha fatto o no. Qui si registra solo il fatto, che e' gia' tutto:
     * le note erano li', e da quel momento la responsabilita' e' di chi legge.
     */
    knowledgeUsed: validation.assembled?.knowledgeUsed ?? { entries: [] },
  })
  if (validation.softWarnings.length > 0) {
    const warning = validation.softWarnings[0]
    if (warning) {
      useUiStore.getState().addToast({
        tone: 'warning',
        title: warning.message,
        ...(warning.hint ? { message: warning.hint } : {}),
      })
    }
  }
  const dependsOn = contextResponsesForPrompt(document, promptId).map((response) => response.id)
  // I-4: the text sent is the one present when Run was pressed. Everything else
  // is assembled when the job actually starts, so finished dependencies count.
  const promptTextSnapshot =
    prompt?.data.kind === 'prompt' && typeof prompt.data.text === 'string'
      ? prompt.data.text
      : ''
  // Thinking is per-prompt, defaulting to on.
  const thinking = prompt?.data.kind === 'prompt' ? prompt.data.thinking !== false : true
  // Short answer is per-prompt and off by default.
  const concise = prompt?.data.kind === 'prompt' ? prompt.data.concise === true : false
  try {
    await enqueueJob({
      kind: 'prompt',
      workspaceId: workspace.workspaceId,
      targetNodeId: responseId,
      sourceNodeId: promptId,
      title: promptTextSnapshot.trim().split('\n')[0] || 'Untitled prompt',
      dependsOn,
      promptTextSnapshot,
      execute: () => {
        const fresh = documentWithPromptSnapshot(
          workspaceDocumentFromState(store.getState()),
          promptId,
          promptTextSnapshot,
        )
        const freshValidation = validateRunDetailed(fresh, promptId, {
      model: useUiStore.getState().appSettings.defaultModel,
      provider: useUiStore.getState().appSettings.provider,
    })
        const assembled = freshValidation.assembled?.messages ?? []
        // Short answer: a brevity instruction plus a lower ceiling, for this
        // prompt only. Applied here and not in assemble, so the snapshot records
        // what was really sent and "Retry same request" reproduces it.
        const request = concise
          ? makeConcise(assembled, params)
          : { messages: assembled, params }
        const freshMessages = request.messages
        const freshParams = request.params
        store.getState().patchResponse(responseId, {
          promptSnapshot: promptTextSnapshot,
          requestSnapshot: {
            ...snapshotFor(model, freshParams, freshMessages),
            estPromptTokens: freshValidation.assembled?.estTokens ?? 0,
          },
          messagesSnapshot: freshMessages,
        })
        useUiStore
          .getState()
          .setLastRequestTokens(freshValidation.assembled?.estTokens ?? 0)
        if (freshValidation.error) throw freshValidation.error
        return executeResponse({
          store,
          responseId,
          model,
          messages: freshMessages,
          params: freshParams,
          thinking,
        })
      },
    })
  } catch {
    // executeResponse already presented the actionable error on the node.
  }
}

/**
 * Builds the document a queued job must run against: the target prompt carries
 * the text captured when Run was pressed (I-4), while the rest of the graph is
 * read fresh so finished dependencies are included.
 */
export function documentWithPromptSnapshot(
  document: WorkspaceDocument,
  promptId: string,
  promptTextSnapshot: string,
): WorkspaceDocument {
  if (!document.nodes.some((node) => node.id === promptId)) return document
  const nodes = document.nodes.map((node) =>
    node.id === promptId && node.data.kind === 'prompt'
      ? ({ ...node, data: { ...node.data, text: promptTextSnapshot } } as typeof node)
      : node,
  )
  return { ...document, nodes }
}

function retryDocument(
  document: WorkspaceDocument,
  responseId: string,
): WorkspaceDocument | null {
  const response = document.nodes.find(
    (node) => node.id === responseId && node.data.kind === 'response',
  )
  if (!response || response.data.kind !== 'response') return null
  const parent = document.nodes.find(
    (node) => node.id === response.data.parentPromptId && node.data.kind === 'prompt',
  )
  if (!parent) return null

  const nodes = document.nodes.map((node) => {
    if (node.id === parent.id) {
      return {
        ...node,
        data: { ...node.data, text: response.data.promptSnapshot },
      } as typeof node
    }
    return node
  })
  return {
    ...document,
    nodes,
    edges: document.edges.filter((edge) => edge.kind !== 'system'),
    settings: {
      ...document.settings,
      defaults: {
        ...document.settings.defaults,
        systemPrompt: response.data.requestSnapshot.systemPrompt,
      },
    },
  }
}

export async function retryResponse(
  responseId: string,
  store: WorkspaceStoreApi = getActiveWorkspaceStore(),
): Promise<void> {
  if (useRunStore.getState().runs[responseId]) return
  const document = workspaceDocumentFromState(store.getState())
  const response = document.nodes.find(
    (node) => node.id === responseId && node.data.kind === 'response',
  )
  if (!response || response.data.kind !== 'response') return

  const retryGraph = retryDocument(document, responseId)
  if (!retryGraph) {
    const error = appError('BAD_RESPONSE', 'The original prompt is no longer available.')
    store.getState().patchResponse(responseId, { status: 'error', error })
    return
  }

  const fallbackMessages = assembleMessages(retryGraph, response.data.parentPromptId).messages
  const messages = response.data.messagesSnapshot ?? fallbackMessages
  const requestSnapshot = response.data.requestSnapshot as RequestSnapshot
  const parentPrompt = document.nodes.find(
    (node) => node.id === response.data.parentPromptId && node.data.kind === 'prompt',
  )
  const thinking = parentPrompt?.data.kind === 'prompt' ? parentPrompt.data.thinking !== false : true
  // A retry repeats the request that was recorded, brevity instruction included:
  // the snapshot already carries it, so re-applying it would say it twice.
  store.getState().patchResponse(responseId, {
    status: 'queued',
    text: '',
    error: undefined,
    stats: { startedAt: Date.now() },
  })
  await enqueueJob({
    kind: 'retry',
    workspaceId: store.getState().workspaceId,
    targetNodeId: responseId,
    sourceNodeId: response.data.parentPromptId,
    title: 'Retry response',
    execute: () => executeResponse({
      store,
      responseId,
      model: requestSnapshot.model,
      messages,
      params: requestSnapshot.params as RequiredGenerationParams,
      thinking,
    }),
  })
}

export function responseValidationError(response: ResponseNodeData | undefined): AppError | null {
  return response?.status === 'error' ? response.error ?? null : null
}
