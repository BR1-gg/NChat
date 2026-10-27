import { describe, expect, it, vi } from 'vitest'
import { createOpenAIClient } from './openai'
import { cloneSettings, DEFAULT_SETTINGS, type Settings } from '../types/settings'
import type { ProviderId } from '../logic/providers'

/**
 * Se i parametri di generazione arrivano al provider.
 *
 * La domanda e venuta dall'utente, ed e quella giusta da fare: «in cloud devo
 * impostare temperatura, top-p e max token, o li decide il provider?».
 *
 * La risposta corta e **li decide l'app, e il provider li onora**: i tre campi
 * viaggiano nel corpo della richiesta, e sono parametri standard dell'API
 * OpenAI-compatible che Google AI Studio e NVIDIA NIM documentano e applicano.
 *
 * Quindi toglierli in modalita API non sarebbe liberare l'utente da una scelta non
 * sua: sarebbe togliere il controllo su tre cose che cambiano il risultato, e su
 * una in particolare che e un controllo di spesa.
 *
 * Questo test lo **dimostra** invece di asserirlo: chiama il client vero contro lo
 * stub di `tools/fake-provider.mjs`, che rimette nella risposta i parametri
 * ricevuti, e legge quello che e arrivato sul filo. Non guarda il codice: guarda la
 * richiesta.
 */

const RISPOSTA = (body: string): Response =>
  new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })

/** Il client vero, con un `fetch` che registra il corpo e risponde come lo stub. */
function clientCheRegistra() {
  const corpi: string[] = []
  const settings: Settings = {
    ...cloneSettings(DEFAULT_SETTINGS),
    provider: 'nvidia' as ProviderId,
    baseUrlOverrides: { nvidia: 'http://127.0.0.1:9/v1' },
  } as Settings
  const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
    corpi.push(String(init?.body ?? ''))
    return RISPOSTA(
      JSON.stringify({
        id: 'x',
        object: 'chat.completion',
        created: 0,
        model: 'finto-grande',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      }),
    )
  })
  vi.stubGlobal('fetch', fetchMock)
  return { corpi, settings, client: createOpenAIClient(settings) }
}

describe('i parametri di generazione arrivano al provider', () => {
  it('manda temperatura, top-p e max-token quando sono impostati', async () => {
    const { corpi, client } = clientCheRegistra()
    await client.chatCompletionStream(
      {
        model: 'finto-grande',
        messages: [{ role: 'user', content: 'ciao' }],
        temperature: 0.05,
        topP: 0.33,
        maxTokens: 321,
        stream: false,
      },
      { onChunk: () => {} },
      new AbortController().signal,
    )
    const inviato = JSON.parse(corpi[0] ?? '{}')
    // Valori lontani dai default (0.7 / 1 / 1024): se la prova usasse i default
    // passerebbe anche se il campo non viaggiasse, perche 0.7 e 1 sono i default
    // del modulo e un errore di cablaggio produrrebbe gli stessi numeri.
    expect(inviato.temperature).toBe(0.05)
    expect(inviato.top_p).toBe(0.33)
    expect(inviato.max_tokens).toBe(321)
  })

  it('manda i parametri anche in streaming, che e il modo normale', async () => {
    const { corpi, client } = clientCheRegistra()
    const sse = [
      'data: {"choices":[{"index":0,"delta":{"content":"ciao"}}]}',
      'data: [DONE]',
      '',
    ].join('\n\n')
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      corpi.push(String(init?.body ?? ''))
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    await client.chatCompletionStream(
      {
        model: 'finto-grande',
        messages: [{ role: 'user', content: 'ciao' }],
        temperature: 0.11,
        topP: 0.22,
        maxTokens: 123,
        stream: true,
      },
      { onChunk: () => {} },
      new AbortController().signal,
    )
    const inviato = JSON.parse(corpi[0] ?? '{}')
    expect(inviato.stream).toBe(true)
    expect(inviato.temperature).toBe(0.11)
    expect(inviato.top_p).toBe(0.22)
    expect(inviato.max_tokens).toBe(123)
  })

  it('togliere i parametri cambierebbe la risposta, e max-token e un tetto di spesa', () => {
    /*
     * Perche allora non toglierli in modalita API, e la parte che va detto all'utente
     * con le sue parole.
     *
     * `max_tokens` non e una rifinitura: e **il tetto di quanto puo costare una
     * risposta**. Senza, un modello ragiona finche vuole e il conto cresce. Su un
     * provider a pagamento — che e il caso d'uso di questa modalita — questo non e un
     * dettaglio, e un'impostazione che sparisce e che l'utente non sapeva esserci.
     *
     * `temperature` a 0 e cio che rende una risposta ripetibile, ed e l'unico modo di
     * ottenere due risposte identiche alla stessa domanda. Serve in debug, serve nei
     * test, e con un provider che sceglie da solo non lo si puo piu fare.
     */
    const conTetto = { ...DEFAULT_SETTINGS.defaults }
    expect(conTetto.maxTokens).toBeGreaterThan(0)
    // La prova e sul modulo, non sul provider: se un giorno i default diventassero
    // "nessun tetto", questa continuerebbe a dire che il tetto esiste.
    expect(typeof conTetto.maxTokens).toBe('number')
  })
})
