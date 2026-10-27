import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useConnection } from './useConnection'
import { useModelStore } from '../store/modelStore'
import { useUiStore } from '../store/uiStore'
import { DEFAULT_APP_SETTINGS } from '../types/settings'

/**
 * Cambiare provider deve cambiare la lista dei modelli. E viceversa.
 *
 * Il difetto che e stato segnalato: passando a LM Studio il menu mostrava ancora
 * i modelli di NVIDIA. E scegliendone uno la richiesta sarebbe partita verso un
 * servizio che quel modello non ce l'ha — quindi non era un difetto di aspetto,
 * era un invio di richieste al posto sbagliato.
 *
 * La causa era che la lista del menu vive in `modelStore` e il fallimento della
 * connessione svuotava la lista in `uiStore`, che nessuno legge.
 */
describe('the model list follows the provider', () => {
  const nvidiaModels = [
    { id: 'nvidia/one', type: 'llm' as const, state: 'unknown' as const, instanceIds: [] },
    { id: 'nvidia/two', type: 'llm' as const, state: 'unknown' as const, instanceIds: [] },
  ]

  const lmResponse = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })

  beforeEach(() => {
    vi.restoreAllMocks()
    useModelStore.getState().setModels([])
    useUiStore.getState().setAppSettings(DEFAULT_APP_SETTINGS)
    useUiStore.getState().setProviderBlock(null)
  })

  it('leaves no models from the old provider in the menu when the new one is offline', async () => {
    // NVIDIA ha risposto e riempito il menu.
    useUiStore.getState().setAppSettings({ ...DEFAULT_APP_SETTINGS, provider: 'nvidia', apiKeys: { nvidia: 'sk-x' } })
    useModelStore.getState().setModels(nvidiaModels)
    expect(useModelStore.getState().models).toHaveLength(2)

    // Ora l'utente passa a Local, e LM Studio non e in esecuzione.
    useUiStore.getState().setAppSettings({ ...DEFAULT_APP_SETTINGS, provider: 'lmstudio' })
    // Il fetch fallisce, come quando il server e spento.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const { result } = renderHook(() => useConnection())
    await vi.waitFor(() => {
      expect(useUiStore.getState().connectionStatus).toBe('offline')
    })
    void result

    // Il punto: la lista e vuota, e il modello scelto non e piu quello di NVIDIA.
    expect(useModelStore.getState().models).toEqual([])
    expect(useUiStore.getState().appSettings.defaultModel).toBeNull()
  })

  it('empties the menu before the new provider has answered, not after', async () => {
    // Il tempo fra lo switch e la risposta e di uno o due secondi. In quel tempo
    // il menu mostrava ancora il provider precedente: scegliere un modelloNVIDIA
    // mentre si e passati a Local mandava l'id a LM Studio.
    useUiStore.getState().setAppSettings({ ...DEFAULT_APP_SETTINGS, provider: 'nvidia', apiKeys: { nvidia: 'sk-x' } })
    useModelStore.getState().setModels(nvidiaModels)

    // Una richiesta che non risolve mai: il caso "il provider ci sta pensando".
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})))

    renderHook(() => useConnection())
    useUiStore.getState().setAppSettings({ ...DEFAULT_APP_SETTINGS, provider: 'lmstudio' })

    // Senza aspettare la risposta: la lista deve gia essere sparita.
    expect(useModelStore.getState().models).toEqual([])
  })

  it('names the provider in the error, so the message points somewhere', async () => {
    useUiStore.getState().setAppSettings({ ...DEFAULT_APP_SETTINGS, provider: 'nvidia', apiKeys: { nvidia: 'sk-x' } })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    renderHook(() => useConnection())
    await vi.waitFor(() => {
      expect(useUiStore.getState().connectionStatus).toBe('offline')
    })
    const error = useUiStore.getState().connectionError
    // Non "apri LM Studio": con un provider cloud quello e un programma che non
    // c'entra e non e neanche in esecuzione.
    expect(error?.message).toMatch(/local service/i)
  })

  it('keeps the models when the provider answers, and selects one', async () => {
    useUiStore.getState().setAppSettings({ ...DEFAULT_APP_SETTINGS, provider: 'nvidia', apiKeys: { nvidia: 'sk-x' } })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (String(url).includes('/models')) {
          return Promise.resolve(lmResponse({ data: nvidiaModels.map((m) => ({ id: m.id })) }))
        }
        return Promise.resolve(lmResponse({ data: [] }))
      }),
    )
    renderHook(() => useConnection())
    await vi.waitFor(() => {
      expect(useUiStore.getState().connectionStatus).toBe('connected')
    })
    expect(useModelStore.getState().models.map((m) => m.id)).toEqual(['nvidia/one', 'nvidia/two'])
    // E un modello viene prescelto, cosi il menu non parte vuoto connesso.
    expect(useUiStore.getState().appSettings.defaultModel).toBe('nvidia/one')
  })

  it('still serves LM Studio when it is running', async () => {
    // Il caso opposto, perche una correzione che svuota sempre la lista romperebbe
    // la strada che gia funzionava.
    //
    // Il finto server imita anche l'endpoint **nativo** di LM Studio, che ha una
    // forma diversa: se rispondesse a tutto con la sola lista OpenAI, la sonda
    // delle capacita accetterebbe una risposta che poi il percorso nativo non sa
    // leggere, e il test fallirebbe per una ragione che non c'entra.
    useUiStore.getState().setAppSettings({ ...DEFAULT_APP_SETTINGS, provider: 'lmstudio' })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        const target = String(url)
        if (target.includes('/api/v1/models')) {
          // La forma nativa di LM Studio usa `key` e `loaded_instances`, non
          // `id`. Un mock con la forma sbagliata fa fallire il test per una
          // ragione che non c'entra con quello che si sta verificando.
          return Promise.resolve(
            lmResponse({
              models: [
                {
                  key: 'locale-1',
                  type: 'llm',
                  display_name: 'Locale 1',
                  loaded_instances: [{ id: 'inst-1' }],
                },
              ],
            }),
          )
        }
        if (target.includes('/models')) {
          return Promise.resolve(lmResponse({ data: [{ id: 'locale-1' }] }))
        }
        return Promise.resolve(lmResponse({ data: [] }))
      }),
    )
    renderHook(() => useConnection())
    await vi.waitFor(() => {
      expect(useUiStore.getState().connectionStatus).toBe('connected')
    })
    expect(useModelStore.getState().models.map((m) => m.id)).toEqual(['locale-1'])
  })
})
