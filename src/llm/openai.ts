import type { FinishReason } from '../types/document'
import { appError, isAppError, type AppError } from '../types/errors'
import type { Settings } from '../types/settings'
import { consumeSSE, consumeSSEText, type SSEChatEvent } from './sse'
import { requestBase } from './cloudProxy'
import { isCloudProvider, providerSpec } from '../logic/providers'
import { log } from '../logging/logger'
import { useUiStore } from '../store/uiStore'
import {
  toWireRequest,
  type ChatRequest,
  type CompletionHandlers,
  type CompletionResult,
  type LLMClient,
  type ModelCapabilities,
  type ModelInfo,
  type ModelType,
  type Usage,
  type WireRequest,
} from './types'

const OPEN_TIMEOUT_MS = 10_000
const FIRST_BYTE_TIMEOUT_MS = 180_000
/** A model resident for this long is definitely servable. */
const RESIDENT_GRACE_MS = 30_000

/**
 * Le correzioni gia' segnalate, per non ripeterle.
 *
 * Un modulo e non uno stato: serve solo a non dire due volte la stessa cosa, e non deve
 * far ridisegnare niente. Cresce con le richieste corrette, non con quelle corrette
 * uguali, quindi resta piccolo.
 */
const reportedAdjustments = new Set<string>()

interface ProviderError extends AppError {
  status: number
  raw: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function truncate(value: string, length = 1_000): string {
  return value.length > length ? `${value.slice(0, length)}…` : value
}

async function readProviderError(response: Response): Promise<ProviderError> {
  const raw = truncate(await response.text())
  let message = raw || `The provider returned HTTP ${response.status}.`
  let parsed: unknown

  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    parsed = undefined
  }

  if (isRecord(parsed)) {
    const error = parsed.error
    if (typeof error === 'string') {
      message = error
    } else if (isRecord(error) && typeof error.message === 'string') {
      message = error.message
    } else if (typeof parsed.message === 'string') {
      message = parsed.message
    }
  }

