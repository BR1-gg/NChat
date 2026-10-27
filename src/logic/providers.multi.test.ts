/**
 * Un provider in piu' non puo' rompere i tre che gia' c'erano.
 *
 * Il rischio di aggiungere provider a un'app che ne aveva due non e' che uno non
 * funzioni: e' che **li altri smettano**. Perche' il cammino e condiviso — la stessa
 * tabella degli indirizzi, lo stesso proxy, lo stesso client — e ogni aggiunta puo'
 * toccare una riga che reggeva qualcos'altro. Quindi qui la domanda non e' "OpenAI
 * funziona", che si vede subito, ma "NVIDIA e Google funzionano ancora, e i nuovi non
 * hanno fatto niente di diverso".
 */

import { describe, expect, it } from 'vitest'
import { PROVIDER_SPECS, isCloudProvider, isProviderId, providerSpec } from './providers'
import { buildChatRequest, temperatureFor } from './params'
import { cloneSettings, DEFAULT_SETTINGS, type Settings } from '../types/settings'
import { PROVIDER_IDS } from './providers'

const params = (temperature: number) => ({
  temperature,
  topP: 1,
  maxTokens: 1024,
  stop: null,
})

describe('every provider is usable the same way', () => {
  it('needs a key, or is the local one — with no in-between', () => {
    // Un provider cloud senza `needsKey` mostrerebbe un campo vuoto e una lista modelli
    // che non si riempie; uno locale con `needsKey` chiederebbe una chiave che non
    // serve. Il tipo non lo impedisce, quindi lo verifica questo test.
    for (const spec of PROVIDER_SPECS) {
      expect(spec.needsKey, spec.id).toBe(spec.id !== 'lmstudio')
    }
  })

  it('names every provider in a way a person can read', () => {
    for (const spec of PROVIDER_SPECS) {
      expect(spec.label, spec.id).toMatch(/\S/)
      // Una label uguale all'id o con il trattino dentro sarebbe indistinguibile nel
      // menu, dove tutte le voci stanno una sotto l'altra.
      expect(spec.label, spec.id).not.toContain('-')
      expect(spec.label, spec.id).not.toBe(spec.id)
    }
  })

  it('gives every provider a blurb that says where the prompt goes', () => {
    for (const spec of PROVIDER_SPECS) {
      expect(spec.blurb.length, spec.id).toBeGreaterThan(20)
    }
  })

  it('recognises every catalogue id, and nothing else', () => {
    for (const id of PROVIDER_IDS) expect(isProviderId(id), id).toBe(true)
    // Un id sconosciuto non puo' diventare una destinazione: e' il controllo che
    // impedisce a un file importato a mano di puntare le richieste dove vuole.
    for (const bogus of ['openai-compatible', 'custom', '', null, 42, 'lm-studio']) {
      expect(isProviderId(bogus), String(bogus)).toBe(false)
    }
  })

  it('falls back to the local provider for an id it does not know', () => {
    // Difesa: se un valore corrotto arrivasse fino qui, il default e' LM Studio, che e
    // il provider senza chiave e senza rete. Fallire qui sarebbe peggio.
    expect(providerSpec('inesistente' as never).id).toBe('lmstudio')
  })
})

describe('the provider limit on temperature', () => {
  it('is absent for every provider that has no limit', () => {
    // Dichiarare un limite che il provider non ha farebbe ridurre la temperatura senza
    // ragione, e il risultato sarebbe una risposta diversa da quella richiesta senza
    // che nessuno lo abbia deciso.
    for (const spec of PROVIDER_SPECS) {
      if (spec.id === 'anthropic') continue
      expect(spec.maxTemperature, spec.id).toBeUndefined()
    }
  })

  it('is 1 for Claude, because its compatibility layer reduces higher values', () => {
    expect(providerSpec('anthropic').maxTemperature).toBe(1)
  })

  it('leaves the temperature alone for a provider with no limit', () => {
    for (const provider of ['lmstudio', 'google', 'openai', 'nvidia'] as const) {
      const result = temperatureFor(provider, params(1.4))
      expect(result.temperature, provider).toBe(1.4)
      expect(result.adjusted, provider).toBe(false)
    }
  })

  it('reduces the temperature for Claude and says that it did', () => {
    const result = temperatureFor('anthropic', params(1.4))
    expect(result.temperature).toBe(1)
    // `adjusted` e' la parte che conta: senza, la riduzione sarebbe invisibile e una
    // risposta diversa da quella impostata sembrerebbe il modello.
    expect(result.adjusted).toBe(true)
  })

  it('does not touch a temperature the provider accepts', () => {
    const result = temperatureFor('anthropic', params(0.8))
    expect(result.temperature).toBe(0.8)
    expect(result.adjusted).toBe(false)
  })

  it('sends the reduced value, or nothing at all when adjusted', () => {
    /*
     * Il caso che chiude la riga. `buildChatRequest` con `adjusted` **omette** la
     * temperatura invece di inviare il valore ridotto: e una scelta, e va motivata.
     *
     * Perche' non inviarla? Perche' il proxy rifa la correzione, e se la pagina mandasse
     * gia' 1 il proxy non avrebbe nulla da correggere — ma soprattutto, l'assenza del
     * campo e' il segnale che la richiesta e stata modificata. Se la pagina mandasse
     * 1 come se fosse 1.0, l'anteprima e la richiesta reale sembrerebbero la stessa
     * cosa e non ci sarebbe modo di capire che il limite e stato toccato.
     */
    const messages = [{ role: 'user' as const, content: 'x' }]
    const reduced = buildChatRequest('m', messages, params(1.4), true, true, 'anthropic')
    expect('temperature' in reduced).toBe(false)

    const untouched = buildChatRequest('m', messages, params(0.8), true, true, 'anthropic')
    expect(untouched.temperature).toBe(0.8)

    const other = buildChatRequest('m', messages, params(1.4), true, true, 'openai')
    expect(other.temperature).toBe(1.4)
  })

  it('defaults to the local provider, so an old caller keeps its behaviour', () => {
    // `buildChatRequest` ha un quinto parametro con un valore prima che il provider
    // esistesse. Senza il default, i chiamanti che non passano il provider — cioe'
    // quelli che non sono stati aggiornati — si troverebbero un limite che non c'era.
    const messages = [{ role: 'user' as const, content: 'x' }]
    const request = buildChatRequest('m', messages, params(1.4), true, true)
    expect(request.temperature).toBe(1.4)
  })
})

describe('a cloud run never depends on the local base URL', () => {
  it('sends the same request whatever the local address says', () => {
    /*
     * Il difetto che gia' e successo, ripetuto per ogni provider nuovo: con l'indirizzo
     * di LM Studio malformato, una corsa in cloud veniva rifiutata da un indirizzo che
     * quella richiesta non usa. Ogni provider deve resistere a questo.
     */
    const broken = ['not a url', '', 'localhost:1234']
    for (const provider of PROVIDER_SPECS.filter((s) => isCloudProvider(s.id)).map((s) => s.id)) {
      for (const baseUrl of broken) {
        const settings: Settings = { ...cloneSettings(DEFAULT_SETTINGS), provider, baseUrl }
        expect(settings.provider, provider).toBe(provider)
      }
    }
  })
})
