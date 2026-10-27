import { describe, expect, it, vi } from 'vitest'
import { cloneSettings, DEFAULT_SETTINGS, type Settings } from '../types/settings'
import { completionUrl, createOpenAIClient, mapLlmError } from './openai'
import { PROXY_ORIGIN } from './cloudProxy'
import type { ProviderId } from '../logic/providers'

describe('OpenAI-compatible LM Studio client', () => {
  it('maps direct-mode fetch failures to CORS_BLOCKED', () => {
    const settings = cloneSettings(DEFAULT_SETTINGS)
    settings.useProxy = false
    expect(mapLlmError(new TypeError('Failed to fetch'), settings).kind).toBe('CORS_BLOCKED')
  })

  it('maps proxy-mode fetch failures to OFFLINE', () => {
    expect(mapLlmError(new TypeError('Failed to fetch'), cloneSettings()).kind).toBe('OFFLINE')
  })

  it('lists model ids and LM Studio metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: 'local-model', owned_by: 'lmstudio', ctx_length: 8192 }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const models = await createOpenAIClient(cloneSettings()).listModels()
    expect(models).toEqual([
      // `llm` e non `other`: vedi `modelType`. Una lista OpenAI-compatible non
      // porta quasi mai un campo `type`, e con `other` il menu modelli restava
      // vuoto per ogni provider cloud.
      { id: 'local-model', type: 'llm', state: 'unknown', instanceIds: [], ownedBy: 'lmstudio', contextLength: 8192 },
    ])
    expect(fetchMock).toHaveBeenCalledWith('/lm/v1/models', expect.any(Object))
  })

  it('parses native v1 models and their loaded_instances shapes', async () => {
    // LM Studio returns a single object for one resident model, an array when
    // several instances exist, and an empty object when nothing is loaded.
    const body = {
      models: [
        {
          key: 'qwen-a',
          type: 'llm',
          display_name: 'Qwen A',
          publisher: 'me',
          max_context_length: 262144,
          architecture: 'qwen35',
          quantization: { name: 'Q4_K_M' },
          loaded_instances: { id: 'qwen-a', config: { context_length: 34048 } },
        },
        { key: 'qwen-b', type: 'llm', loaded_instances: [{ id: 'b1' }, { id: 'b2' }] },
        { key: 'qwen-c', type: 'llm', loaded_instances: {} },
        { key: 'embed', type: 'embedding', loaded_instances: {} },
      ],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    const models = await createOpenAIClient(cloneSettings()).listAvailableModels()
    expect(models[0]).toMatchObject({
      id: 'qwen-a',
      type: 'llm',
      state: 'loaded',
      instanceIds: ['qwen-a'],
      contextLength: 262144,
      quantization: 'Q4_K_M',
    })
    expect(models[1]?.state).toBe('loaded')
    expect(models[1]?.instanceIds).toEqual(['b1', 'b2'])
    expect(models[2]).toMatchObject({ state: 'not-loaded', instanceIds: [] })
    expect(models[3]?.type).toBe('embedding')
  })

  it('maps a Vite proxy 502 to OFFLINE in proxy mode', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('proxy unavailable', { status: 502 })),
    )
    await expect(createOpenAIClient(cloneSettings()).listModels()).rejects.toMatchObject({
      kind: 'OFFLINE',
    })
  })

  it('maps a context-length HTTP 400 to CONTEXT_OVERFLOW', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { message: "maximum context length is 8192 tokens" } }),
        { status: 400 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      createOpenAIClient(cloneSettings()).chatCompletionStream(
        { model: 'm', messages: [{ role: 'user', content: 'x' }], stream: false },
        { onChunk: () => undefined },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ kind: 'CONTEXT_OVERFLOW', status: 400 })
  })

  it('consulates streamed text and usage', async () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n' +
      'data: {"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}\n\n' +
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
      'data: [DONE]\n\n'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(sse, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    )

    const chunks: string[] = []
    const result = await createOpenAIClient(cloneSettings()).chatCompletionStream(
      { model: 'm', messages: [{ role: 'user', content: 'x' }], stream: true },
      { onChunk: (chunk) => chunks.push(chunk) },
      new AbortController().signal,
    )
    expect(chunks.join('')).toBe('hello')
    expect(result).toEqual({ finishReason: 'stop', usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 } })
  })
})

/**
 * Dove finisce la richiesta, per ogni provider.
 *
 * Il percorso conta piu di quanto sembri: la richiesta a un provider cloud deve
 * passare dal servizio locale, perche e li che la chiara e mette la chiave. Se
 * un refactoring fa finire una richiesta diretta al provider, la chiave
 * finirebbe nella pagina — e il test che lo ferma e questo, perche il resto
 * continua a funzionare e nessuno se ne accorgerebbe.
 */