  return {
    kind: 'SERVER_ERROR',
    message,
    status: response.status,
    raw,
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

function looksLikeUnsupportedStreamOptions(error: AppError): boolean {
  const text = `${error.message} ${error.raw ?? ''}`.toLowerCase()
  return (
    text.includes('stream_options') ||
    text.includes('stream options') ||
    (text.includes('include_usage') && text.includes('unknown'))
  )
}

export function mapLlmError(error: unknown, settings: Settings): AppError {
  if (isAppError(error)) return error

  if (isAbortError(error)) {
    // Non e un errore: e l'utente che ha premuto Stop. Registrarlo come errore
    // riempirebbe il registro di roba che l'utente ha chiesto lui, e il registro
    // serve per trovare quello che non ha chiesto nessuno.
    return appError('ABORTED', 'Generation stopped.')
  }

  if (error instanceof TypeError) {
    const label = providerSpec(settings.provider).label
    log.error('llm', `Rete irraggiungibile: ${label}`, {
      provider: settings.provider,
      errore: error.message,
    })
    /*
     * Le tre cose da distinguere, e ordinate perche una esclude l'altra.
     *
     * Con un provider in cloud il fallimento e quasi sempre il servizio locale
     * che non gira, e dire "abilita gli origini consentiti in LM Studio" su
     * quello e un errore che rimanda a un programma che non c'e coinvolto.
     */
    if (isCloudProvider(settings.provider)) {
      return appError('OFFLINE', 'The local service is not answering.', {
        hint: 'Start it from the tray icon, or run: node tools\\cloud-proxy.mjs',
        raw: error.message,
      })
    }
    if (!settings.useProxy) {
      return appError('CORS_BLOCKED', 'The browser blocked the request.', {
        hint: 'Enable "Allow all origins" in LM Studio → Developer, or turn on Use proxy in Settings.',
        raw: error.message,
      })
    }
    return appError('OFFLINE', `Cannot reach ${label} at ${settings.baseUrl}.`, {
      hint: 'Start the server and load a model.',
      raw: error.message,
    })
  }

  if (error instanceof Error) {
    if (error.message.toLowerCase().includes('timeout')) {
      return appError('TIMEOUT', `${providerSpec(settings.provider).label} did not answer in time.`, {
        hint: isCloudProvider(settings.provider)
          ? 'The provider may be busy, or the model may be large. Try again in a moment.'
          : 'Is the server started and is the model loaded?',
        raw: error.message,
      })
    }
    return appError('INTERNAL', 'The request could not be completed.', {
      hint: 'Try again. If the problem continues, check the browser console.',
      raw: error.message,
    })
  }

  return appError('INTERNAL', 'The request could not be completed.', {
    raw: String(error),
  })
}

function mapHttpError(error: ProviderError, settings: Settings): AppError {
  const text = `${error.message} ${error.raw}`.toLowerCase()
  const common = {
    status: error.status,
    raw: error.raw,
  }

  const label = providerSpec(settings.provider).label
  const cloud = isCloudProvider(settings.provider)

  /*
   * Ogni risposta non riuscita finisce nel registro, con lo stato e quello che il
   * provider ha risposto. Senza questo, «NVIDIA ha risposto 404» e «NVIDIA non ha
   * risposto» sono la stessa cosa da guardare, e sono problemi opposti: il primo
   * e il modello, il secondo e la rete o la chiave.
   */
  const level = error.status >= 500 || error.status === 429 ? 'error' : 'warn'
  log[level]('provider', `${label} ha risposto ${error.status}`, {
    provider: settings.provider,
    stato: error.status,
    risposta: error.raw,
  })

  if (error.status === 429) {
    return appError('RATE_LIMIT', cloud ? `${label} is rate-limiting this key.` : 'LM Studio is busy.', {
      ...common,
      hint: cloud
        ? 'A free tier has a quota. Wait a moment, or use another provider.'
        : 'Try again in a moment.',
    })
  }

  /*
   * Una 401 dal **proxy locale** non e una 401 del provider.
   *
   * Il proxy risponde `{"error":"no key registered for ..."}` quando e stato
   * riavviato e non ha piu la chiave, che e successo davvero durante la verifica.
   * Senza questo caso l'errore diceva "il provider ha rifiutato la chiave" e
   * mandava l'utente a correggere una chiave che era giusta: il servizio era
   * semplicemente ripartito senza di lei. Due problemi diversi, due posti
   * diversi in cui andare.
   */
  if (cloud && /no key registered/.test(error.raw)) {
    return appError('OFFLINE', 'The local service does not have the key for this provider.', {
      ...common,
      hint: 'It restarts empty by design. Start it from the tray icon, then give it the key again in Settings → Connection.',
    })
  }

  /*
   * 401 e 403 dal provider vuol dire che la chiave e sbagliata, e in cloud e la
   * causa piu comune dopo averla messa male. Senza questo caso l'errore arriva
   * come "modello non caricato", che parla di una cosa che in un provider cloud
   * non esiste e non aiuta a niente.
   */
  if (error.status === 401 || error.status === 403) {
    return appError('BAD_RESPONSE', cloud ? `${label} refused the API key.` : 'LM Studio refused the request.', {
      ...common,
      hint: cloud
        ? 'Check the key in Settings → Connection. A free tier may also have run out of credit.'
        : 'Check the base URL in Settings → Connection.',
    })
  }

  if (
    (error.status === 400 || error.status === 404) &&
    (text.includes('model') || text.includes('not_found'))
  ) {
    return appError('MODEL_NOT_LOADED', cloud ? `${label} does not know that model.` : 'The selected model is not loaded.', {
      ...common,
      hint: cloud
        ? 'Pick a model from the list. Providers change their catalogue, and this one may not be there any more.'
        : 'Open LM Studio and load the selected model.',
    })
  }

  if (
    error.status === 400 &&
    (text.includes('context length') || text.includes('too many tokens') || text.includes('tokens'))
  ) {
    return appError('CONTEXT_OVERFLOW', 'The request exceeds the model context limit.', {
      ...common,
      hint: 'Reduce history, shorten the prompt, or lower max tokens.',
    })
  }

  /*
   * 502/503/504 vuol dire «qualcosa di mezzo non si e fatto raggiungere», e **cosa
   * sta di mezzo dipende dal provider**.
   *
   * In locale e il proxy di sviluppo di Vite su `/lm`: l'indirizio da correggere e
   * quello scritto dall'utente. In cloud e il servizio locale su 127.0.0.1, e
   * l'indirizzo che ha fallito e quello del provider, che la pagina non conosce e
   * non deve conoscere.
   *
   * I due casi erano in un solo ramo, e il ramo unico era sbagliato per entrambi:
   * con Google selezionato una richiesta fallita rispondeva «Cannot reach Google AI
   * Studio (cloud) at http://localhost:1234/v1» e suggeriva di avviare LM Studio.
   * La porta in quel messaggio e proprio quella che e stata segnalata, e nomina un
   * programma che non c'entra con la richiesta fallita.
   */
  if (error.status === 502 || error.status === 503 || error.status === 504) {
    if (cloud) {
      return appError('OFFLINE', `The local service could not reach ${label}.`, {
        ...common,
        hint: 'The service is running, so this is the network or the provider. Check your connection, then try again.',
      })
    }
    if (settings.useProxy) {
      return appError('OFFLINE', `Cannot reach ${label} at ${settings.baseUrl}.`, {
        ...common,
        hint: 'Start the server and load a model. The development proxy could not reach LM Studio.',
      })
    }
  }

  if (error.status >= 500) {
    return appError('SERVER_ERROR', `${label} returned ${error.status}.`, {
      ...common,
      hint: cloud
        ? 'The provider had a problem. Trying again later is usually enough.'
        : 'Check the LM Studio logs and try again.',
    })
  }

  if (error.status === 400) {
    return appError('BAD_RESPONSE', `${label} rejected the request.`, {
      ...common,
      hint: 'Review the request parameters and try again.',
    })
  }

  return appError('SERVER_ERROR', `${label} returned ${error.status}.`, {
    ...common,
    hint: cloud
      ? 'The provider answered with an error it did not explain.'
      : `Check that the server is running at ${settings.baseUrl}.`,
  })
}

function buildBaseUrl(settings: Settings): string {
  // Per un provider cloud la richiesta va al servizio locale, che mette la chiave
  // e sceglie la destinazione. La forma della richiesta non cambia: cambia solo
  // l'indirizzo, quindi tutto il resto di questo file resta valido.
  if (isCloudProvider(settings.provider)) return requestBase(settings)
  if (settings.useProxy) return '/lm/v1'
  return settings.baseUrl.replace(/\/+$/, '')
}

/**
 * LM Studio's own endpoints, the native `/api/v1` and the older `/api/v0`.
 *
 * They only exist for LM Studio, and a cloud provider does not have them: the
 * native one lists the loaded models, and the v0 one reads them. So asking a
 * cloud provider for those would produce a confusing 404, and the code below
 * returns `null` for them instead of building a URL that cannot work.
 */
function buildNativeUrl(settings: Settings, path: string): string | null {
  if (isCloudProvider(settings.provider)) return null
  if (settings.useProxy) return `/lm/api/v1${path}`
  return `${settings.baseUrl.replace(/\/v1\/?$/, '').replace(/\/+$/, '')}/api/v1${path}`
}

function buildV0Url(settings: Settings, path: string): string | null {
  if (isCloudProvider(settings.provider)) return null
  if (settings.useProxy) return `/lm/api/v0${path}`
  return `${settings.baseUrl.replace(/\/v1\/?$/, '').replace(/\/+$/, '')}/api/v0${path}`
}

export function completionUrl(settings: Settings): string {
  return `${buildBaseUrl(settings)}/chat/completions`
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * The kind of model, from whatever the provider bothered to say.
 *
 * The fallback is `llm` and not `other`, e perche funziona.
 *
 * Un endpoint `/models` OpenAI-compatible quasi non manda un campo `type`: e un
 *'estensione di LM Studio, non dello standard. Con il fallback `other`, la
 * lista di **ogni** provider cloud veniva filtrata via dal menu modelli, che
 * restava vuoto con l'aria di funzionare: il sintomo che faceva sembrare il
 * supporto API fittizio.
 *
 * Il prezzo e che un modello di embedding finisce nella lista. Ma allora la
 * richiesta di chat fallisce con un errore del provider che lo dice, e questo e
 * un modo onesto di scoprirlo. Il contrario — non mostrare niente — e un vicolo
 * cieco.
 */
function modelType(value: unknown): ModelType {
  if (value === 'embedding' || value === 'llm') return value
  // `vlm` e il nome che alcuni provider danno ai modelli con visione. Trattarlo
  // come "altro" lo nasconderebbe, e un modello con visione e un modello di chat.
  if (value === 'vlm' || value === 'vision') return 'llm'
  return 'llm'
}

function openAiModelInfo(value: unknown): ModelInfo | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null
  return {
    id: value.id,
    type: modelType(value.type),
    state: 'unknown',
    instanceIds: [],
    ...(optionalString(value.display_name) ? { displayName: optionalString(value.display_name) } : {}),
    ...(optionalString(value.owned_by) ? { ownedBy: optionalString(value.owned_by) } : {}),
    ...(optionalNumber(value.ctx_length) ? { contextLength: optionalNumber(value.ctx_length) } : {}),
    ...(optionalNumber(value.size_bytes) ? { sizeBytes: optionalNumber(value.size_bytes) } : {}),
    ...(optionalString(value.quantization) ? { quantization: optionalString(value.quantization) } : {}),
    ...(optionalString(value.arch) ? { architecture: optionalString(value.arch) } : {}),
  }
}

function nativeInstanceIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((instance) =>
      isRecord(instance) && typeof instance.id === 'string' ? [instance.id] : [],
    )
  }
  if (isRecord(value) && typeof value.id === 'string') return [value.id]
  if (typeof value === 'string' && value.length > 0) return [value]
  return []
}

