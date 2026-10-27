/**
 * Gli errori di un provider in cloud non devono mai nominare LM Studio.
 *
 * Il difetto che questo file blocca, e la sua forma esatta. Con Google o NVIDIA
 * selezionati, un 502 dal servizio locale finiva in un ramo scritto per il proxy di
 * sviluppo di Vite, e produceva:
 *
 *   "Cannot reach Google AI Studio (cloud) at http://localhost:1234/v1"
 *   hint: "Start the server and load a model. The development proxy could not
 *          reach LM Studio."
 *
 * Cioe il messaggio nominava la porta di LM Studio **e** suggeriva di avviare un
 * programma che non c'entra, mentre il vero problema — rete, servizio, provider — era
 * altrove. L'utente lo leggeva come "manca LM Studio" e andava a cercarlo.
 *
 * Il motivo per cui un test e il posto giusto per questo e che il resto continua a
 * funzionare: la richiesta va a destra, la risposta arriva, il modello funziona, e
 * l'unica cosa che resta da leggere e proprio la riga di testo sbagliata. Un test
 * green sul routing non lo intercetterebbe mai.
 */

import { describe, expect, it, vi, afterEach } from 'vitest'
import { cloneSettings, DEFAULT_SETTINGS, type Settings } from '../types/settings'
import { createOpenAIClient, mapLlmError } from './openai'
import type { ProviderId } from '../logic/providers'
import { isCloudProvider, providerSpec, PROVIDER_SPECS } from '../logic/providers'

function settingsFor(provider: ProviderId, patch: Partial<Settings> = {}): Settings {
  return { ...cloneSettings(DEFAULT_SETTINGS), provider, ...patch }
}

/** Ogni provider in cloud, letto dal catalogo: aggiungerne uno non deve rompere nulla. */
const CLOUD_PROVIDERS = PROVIDER_SPECS.filter((spec) => isCloudProvider(spec.id)).map(
  (spec) => spec.id,
)

