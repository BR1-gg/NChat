import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createOpenAIClient } from '../llm/openai'
import { cloneSettings, DEFAULT_SETTINGS } from '../types/settings'
import { useModelStore } from '../store/modelStore'
import { useRunStore } from '../store/runStore'
import { useUiStore } from '../store/uiStore'
import { ensureLoaded, resetModelManagerForTests, unloadOtherModels } from './modelManager'

const settings = () => {
  const value = cloneSettings(DEFAULT_SETTINGS)
  value.useProxy = true
  return value
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const nativeList = (loaded: string[] = []) => ({
  models: [
    {
      key: 'a',
      type: 'llm',
      loaded_instances: loaded.includes('a') ? { id: 'a' } : {},
    },
    {
      key: 'b',
      type: 'llm',
      loaded_instances: loaded.includes('b') ? [{ id: 'b1' }] : {},
    },
  ],
})

describe('LM Studio capability detection', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('detects the native v1 API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(nativeList())))
    const capabilities = await createOpenAIClient(settings()).capabilities()
    expect(capabilities).toEqual({ nativeLoad: true, listsUnloaded: true, level: 'native-v1' })
  })

  it('falls back to the beta v0 API when v1 is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/v1/')) return Promise.resolve(new Response('nope', { status: 404 }))
        return Promise.resolve(jsonResponse({ data: [{ id: 'a', state: 'not-loaded' }] }))
      }),
    )
    const capabilities = await createOpenAIClient(settings()).capabilities()
    expect(capabilities.level).toBe('beta-v0')
  })

  it('falls back to the OpenAI-compatible level', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 404 })))
    const capabilities = await createOpenAIClient(settings()).capabilities()
    expect(capabilities).toEqual({
      nativeLoad: false,
      listsUnloaded: false,
      level: 'openai-compatible',
    })
  })
})