function nativeModelInfo(value: unknown): ModelInfo | null {
  if (!isRecord(value) || typeof value.key !== 'string') return null
  const instanceIds = nativeInstanceIds(value.loaded_instances)
  return {
    id: value.key,
    type: modelType(value.type),
    state: instanceIds.length > 0 ? 'loaded' : 'not-loaded',
    instanceIds,
    ...(optionalString(value.display_name) ? { displayName: optionalString(value.display_name) } : {}),
    ...(optionalString(value.publisher) ? { ownedBy: optionalString(value.publisher) } : {}),
    ...(optionalNumber(value.max_context_length)
      ? { contextLength: optionalNumber(value.max_context_length) }
      : {}),
    ...(optionalNumber(value.size_bytes) ? { sizeBytes: optionalNumber(value.size_bytes) } : {}),
    ...(isRecord(value.quantization) && typeof value.quantization.name === 'string'
      ? { quantization: value.quantization.name }
      : {}),
    ...(optionalString(value.architecture) ? { architecture: optionalString(value.architecture) } : {}),
  }
}

function v0ModelInfo(value: unknown): ModelInfo | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null
  return {
    ...openAiModelInfo(value)!,
    state: value.state === 'loaded' ? 'loaded' : value.state === 'not-loaded' ? 'not-loaded' : 'unknown',
    contextLength: optionalNumber(value.max_context_length) ?? optionalNumber(value.ctx_length),
  }
}