describe('request routing per provider', () => {
  const forProvider = (provider: ProviderId, patch: Partial<Settings> = {}): string =>
    completionUrl({ ...cloneSettings(DEFAULT_SETTINGS), provider, ...patch })

  it('sends LM Studio to the local dev proxy when that is on', () => {
    expect(forProvider('lmstudio', { useProxy: true })).toBe('/lm/v1/chat/completions')
  })

  it('sends LM Studio straight to its own address otherwise', () => {
    expect(forProvider('lmstudio', { useProxy: false, baseUrl: 'http://localhost:1234/v1/' })).toBe(
      'http://localhost:1234/v1/chat/completions',
    )
  })

  it('sends every cloud provider to the local service, never to the provider', () => {
    for (const provider of ['nvidia'] as ProviderId[]) {
      const url = forProvider(provider)
      expect(url, provider).toBe(`${PROXY_ORIGIN}/p/${provider}/chat/completions`)
      // Il punto esatto: nessun indirizzo del provider deve comparire qui, e la
      // chiave non viene mandata dalla pagina.
      expect(url, provider).not.toContain('https://')
    }
  })

  it('ignores the LM Studio proxy switch for a cloud provider', () => {
    // `useProxy` parla del proxy di sviluppo di Vite per LM Studio. Se decidesse
    // qualcosa qui, un utente con il proxy spento scoprirebbe che il cloud non
    // funziona, e il motivo sarebbe fuorviante.
    const withProxy = forProvider('nvidia', { useProxy: true })
    const without = forProvider('nvidia', { useProxy: false })
    expect(withProxy).toBe(without)
  })

  it('does not care about the LM Studio base URL for a cloud provider', () => {
    const elsewhere = forProvider('nvidia', { baseUrl: 'http://192.168.1.50:1234/v1' })
    expect(elsewhere).toBe(`${PROXY_ORIGIN}/p/nvidia/chat/completions`)
  })
})

/**
 * Le sonde di LM Studio non hanno senso in cloud, e il motivo per cui.
 *
 * Se finissero fuori, un provider che risponde 404 a `/api/v1` verrebbe scambiato
 * per LM Studio versione antica, e l'app cambierebbe il modo in cui carica i
 * modelli. Il sintomo sarebbe "non riesco a caricare il modello" su un provider
 * dove il modello e gia in piedi.
 */
describe('LM Studio native endpoints are not used for a cloud provider', () => {
  it('does not probe /api/v1 or /api/v0 when the provider is in the cloud', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'gpt-4o-mini' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const settings = { ...cloneSettings(DEFAULT_SETTINGS), provider: 'nvidia' as ProviderId, apiKey: 'sk-x' }
    const models = await createOpenAIClient(settings).listAvailableModels()
    expect(models.map((model) => model.id)).toEqual(['gpt-4o-mini'])
    const called = fetchMock.mock.calls.map((call) => String(call[0]))
    expect(called).toHaveLength(1)
    expect(called[0]).toBe(`${PROXY_ORIGIN}/p/nvidia/models`)
    expect(called[0]).not.toContain('/api/v')
  })
})
/**
 * The model list of a provider that does not say what kind of model it is.
 *
 * This is the shape nearly every OpenAI-compatible service returns, and it is
 * where the cloud path used to die: the picker filtered on `type === 'llm'`, the
 * parser defaulted to `'other'`, and the dropdown stayed empty while everything
 * looked like it was working.
 */
describe('model list from an OpenAI-compatible service', () => {
  const listFrom = (data: unknown) =>
    new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })

  it('treats a model with no type as a chat model', async () => {
    const fetchMock = vi.fn().mockResolvedValue(listFrom([{ id: 'gpt-4o-mini' }]))
    vi.stubGlobal('fetch', fetchMock)
    const models = await createOpenAIClient(cloneSettings()).listModels()
    // Se questo diventa 'other', il menu si svuota e nessuno capisce perche.
    expect(models[0]?.type).toBe('llm')
  })

  it('keeps an explicit embedding model marked as one', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      listFrom([
        { id: 'chat', type: 'llm' },
        { id: 'embed', type: 'embedding' },
      ]),
    )
    vi.stubGlobal('fetch', fetchMock)
    const models = await createOpenAIClient(cloneSettings()).listModels()
    expect(models.find((m) => m.id === 'embed')?.type).toBe('embedding')
    expect(models.find((m) => m.id === 'chat')?.type).toBe('llm')
  })

  it('treats a vision model as a chat model, not as something else', async () => {
    // Un modello con visione e un modello di chat. Classificato "altro" sparisce
    // dal menu, ed e l'unico provider con le immagini a restare senza modelli.
    const fetchMock = vi.fn().mockResolvedValue(listFrom([{ id: 'gemini', type: 'vlm' }]))
    vi.stubGlobal('fetch', fetchMock)
    const models = await createOpenAIClient(cloneSettings()).listModels()
    expect(models[0]?.type).toBe('llm')
  })

  it('skips an entry with no id at all', async () => {
    // Quello si butta: senza id non c'e niente da mostrare ne da richiedere.
    const fetchMock = vi.fn().mockResolvedValue(listFrom([{ owned_by: 'x' }, { id: 'ok' }]))
    vi.stubGlobal('fetch', fetchMock)
    const models = await createOpenAIClient(cloneSettings()).listModels()
    expect(models.map((m) => m.id)).toEqual(['ok'])
  })
})