describe('ensureLoaded in cloud', () => {
  /**
   * In cloud non si carica niente, e soprattutto non si spende niente.
   *
   * Il difetto che questi test presidiano era una **richiesta fatturata a ogni
   * prompt**. `loadModel`, su un livello non nativo, finisce col mandare una richiesta
   * vera di completamento (`max_tokens: 1`, «Ready.») per controllare se il modello e
   * pronto; `runPrompt` chiama `ensureLoaded` prima di ogni richiesta, quindi quel
   * controllo costava una chiamata — e una latenza — per ogni prompt e per ogni
   * cambio modello.
   *
   * La prova guarda il `fetch`, non lo stato finale: e l'unica cosa che distingue
   * «non ha fatto niente» da «ha fatto la cosa giusta», che e anche la differenza
   * che l'utente paga.
   */
  beforeEach(() => {
    resetModelManagerForTests()
    useModelStore.setState({ models: [], runtimes: {} })
    useUiStore.setState({
      appSettings: {
        ...DEFAULT_SETTINGS,
        provider: 'nvidia',
        apiKeys: { nvidia: 'sk-di-prova' },
        defaultModel: 'a',
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetModelManagerForTests()
  })

  it('non manda nessuna richiesta, perche un modello in cloud e gia pronto', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(ensureLoaded('a')).resolves.toBeUndefined()
    // Zero, non «poche»: la prova di prontitudine era una richiesta vera, e questa
    // e la ragione per cui questa funzione esiste.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('non mette lo stato "loading", perche l utente leggeva quello come un attesa', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const stati: string[] = []
    const stacco = useUiStore.subscribe((stato) => {
      if (stato.connectionStatus) stati.push(stato.connectionStatus)
    })
    await ensureLoaded('a')
    stacco()
    expect(stati).not.toContain('loading-model')
  })

  it('marca il modello come pronto, perche per il client lo e', async () => {
    // Non marcarelo lascerebbe la pastiglia in uno stato che non spiega niente, e
    // i controlli che chiedono "e pronto?" direbbero di no a un modello che
    // risponderebbe alla prima richiesta.
    vi.stubGlobal('fetch', vi.fn())
    await ensureLoaded('a')
    expect(useModelStore.getState().runtimes.a?.state).toBe('loaded')
  })

  it('non si mette in coda dietro un caricamento in corso', async () => {
    // La coda di caricamento e pensata per la GPU, dove due caricamenti in
    // contemporanea sono un problema. In cloud serializzerebbe richieste che non
    // hanno niente a che fare fra loro: una in coda all'altra, in ordine di arrivo.
    vi.stubGlobal('fetch', vi.fn())
    const ordine: string[] = []
    const primo = ensureLoaded('a').then(() => ordine.push('primo'))
    const secondo = ensureLoaded('b').then(() => ordine.push('secondo'))
    await Promise.all([primo, secondo])
    expect(ordine).toEqual(['primo', 'secondo'])
  })

  it('per un provider locale continua a caricare come prima', async () => {
    // La guardia non deve aver mangiato il caso per cui esiste: in locale il
    // caricamento e tutto il punto, e questa prova e la difesa contro una
    // semplificazione che avrebbe reso l app silenziosamente incapace di usare
    // LM Studio.
    useUiStore.setState({
      appSettings: { ...DEFAULT_SETTINGS, provider: 'lmstudio', defaultModel: 'a' },
    })
    useModelStore.getState().setModels([{ id: 'a', type: 'llm', state: 'loaded', instanceIds: ['a'] }])
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await ensureLoaded('a')
    // Con il modello gia residente non serve nemmeno una richiesta: e il
    // comportamento di prima della guardia, e deve restare tale.
    expect(fetchMock).not.toHaveBeenCalled()
    expect(useModelStore.getState().runtimes.a?.state).toBe('loaded')
  })
})

describe('ensureLoaded', () => {
  beforeEach(() => {
    resetModelManagerForTests()
    useModelStore.setState({ models: [], runtimes: {} })
    useUiStore.setState({
      appSettings: { ...DEFAULT_SETTINGS, defaultModel: 'a', singleModelInMemory: true },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetModelManagerForTests()
  })

  it('resolves immediately when the model is already loaded', async () => {
    useModelStore.getState().setModels([
      { id: 'a', type: 'llm', state: 'loaded', instanceIds: ['a'] },
    ])
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(ensureLoaded('a')).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not POST a load request for a model the server already reports as loaded', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith('/models/load')) return Promise.resolve(new Error('must not be called'))
      return Promise.resolve(jsonResponse(nativeList(['a'])))
    })
    vi.stubGlobal('fetch', fetchMock)
    await ensureLoaded('a')
    expect(
      fetchMock.mock.calls.some((call) => String(call[0]).endsWith('/models/load')),
    ).toBe(false)
    expect(useModelStore.getState().runtimeFor('a').state).toBe('loaded')
  })

  it('deduplicates concurrent loads of the same model into one promise', async () => {
    useModelStore.getState().setModels([
      { id: 'a', type: 'llm', state: 'not-loaded', instanceIds: [] },
    ])
    const loadCalls: string[] = []
    let loaded = false
    const fetchMock = vi.fn((url: string) => {
      if (String(url).endsWith('/models/load')) {
        loadCalls.push(String(url))
        loaded = true
        return Promise.resolve(jsonResponse({ status: 'ok' }))
      }
      return Promise.resolve(jsonResponse(nativeList(loaded ? ['a'] : [])))
    })
    vi.stubGlobal('fetch', fetchMock)
    await Promise.all([ensureLoaded('a'), ensureLoaded('a'), ensureLoaded('a')])
    expect(loadCalls).toHaveLength(1)
  })

  it('reports a missing model as MODEL_NOT_LOADED with an actionable hint', async () => {
    useModelStore.getState().setModels([
      { id: 'ghost', type: 'llm', state: 'unknown', instanceIds: [] },
    ])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(nativeList())))
    await expect(ensureLoaded('ghost')).rejects.toMatchObject({ kind: 'MODEL_NOT_LOADED' })
  })

  it('maps a memory failure to a smaller-quantization hint', async () => {
    useModelStore.getState().setModels([
      { id: 'a', type: 'llm', state: 'not-loaded', instanceIds: [] },
    ])
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (String(url).endsWith('/models/load')) {
          return Promise.resolve(
            jsonResponse({ status: 'error', error: 'Not enough memory to load the model' }, 400),
          )
        }
        return Promise.resolve(jsonResponse(nativeList()))
      }),
    )
    await expect(ensureLoaded('a')).rejects.toMatchObject({ kind: 'MODEL_NOT_LOADED' })
    expect(useModelStore.getState().runtimeFor('a').error?.hint).toContain('quantization')
  })
})

describe('unloadOtherModels', () => {
  beforeEach(() => {
    resetModelManagerForTests()
    useModelStore.setState({ models: [], runtimes: {} })
    useRunStore.setState({ runs: {} })
    useUiStore.setState({
      appSettings: { ...DEFAULT_SETTINGS, singleModelInMemory: true },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetModelManagerForTests()
  })

  it('unloads other loaded chat models and keeps the selected one', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const target = String(url)
        if (init?.method === 'POST' && target.endsWith('/models/unload')) {
          calls.push(String(init.body))
          return Promise.resolve(jsonResponse({ status: 'ok' }))
        }
        return Promise.resolve(jsonResponse(nativeList(['a', 'b'])))
      }),
    )
    await unloadOtherModels('a')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('b1')
  })

  it('never unloads while a queued job is running', async () => {
    const controller = new AbortController()
    useRunStore.getState().start('resp-1', controller, 'ws-1')
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === 'POST' && String(url).endsWith('/models/unload')) {
          calls.push('unload')
        }
        return Promise.resolve(jsonResponse(nativeList(['a', 'b'])))
      }),
    )
    await unloadOtherModels('a')
    expect(calls).toHaveLength(0)
  })
})