function httpError(status: number, body = '{"error":"upstream failed"}'): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('cloud errors never name LM Studio or its port', () => {
  it('maps a 502 from the local service to the service, not to LM Studio', async () => {
    /*
     * Il caso segnalato. Il proxy risponde 502 quando non riesce a raggiungere il
     * provider a monte, e prima finiva nel ramo del proxy di sviluppo.
     */
    for (const provider of CLOUD_PROVIDERS) {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockImplementation(() =>
            Promise.resolve(httpError(502, '{"error":"could not reach the provider"}')),
          ),
      )
      const client = createOpenAIClient(settingsFor(provider))
      const error = await client
        .listAvailableModels()
        .then(() => null)
        .catch((caught: unknown) => caught)

      const text = `${(error as { message?: string })?.message ?? ''} ${
        (error as { hint?: string })?.hint ?? ''
      }`
      expect(text.toLowerCase(), provider).not.toContain('lm studio')
      expect(text, provider).not.toContain('1234')
      expect(text, provider).toContain(providerSpec(provider).label)
    }
  })

  it('maps 503 and 504 the same way, for every cloud provider', async () => {
    for (const status of [503, 504]) {
      for (const provider of CLOUD_PROVIDERS) {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(httpError(status))))
        const error = await createOpenAIClient(settingsFor(provider))
          .listAvailableModels()
          .then(() => null)
          .catch((caught: unknown) => caught)
        const text = `${(error as { message?: string })?.message ?? ''} ${
          (error as { hint?: string })?.hint ?? ''
        }`
        expect(text.toLowerCase(), `${provider}/${status}`).not.toContain('lm studio')
        expect(text, `${provider}/${status}`).not.toContain('1234')
      }
    }
  })

  it('keeps the LM Studio wording for a local provider, where it is correct', async () => {
    /*
     * Il contrario del test qui sopra, e serve perche il messaggio non diventi
     * "risolto" diventando generico ovunque. In locale la porta 1234 e
     * l'informazione giusta, e perderla sarebbe una perdita.
     *
     * `mockImplementation` e non `mockResolvedValue`: una Response si legge una volta
     * sola, e le sonde di capacita' ne consumano il corpo prima di arrivare a
     * `listAvailableModels`, quindi la stessa istanza riusata fallirebbe per motivi
     * che non c'entrano con quello che si sta verificando.
     */
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(httpError(502))))
    const error = await createOpenAIClient(settingsFor('lmstudio', { useProxy: true }))
      .listAvailableModels()
      .then(() => null)
      .catch((caught: unknown) => caught)
    const message = (error as { message?: string })?.message ?? ''
    expect(message).toContain('http://localhost:1234/v1')
  })

  it('does not blame the dev proxy for a 502 when the dev proxy is off', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(httpError(502))))
    const error = await createOpenAIClient(
      settingsFor('lmstudio', { useProxy: false }),
    )
      .listAvailableModels()
      .then(() => null)
      .catch((caught: unknown) => caught)
    const hint = (error as { hint?: string })?.hint ?? ''
    expect(hint.toLowerCase()).not.toContain('development proxy')
  })

  it('names the provider, not LM Studio, when no first token arrives in time', async () => {
    /*
     * Il timeout del primo token era scritto con la parola "LM Studio" fissa e
     * suggeriva "The model may still be loading". In cloud quel suggerimento e
     * doppiamente fuori luogo: il modello non si sta caricando da nessuna parte,
     * e' gia in piedi, e l'attesa e il provider.
     *
     * La risposta arriva subito e il corpo non emette mai un byte: e la situazione
     * che il timer del primo token descrive, e serve una risposta vera perche quel
     * timer parte solo **dopo** che la richiesta e stata accettata — un `fetch` che
     * non risolve mai farebbe scattare invece il timeout di apertura, che e un
     * errore diverso.
     *
     * `firstByteTimeoutMs` e basso perche il test non puo aspettare i 180 s del
     * default: il punto verificato e il testo del messaggio, non la durata.
     */
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        /*
         * Il corpo resta appeso, e si stacca quando il controller della richiesta
         * viene abortito.
         *
         * In un browser vero e il `fetch` a chiudere il corpo, perche il suo
         * `AbortSignal` e quello di `fetch`. Qui la `Response` e sintetica e non ha
         * quel legame, quindi senza questo aggancio la lettura resterebbe sospesa per
         * sempre e il test scaderebbe invece di osservare il timeout.
         */
        const body = new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener(
              'abort',
              () => controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' })),
              { once: true },
            )
          },
        })
        return Promise.resolve(
          new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
        )
      }),
    )
    for (const provider of CLOUD_PROVIDERS) {
      const client = createOpenAIClient(settingsFor(provider, { firstByteTimeoutMs: 20 }))
      const error = await client
        .chatCompletionStream(
          { model: 'some-model', messages: [{ role: 'user', content: 'hi' }], stream: true },
          { onChunk: () => {} },
          new AbortController().signal,
        )
        .then(() => null)
        .catch((caught: unknown) => caught)
      const text = `${(error as { message?: string })?.message ?? ''} ${
        (error as { hint?: string })?.hint ?? ''
      }`
      expect(text.toLowerCase(), provider).not.toContain('lm studio')
      expect(text, provider).not.toContain('still be loading')
      expect(text, provider).toContain(providerSpec(provider).label)
    }
  })

  it('says the model may still be loading only for a local provider', () => {
    /*
     * "Il modello potrebbe essere ancora in caricamento" e un fatto di LM Studio: li
     * il peso entra in memoria. Su un provider cloud il modello e gia in piedi e
     * l'attesa e il provider, quindi il suggerimento era doppiamente fuori luogo.
     */
    const cloud = mapLlmError(new TypeError('Failed to fetch'), settingsFor('google'))
    expect(`${cloud.message} ${cloud.hint ?? ''}`.toLowerCase()).not.toContain('lm studio')
  })
})
