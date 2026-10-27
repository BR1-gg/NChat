import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cloneSettings, DEFAULT_SETTINGS } from '../types/settings'
import { prepareProvider, registerKey, PROXY_ORIGIN } from './cloudProxy'
import type { ProviderId } from '../logic/providers'

/**
 * The step that was missing, and the reason a cloud provider looked dead.
 *
 * The key could be typed into a field and nothing ever handed it to the local
 * service. The model list came back empty, every run refused, and the message
 * blamed LM Studio. So this is about `prepareProvider`: it registers the key and
 * says, in a sentence a person can act on, what is between the user and a working
 * request.
 *
 * `fetch` is stubbed because talking to a real provider needs a real key, and a
 * real key does not belong in a test. What is verified here is the decision and
 * the wording, not the network.
 */
describe('prepareProvider', () => {
  const settings = (patch: Partial<ReturnType<typeof cloneSettings>> = {}) => ({
    ...cloneSettings(DEFAULT_SETTINGS),
    provider: 'nvidia' as ProviderId,
    apiKeys: { nvidia: 'sk-di-prova' },
    ...patch,
  })

  const jsonResponse = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is ready for LM Studio without asking anything', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const result = await prepareProvider(settings({ provider: 'lmstudio' }))
    expect(result).toEqual({ ready: true, provider: 'lmstudio' })
    // Nessuna chiamata: in locale non c'e nessun servizio da interrogare, e
    // chiederlo comunque farebbe fallire LM Studio quando il proxy e spento.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('registers the key with the local service, then says ready', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await prepareProvider(settings())
    expect(result).toEqual({ ready: true, provider: 'nvidia' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${PROXY_ORIGIN}/provider/nvidia`)
    expect(init.method).toBe('PUT')
    // La chiave va al servizio, non da qualche parte nel provider.
    expect(JSON.parse(String(init.body)).key).toBe('sk-di-prova')
  })

  it('says which key is missing, instead of asking the provider anyway', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const result = await prepareProvider(settings({ apiKeys: { nvidia: '   ' } }))
    expect(result.ready).toBe(false)
    if (result.ready) throw new Error('unreachable')
    expect(result.reason).toBe('no-key')
    expect(result.message).toMatch(/NVIDIA/)
    expect(result.action).toBe('open-settings')
    // Il punto: non si spreca una richiesta **al provider** per poi dire che
    // manca la chiave. Sarebbe un giro inutile e un 401 fuorviante. L'unica
    // chiamata ammessa e al servizio locale, e serve a dirgli di dimenticarla.
    const urls = fetchMock.mock.calls.map((call) => String(call[0]))
    expect(urls.filter((url) => !url.endsWith(`/provider/${'nvidia'}`))).toEqual([])
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit | undefined)?.method).not.toBe('PUT')
    }
  })

  it('uses the key of the selected provider, and never another one', async () => {
    // Il difetto che una sola chiave avrebbe prodotto: passare a Google con la
    // chiave NVIDIA ancora nel campo. Il risultato sarebbe un 401 che non spiega
    // niente — la chiave c'e, e non e quella giusta.
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await prepareProvider(
      settings({ provider: 'google', apiKeys: { nvidia: 'sk-di-prova' } }),
    )
    // Nessuna richiesta al provider, e nessuna `PUT`: la chiave NVIDIA non viene
    // consegnata a Google ne per sbaglio.
    const calls = fetchMock.mock.calls
    for (const call of calls) {
      expect((call[1] as RequestInit | undefined)?.method).not.toBe('PUT')
      expect(String(call[0])).not.toContain('/p/')
    }

    // Con la sua, invece, parte tutto.
    await prepareProvider(
      settings({ provider: 'google', apiKeys: { nvidia: 'sk-di-prova', google: 'goog-di-prova' } }),
    )
    const init = fetchMock.mock.calls.at(-1)?.[1] as RequestInit
    expect(String(init.body)).toContain('goog-di-prova')
    expect(String(init.body)).not.toContain('sk-di-prova')
    // E va al percorso del provider giusto, non a quello dell'altro.
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('/provider/google')
  })

  it('makes the service forget a key the user has deleted', async () => {
    /*
     * Il caso che rende vera la promessa scritta sotto il campo: la chiave non
     * viene scritta e non viene mandata fuori, e cancellandola l'utente si aspetta
     * che sparisca. Ma il proxy la tiene in memoria finche non glielo si dice, e
     * senza questo la cancellazione lasciava la credenziale viva e ancora in uso.
     */
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await prepareProvider(settings({ apiKeys: { nvidia: '' } }))
    expect(result.ready).toBe(false)
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
    expect(url).toContain('/provider/nvidia')
    expect(init.method).toBe('DELETE')
  })

  it('does not tell the service to forget a key it should keep', async () => {
    // Il contrario della riga sopra, che e il caso normale: non si deve mandare un
    // DELETE a ogni controllo di connessione.
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await prepareProvider(settings())
    const methods = fetchMock.mock.calls.map((call) => (call[1] as RequestInit | undefined)?.method)
    expect(methods).not.toContain('DELETE')
  })

  it('says which provider is missing a key, by name', async () => {
    // "NVIDIA needs an API key" quando l'utente sta guardando Google e ha
    // dimenticato di riempirla: il messaggio deve nominare il provider che manca,
    // non quello che capita di essere selezionato per sbaglio.
    vi.stubGlobal('fetch', vi.fn())
    const result = await prepareProvider(settings({ provider: 'google' }))
    expect(result.ready).toBe(false)
    if (result.ready) throw new Error('unreachable')
    expect(result.message).toMatch(/Google/)
  })

  it('names the service being down, and what to do about it', async () => {
    // Il caso piu probabile in pratica: l'utente ha aperto l'app senza il tray.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    const result = await prepareProvider(settings())
    expect(result.ready).toBe(false)
    if (result.ready) throw new Error('unreachable')
    expect(result.reason).toBe('service-down')
    expect(result.action).toBe('start-service')
    // Il messaggio deve nominare il servizio, non dire "errore di rete": sono
    // due cose diverse e solo una si risolve.
    expect(result.message).toMatch(/local service/i)
  })

  it('never asks for an address, because the only cloud provider has one', async () => {
    // Non esiste un caso "manca l'indirizzo": e codice morto, e il codice morto
    // in una funzione di preparazione sembra una condizione reale. Se un giorno
    // arrivasse un provider senza indirizzo, questo test va cambiato insieme.
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await prepareProvider(settings())
    expect(result.ready).toBe(true)
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))
    expect(body.baseUrl).toBeUndefined()
  })

  it('sends the address the user wrote, for a provider that has a default', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    await prepareProvider(
      settings({ baseUrlOverrides: { nvidia: 'https://integrate.api.nvidia.com/v1' }, provider: 'nvidia' }),
    )
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))
    // Gli indirizzi di questo progetto sono conoscenza, non misurazioni: senza
    // questa via, un provider che li cambia lascia l'utente senza uscita.
    expect(body.baseUrl).toBe('https://integrate.api.nvidia.com/v1')
  })

  it('treats a refused address as a refused address, not as a dead service', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'no' }, 400)))
    const result = await prepareProvider(settings())
    expect(result.ready).toBe(false)
    if (result.ready) throw new Error('unreachable')
    // Sono due problemi diversi: uno si risolve correggendo l'indirizzo, l'altro
    // avviando il servizio. Confonderli porta a far fare la cosa sbagliata.
    expect(result.reason).toBe('refused')
    expect(result.action).toBe('open-settings')
  })
})

describe('registerKey', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does nothing for LM Studio, and never calls the service', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const taken = await registerKey({
      ...cloneSettings(DEFAULT_SETTINGS),
      provider: 'lmstudio',
      apiKeys: { nvidia: 'irrilevante' },
    })
    expect(taken).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