async function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(appError('ABORTED', 'Generation stopped.'))
      return
    }
    const timer = globalThis.setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        globalThis.clearTimeout(timer)
        reject(appError('ABORTED', 'Generation stopped.'))
      },
      { once: true },
    )
  })
}

async function postChat(
  settings: Settings,
  request: ChatRequest,
  signal: AbortSignal,
): Promise<Response> {
  let includeUsage = request.stream
  let rateRetried = false

  while (true) {
    if (signal.aborted) throw appError('ABORTED', 'Generation stopped.')
    const wire: WireRequest = toWireRequest(request, includeUsage)
    const response = await fetch(completionUrl(settings), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: request.stream ? 'text/event-stream' : 'application/json',
      },
      body: JSON.stringify(wire),
      signal,
    })

    if (response.ok) {
      /*
       * Cosa ha corretto il servizio locale, detto una volta sola.
       *
       * Il proxy riduce certi parametri che il provider non accetta — la temperatura di
       * Claude, per esempio — invece di rifiutarli, e manda il conto in
       * `x-nchat-adjusted`. Senza leggerlo, una risposta generata con 1 su una richiesta
       * con 1.4 sembrerebbe un modello strano; letta, diventa quello che e': un limite
       * noto del provider.
       *
       * Una volta per ricorrenza e non una per tentativo: `postChat` ritenta su un 429,
       * e ripeterebbe l'avviso per ogni tentativo sullo stesso problema.
       */
      const adjusted = response.headers.get('x-nchat-adjusted')
      if (adjusted && !reportedAdjustments.has(adjusted)) {
        reportedAdjustments.add(adjusted)
        log.info('llm', 'Il servizio locale ha corretto la richiesta', {
          provider: settings.provider,
          correzioni: adjusted,
        })
        useUiStore.getState().addToast({
          tone: 'warning',
          title: `${providerSpec(settings.provider).label} accepted the request differently.`,
          message: adjusted.split(' | ').join(' · '),
        })
      }
      return response
    }

    const error = await readProviderError(response)
    if (
      request.stream &&
      includeUsage &&
      error.status === 400 &&
      looksLikeUnsupportedStreamOptions(error)
    ) {
      includeUsage = false
      continue
    }
    if (response.status === 429 && !rateRetried) {
      rateRetried = true
      await abortableDelay(1_000, signal)
      continue
    }
    throw mapHttpError(error, settings)
  }
}

