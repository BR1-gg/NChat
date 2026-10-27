import { getLLMClient } from '../llm/client'
import { prepareProvider } from '../llm/cloudProxy'
import { isCloudProvider } from '../logic/providers'
import { mapLlmError } from '../llm/openai'
import { useModelStore } from '../store/modelStore'
import { useRunStore } from '../store/runStore'
import { useUiStore } from '../store/uiStore'
import { appError, isAppError } from '../types/errors'
import type { AppSettings } from '../types/settings'

const inFlight = new Map<string, Promise<void>>()
let typingTimer: number | undefined
let lastPreloadedModel: string | null = null

function currentSettings(): AppSettings {
  return useUiStore.getState().appSettings
}

function clientSettings() {
  return {
    ...currentSettings(),
    defaults: { temperature: 0.7, topP: 1, maxTokens: 1024, systemPrompt: '' },
    contextTokenWarning: 4096,
  }
}

/**
 * The model list, for whichever provider is selected.
 *
 * For a cloud provider this is the step that makes the whole thing work, and it
 * was missing: the key was typed into a field and nothing ever handed it to the
 * local service, so the list came back empty and every run refused. So before
 * asking the provider anything, the key is registered and the answer is checked.
 *
 * When it is not ready, the list is emptied and the reason is published, because
 * a list that still shows the old provider's models is worse than an empty one:
 * the user would pick a model the provider has never heard of. The reason is
 * published rather than thrown because the top bar has to show it, and a thrown
 * error there has nowhere to live.
 */
export async function refreshAvailableModels(signal?: AbortSignal) {
  const settings = clientSettings()
  if (isCloudProvider(settings.provider)) {
    const readiness = await prepareProvider(settings)
    if (!readiness.ready) {
      useModelStore.getState().setModels([])
      useUiStore.getState().setProviderBlock(readiness)
      return []
    }
    useUiStore.getState().setProviderBlock(null)
  }
  const client = getLLMClient(settings)
  const models = await client.listAvailableModels(signal)
  useModelStore.getState().setModels(models)
  return models
}

/**
 * LM Studio can only initialise one model at a time: two overlapping load
 * requests make both stall part-way. Every load therefore goes through this
 * chain, so a second model waits for the first to finish.
 */
let loadChain: Promise<unknown> = Promise.resolve()