function parseUsage(value: unknown): Usage | undefined {
  if (!isRecord(value)) return undefined
  const promptTokens = optionalNumber(value.prompt_tokens)
  const completionTokens = optionalNumber(value.completion_tokens)
  const totalTokens = optionalNumber(value.total_tokens)
  if (
    promptTokens === undefined ||
    completionTokens === undefined ||
    totalTokens === undefined
  ) {
    return undefined
  }
  return { promptTokens, completionTokens, totalTokens }
}

function parseNonStreamResponse(
  body: unknown,
  handlers: CompletionHandlers,
): CompletionResult {
  if (!isRecord(body)) {
    throw appError('BAD_RESPONSE', 'Unexpected response from the server.')
  }
  const choices = Array.isArray(body.choices) ? body.choices : []
  const first = choices[0]
  if (!isRecord(first) || !isRecord(first.message)) {
    throw appError('BAD_RESPONSE', 'The server did not return a completion.')
  }
  const content = first.message.content
  const reasoning = first.message.reasoning_content ?? first.message.reasoning
  if (typeof reasoning === 'string' && reasoning) handlers.onReasoning?.(reasoning)
  if (typeof content !== 'string') {
    throw appError('BAD_RESPONSE', 'The server did not return text content.')
  }
  handlers.onChunk(content)

  const usage = parseUsage(body.usage)
  if (usage) handlers.onUsage?.(usage)
  const rawFinish = first.finish_reason
  const finishReason: FinishReason =
    rawFinish === 'stop' || rawFinish === 'length' || rawFinish === 'content_filter'
      ? rawFinish
      : 'unknown'

  return { finishReason, ...(usage ? { usage } : {}) }
}

/**
 * Un endpoint di LM Studio, con il controllo che esista.
 *
 * Chiamata solo dove `capabilities.level` dice che quell'endpoint c'e, e per un
 * provider cloud quel `level` non e mai questo. Il controllo resta perche
 * costruire un URL a `null` darebbe "failed to fetch" e un messaggio che
 * nomina LM Studio mentre si e scelto un provider in cloud: l'errore peggiore,
 * perche rimanda a una cosa che non e quella.
 */
function lmEndpoint(
  build: typeof buildNativeUrl,
  settings: Settings,
  path: string,
): string {
  const url = build(settings, path)
  if (url === null) {
    throw appError('BAD_RESPONSE', 'That endpoint is not available for the selected provider.', {
      hint: 'Switch back to LM Studio to load or unload models by hand.',
    })
  }
  return url
}

export function createOpenAIClient(settings: Settings): LLMClient {
  let capabilityCache: ModelCapabilities | undefined
  let capabilityPromise: Promise<ModelCapabilities> | null = null

  const detectCapabilities = async (): Promise<ModelCapabilities> => {
    if (capabilityCache) return capabilityCache
    capabilityPromise ??= (async () => {
      /*
       * Le sonde native sono di LM Studio e non hanno senso in cloud: un provider
       * che non espone `/api/v1` risponderebbe 404 e verrebbe scambiato per
       * "versione antica", il che cambierebbe il modo in cui i modelli vengono
       * caricati. In cloud la capacita e gia nota: si chiede, e la risposta e
       * quello che c'e.
       */
      if (isCloudProvider(settings.provider)) {
        capabilityCache = { nativeLoad: false, listsUnloaded: false, level: 'openai-compatible' }
        return capabilityCache
      }
      for (const [build, level] of [
        [buildNativeUrl, 'native-v1'],
        [buildV0Url, 'beta-v0'],
      ] as const) {
        const url = build(settings, '/models')
        if (url === null) continue
        try {
          const response = await fetch(url, { method: 'GET' })
          if (response.ok) {
            capabilityCache = {
              nativeLoad: level === 'native-v1',
              listsUnloaded: true,
              level,
            }
            return capabilityCache
          }
        } catch {
          // Prova l'altro endpoint, o in fine la via OpenAI.
        }
      }
      capabilityCache = { nativeLoad: false, listsUnloaded: false, level: 'openai-compatible' }
      return capabilityCache
    })()
    return capabilityPromise
  }

  const fetchJson = async (url: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> => {
    const response = await fetch(url, { ...init, signal })
    if (!response.ok) throw mapHttpError(await readProviderError(response), settings)
    return response.json() as Promise<unknown>
  }

  return {
    async listModels(signal) {
      const controller = new AbortController()
      let timedOut = false
      const timer = globalThis.setTimeout(() => {
        timedOut = true
        controller.abort()
      }, OPEN_TIMEOUT_MS)
      const onAbort = () => controller.abort()
      signal?.addEventListener('abort', onAbort, { once: true })

      try {
        if (signal?.aborted) throw appError('ABORTED', 'Connection check stopped.')
        const response = await fetch(`${buildBaseUrl(settings)}/models`, {
          method: 'GET',
          signal: controller.signal,
        })
        if (!response.ok) throw mapHttpError(await readProviderError(response), settings)
        const body: unknown = await response.json()
        if (!isRecord(body) || !Array.isArray(body.data)) {
          throw appError('BAD_RESPONSE', 'The model list response was invalid.')
        }
        return body.data
          .map(openAiModelInfo)
          .filter((model): model is ModelInfo => model !== null)
      } catch (error: unknown) {
        if (timedOut) {
          /*
           * Il nome del provider, non "LM Studio".
           *
           * Questo timeout si verifica anche con Google o NVIDIA selezionati, e un
           * messaggio che nomina LM Studio li rimanda ad aprire un programma che
           * non c'entra e non e neanche in esecuzione: l'errore piu fuorviante che
           * ci sia, perche descrive con precisione un programma che l'utente non
           * sta usando.
           */
          const providerLabel = providerSpec(settings.provider).label
          throw appError('TIMEOUT', `${providerLabel} did not answer in 10 seconds.`, {
            hint: isCloudProvider(settings.provider)
              ? 'The local service is in the way. Check that it is running, then try again.'
              : 'Is the server started?',
          })
        }
        throw mapLlmError(error, settings)
      } finally {
        globalThis.clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
      }
    },

    async listAvailableModels(signal) {
      const capabilities = await detectCapabilities()
      if (capabilities.level === 'native-v1') {
        const body = await fetchJson(lmEndpoint(buildNativeUrl, settings, '/models'), { method: 'GET' }, signal)
        if (!isRecord(body) || !Array.isArray(body.models)) {
          throw appError('BAD_RESPONSE', 'The native model list response was invalid.')
        }
        return body.models.map(nativeModelInfo).filter((model): model is ModelInfo => model !== null)
      }
      if (capabilities.level === 'beta-v0') {
        const body = await fetchJson(lmEndpoint(buildV0Url, settings, '/models'), { method: 'GET' }, signal)
        if (!isRecord(body) || !Array.isArray(body.data)) {
          throw appError('BAD_RESPONSE', 'The beta model list response was invalid.')
        }
        return body.data.map(v0ModelInfo).filter((model): model is ModelInfo => model !== null)
      }
      const body = await fetchJson(`${buildBaseUrl(settings)}/models`, { method: 'GET' }, signal)
      if (!isRecord(body) || !Array.isArray(body.data)) {
        throw appError('BAD_RESPONSE', 'The model list response was invalid.')
      }
      return body.data.map(openAiModelInfo).filter((model): model is ModelInfo => model !== null)
    },

    async loadModel(id, signal, timeoutMs = 300_000) {
      const capabilities = await detectCapabilities()
      if (capabilities.level === 'native-v1') {
        const controller = new AbortController()
        const onAbort = (): void => controller.abort()
        signal?.addEventListener('abort', onAbort, { once: true })
        const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs)
        // `loaded_instances` is populated while the weights are still being
        // mapped: on this machine it appears ~1.6 s into an 18 s load. Aborting
        // the request as soon as it is non-empty makes the app think the model
        // is ready long before LM Studio can serve it, which strands the load
        // part-way. So the POST is awaited, and the poll is only a watchdog for
        // the case where the server never answers at all: a model that has been
        // resident for RESIDENT_GRACE_MS is genuinely usable by then.
        let settled = false
        let residentSince: number | null = null
        const poll = globalThis.setInterval(() => {
          if (settled) return
          void fetchJson(lmEndpoint(buildNativeUrl, settings, '/models'), { method: 'GET' })
            .then((body) => {
              if (settled || !isRecord(body) || !Array.isArray(body.models)) return
              const model = body.models
                .map(nativeModelInfo)
                .find((candidate): candidate is ModelInfo => candidate?.id === id)
              if (model?.state !== 'loaded') {
                residentSince = null
                return
              }
              residentSince ??= Date.now()
              if (Date.now() - residentSince >= RESIDENT_GRACE_MS) {
                settled = true
                controller.abort()
              }
            })
            .catch(() => undefined)
        }, 2_000)
        try {
          const body = await fetchJson(
            lmEndpoint(buildNativeUrl, settings, '/models/load'),
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ model: id }),
            },
            controller.signal,
          )
          if (isRecord(body) && body.status === 'error') {
            throw appError('MODEL_NOT_LOADED', String(body.error ?? 'The model could not be loaded.'))
          }
        } catch (error: unknown) {
          if (settled) return
          if (signal?.aborted) throw appError('ABORTED', 'Model loading stopped.')
          if (isAppError(error)) throw error
          throw mapLlmError(error, settings)
        } finally {
          settled = true
          globalThis.clearInterval(poll)
          globalThis.clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
        }
        return
      }
      // JIT warm-up is the only portable fallback.
      const controller = new AbortController()
      const onAbort = (): void => controller.abort()
      signal?.addEventListener('abort', onAbort, { once: true })
      const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs)
      try {
        await fetchJson(
          completionUrl(settings),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: id,
              messages: [{ role: 'user', content: 'Ready.' }],
              max_tokens: 1,
              stream: false,
            }),
          },
          controller.signal,
        )
      } catch (error: unknown) {
        if (signal?.aborted) throw appError('ABORTED', 'Model loading stopped.')
        throw mapLlmError(error, settings)
      } finally {
        globalThis.clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
      }
    },

    async unloadModel(id, signal) {
      if ((await detectCapabilities()).level !== 'native-v1') return
      const models = await this.listAvailableModels(signal)
      const model = models.find((candidate) => candidate.id === id)
      if (!model) return
      for (const instanceId of model.instanceIds) {
        await fetchJson(
          lmEndpoint(buildNativeUrl, settings, '/models/unload'),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ instance_id: instanceId }),
          },
          signal,
        )
      }
    },

    capabilities: detectCapabilities,

    async chatCompletionStream(request, handlers, signal) {
      const controller = new AbortController()
      let timedOut = false
      const onAbort = () => controller.abort()
      signal.addEventListener('abort', onAbort, { once: true })

      let openTimer = globalThis.setTimeout(() => {
        timedOut = true
        controller.abort()
      }, OPEN_TIMEOUT_MS)
      let firstByteTimer: number | undefined

      const clearTimers = () => {
        globalThis.clearTimeout(openTimer)
        if (firstByteTimer !== undefined) globalThis.clearTimeout(firstByteTimer)
      }

      try {
        if (signal.aborted) throw appError('ABORTED', 'Generation stopped.')
        const response = await postChat(settings, request, controller.signal)
        globalThis.clearTimeout(openTimer)
        openTimer = globalThis.setTimeout(() => undefined, 0)
        firstByteTimer = globalThis.setTimeout(() => {
          timedOut = true
          controller.abort()
        }, settings.firstByteTimeoutMs || FIRST_BYTE_TIMEOUT_MS)

        let finishReason: FinishReason = 'unknown'
        let usage: Usage | undefined
        const consumeEvent = (event: SSEChatEvent) => {
          if (event.content) handlers.onChunk(event.content)
          if (event.reasoning) handlers.onReasoning?.(event.reasoning)
          if (event.finishReason) finishReason = event.finishReason
          if (event.usage) {
            usage = event.usage
            handlers.onUsage?.(event.usage)
          }
        }

        if (request.stream) {
          if (response.body) {
            await consumeSSE(
              response.body,
              consumeEvent,
              signal,
              () => {
                if (firstByteTimer !== undefined) {
                  globalThis.clearTimeout(firstByteTimer)
                  firstByteTimer = undefined
                }
              },
            )
          } else {
            const text = await response.text()
            if (firstByteTimer !== undefined) {
              globalThis.clearTimeout(firstByteTimer)
              firstByteTimer = undefined
            }
            consumeSSEText(text, consumeEvent)
          }
        } else {
          /*
           * Molti servizi OpenAI-compatible ignorano `stream: false` e rispondono
           * lo stesso in streaming. Farsi `response.json()` su un corpo SSE dava
           * "Unexpected token 'd'" — un errore che parla di JSON e non dice nulla
           * del vero problema, e che su un provider cloud sembra un bug dell'app.
           *
           * Quindi si guarda il tipo di contenuto, che e la cosa che il provider
           * sbagliare non puo nascondere, e si legge di conseguenza.
           */
          const contentType = response.headers.get('content-type') ?? ''
          if (contentType.includes('text/event-stream')) {
            if (response.body) {
              await consumeSSE(
                response.body,
                consumeEvent,
                signal,
                () => {
                  if (firstByteTimer !== undefined) {
                    globalThis.clearTimeout(firstByteTimer)
                    firstByteTimer = undefined
                  }
                },
              )
            } else {
              consumeSSEText(await response.text(), consumeEvent)
            }
          } else {
            const body: unknown = await response.json()
            if (firstByteTimer !== undefined) {
              globalThis.clearTimeout(firstByteTimer)
              firstByteTimer = undefined
            }
            const result = parseNonStreamResponse(body, handlers)
            finishReason = result.finishReason
            usage = result.usage
          }
        }

        return { finishReason, ...(usage ? { usage } : {}) }
      } catch (error: unknown) {
        if (signal.aborted) throw appError('ABORTED', 'Generation stopped.')
        if (timedOut) {
          /*
           * Anche questo timeout accade con un provider in cloud, e "the model may
           * still be loading" e un pensiero da LM Studio: li il peso viene caricato
           * in memoria e il primo token può aspettare. Su Google o NVIDIA il
           * modello e gia in piedi e l'attesa e il provider che non ha risposto,
           * quindi il suggerimento deve dirlo.
           */
          const providerLabel = providerSpec(settings.provider).label
          throw appError('TIMEOUT', `${providerLabel} did not return a first token in time.`, {
            hint: isCloudProvider(settings.provider)
              ? 'The provider accepted the request but sent nothing back. It may be busy; try again in a moment.'
              : 'The model may still be loading. Wait a moment and retry.',
          })
        }
        throw mapLlmError(error, settings)
      } finally {
        clearTimers()
        signal.removeEventListener('abort', onAbort)
      }
    },
  }
}