function enqueueExclusive<T>(task: () => Promise<T>): Promise<T> {
  const result = loadChain.then(task, task)
  loadChain = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

export async function ensureLoaded(id: string): Promise<void> {
  /*
   * In cloud non c'e niente da caricare, quindi qui si esce subito.
   *
   * «Caricare un modello» e un concetto di LM Studio: il peso sta in memoria della
   * macchina e le richieste competono per la GPU. Su NVIDIA o Google il modello e
   * gia in piedi da qualche parte e l'unica cosa che lo rende raggiungibile e la
   * chiave.
   *
   * Senza questa guardia, per ogni richiesta succedevano **tre** cose inutili, e una
   * di queste costa:
   *
   * 1. un giro di rete per rileggere la lista dei modelli dal provider;
   * 2. `loadModel`, che su un livello non nativo finisce col mandare una **richiesta
   *    vera** di completamento (`max_tokens: 1`, «Ready.») per controllare se il
   *    modello e pronto. Su un provider a pagamento e una richiesta fatturata, e
   *    fatta una volta per ogni prompt dell'utente, piu una volta per ogni modello
   *    che digita;
   * 3. uno stato «Loading model» in barra, per un modello che era gia pronto: era
   *    quello che l'utente leggeva come un'attesa.
   *
   * Il modello viene marcato come pronto perche, per il client, lo e: e servito da
   * qualcun altro, e la sua unica premessa e la chiave, che viene consegnata al
   * servizio locale prima. Se qualcosa non va, lo dice la richiesta vera, con
   * l'errore vero — che e molto meglio di un timeout su una prova di prontitudine.
   */
  if (isCloudProvider(currentSettings().provider)) {
    useModelStore.getState().setRuntime(id, { state: 'loaded', error: undefined })
    return
  }
  const existing = inFlight.get(id)
  if (existing) return existing
  const promise = enqueueExclusive(async (): Promise<void> => {
    const modelStore = useModelStore.getState()
    const settings = currentSettings()
    const client = getLLMClient(clientSettings())

    // Always confirm against the live server. LM Studio never answers a load
    // request for a model that is already resident, so a stale "not-loaded"
    // cache would hang the queue forever.
    const cached = modelStore.models.find((model) => model.id === id)
    if (cached?.state === 'loaded') {
      modelStore.setRuntime(id, { state: 'loaded', error: undefined })
      return
    }
    try {
      const live = await client.listAvailableModels()
      useModelStore.getState().setModels(live)
      const liveModel = live.find((model) => model.id === id)
      if (!liveModel) {
        throw appError('MODEL_NOT_LOADED', 'That model is not on the server any more.', {
          hint: 'Reload the model list in the top bar, then pick it again.',
        })
      }
      if (liveModel.state === 'loaded') {
        useModelStore.getState().setRuntime(id, { state: 'loaded', error: undefined })
        return
      }
    } catch (error: unknown) {
      if (isAppError(error) && error.kind === 'MODEL_NOT_LOADED') throw error
      // A failed probe must not block loading, so fall through.
    }

    modelStore.setRuntime(id, { state: 'loading', loadStartedAt: Date.now(), error: undefined })
    useUiStore.getState().setConnection('loading-model', undefined, undefined, null)
    useUiStore.getState().addAnnouncement('Loading model')
    try {
      await client.loadModel(id, undefined, settings.modelLoadTimeoutMs)
      await refreshAvailableModels()
      useModelStore.getState().setRuntime(id, { state: 'loaded', error: undefined })
      useUiStore.getState().setConnection('connected', undefined, undefined, null)
      useUiStore.getState().addAnnouncement('Model loaded')
    } catch (error: unknown) {
      const mapped = mapLlmError(error, clientSettings())
      // The server wording is more specific than the mapped message, so check
      // the raw text too before falling back to a generic message.
      const rawText = [
        mapped.message,
        mapped.hint ?? '',
        mapped.raw ?? '',
        isAppError(error) ? error.raw ?? '' : error instanceof Error ? error.message : String(error),
      ].join(' ')
      const memoryError = /not enough memory|insufficient memory|out of memory|\bOOM\b|too much memory|quantization|gguf.*too large/i.test(
        rawText,
      )
      useModelStore.getState().setRuntime(id, {
        state: 'error',
        error: memoryError
          ? appError('MODEL_NOT_LOADED', 'Not enough memory for this model.', {
              hint: 'Pick a smaller quantization or close other apps.',
            })
          : mapped,
      })
      throw mapped
    } finally {
      useUiStore.getState().setConnection('connected', undefined, undefined, null)
      inFlight.delete(id)
    }
  })
  inFlight.set(id, promise)
  return promise
}

export async function unloadOtherModels(keepId: string): Promise<void> {
  const settings = currentSettings()
  if (!settings.singleModelInMemory) return
  const busy = Object.values(useRunStore.getState().runs).some(
    (run) => !run.controller.signal.aborted,
  )
  if (busy) return
  const client = getLLMClient({
    ...settings,
    defaults: { temperature: 0.7, topP: 1, maxTokens: 1024, systemPrompt: '' },
    contextTokenWarning: 4096,
  })
  const models = await client.listAvailableModels()
  useModelStore.getState().setModels(models)
  for (const model of models) {
    if (model.id === keepId || model.type !== 'llm' || model.state !== 'loaded') continue
    try {
      await client.unloadModel(model.id)
    } catch (error: unknown) {
      if (!isAppError(error)) throw error
    }
  }
  await refreshAvailableModels()
}

export function preloadOnTyping(text: string): void {
  const settings = currentSettings()
  if (!settings.preloadOnTyping || !settings.defaultModel || !text.trim()) return
  if (lastPreloadedModel === settings.defaultModel) return
  if (typingTimer !== undefined) globalThis.clearTimeout(typingTimer)
  typingTimer = globalThis.setTimeout(() => {
    typingTimer = undefined
    lastPreloadedModel = settings.defaultModel
    void ensureLoaded(settings.defaultModel!).catch(() => undefined)
  }, 300)
}

export async function selectModel(id: string): Promise<void> {
  useUiStore.getState().setAppSettings({ defaultModel: id })
  lastPreloadedModel = null
  /*
   * Caricare e scaricare modelli e un concetto di LM Studio, quindi in cloud non ha
   * niente da fare: la stessa regola di `ensureLoaded`, non una seconda.
   *
   * La ragione per cui qui resta comunque qualcosa da fare e che cambiare modello
   * cambia il tetto di contesto, e con esso la lista dei modelli che regge quel
   * tetto. Rileggerla costa una richiesta, ma una sola, e non una prova di
   * prontitudine.
   */
  if (isCloudProvider(currentSettings().provider)) {
    await refreshAvailableModels().catch(() => undefined)
    return
  }
  try {
    await ensureLoaded(id)
    await unloadOtherModels(id)
  } catch (error: unknown) {
    useUiStore.getState().addToast({
      tone: 'warning',
      title: isAppError(error) ? error.message : 'The model could not be loaded.',
      ...(isAppError(error) && error.hint ? { message: error.hint } : {}),
      sticky: true,
    })
  }
}

export function modelStatusPill(): 'loading' | 'loaded' | 'not-loaded' | 'unknown' {
  const id = currentSettings().defaultModel
  if (!id) return 'unknown'
  return useModelStore.getState().models.find((model) => model.id === id)?.state ?? 'unknown'
}

/** Test seam: drops the in-flight map and the typing debounce. */
export function resetModelManagerForTests(): void {
  inFlight.clear()
  if (typingTimer !== undefined) {
    globalThis.clearTimeout(typingTimer)
    typingTimer = undefined
  }
  lastPreloadedModel = null
}