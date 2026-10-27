/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest'
import { isCloudProvider, isProviderId, PROVIDER_SPECS, providerSpec } from './providers'
import type { ProviderId } from './providers'
// Il sorgente del proxy, letto come testo.
// `?raw` e il modo giusto perche e il sistema di moduli dell'app: `node:fs`
// richiederebbe i tipi di Node, e il `tsconfig` li esclude apposta, perche il
// codice che gira nel browser non deve poter usarli. Aggiungerli qui ha rotto
// ogni `setTimeout` del progetto, il che dice da solo che la strada giusta e
// questa.
import proxySource from '../../tools/cloud-proxy.mjs?raw'

/**
 * Il catalogo dei provider.
 *
 * Il punto delicato e che l'app e il proxy hanno due elenchi di provider, e
 * devono restare uguali. Se l'app offre un provider che il proxy non instrada,
 * la scelta va a vuoto; se il proxy ne instrada uno che l'app non offre, nessuno
 * lo usa. Il test in fondo confronta i due file perche sono due file.
 */

/** Gli id che il proxy sa instradare, presi dal proxy stesso. */
function proxyProviderIds(): string[] {
  const block = proxySource.match(/export const PROVIDERS = \{([\s\S]*?)\n\}/)
  if (!block?.[1]) throw new Error('PROVIDERS not found in the proxy')
  return [...block[1].matchAll(/^\s{2}([a-z]+):/gm)].map((match) => match[1] as string)
}

describe('provider catalogue', () => {
  it('offers LM Studio first, and it is the default', () => {
    // E su quello che questa app e stata costruita. Passare a un provider in
    // cloud deve essere una scelta, non quello che capita al primo avvio.
    expect(PROVIDER_SPECS[0]?.id).toBe('lmstudio')
  })

  it('offers this machine plus the cloud providers that speak OpenAI', () => {
    /*
     * Non c'e una voce "qualunque servizio OpenAI-compatible": sarebbe una promessa
     * che questo progetto non puo onorare, perche' l'indirizzo sarebbe scritto
     * dall'utente e l'app non potrebbe verificarlo.
     *
     * Quelli che ci sono, invece, sono servizi **verificati**, ognuno con un indirizzo
     * che e stato letto e non indovinato. Ogni voce porta con se un indirizzo da
     * mantenere e una chiave da gestire, quindi l'elenco e chiuso e questo test e' la
     * prova che aggiungerne uno sia una decisione e non un dimenticanza.
     */
    const ids = PROVIDER_SPECS.map((spec) => spec.id)
    expect(ids).toEqual([
      'lmstudio',
      'nvidia',
      'google',
      'openai',
      'anthropic',
      'groq',
      'mistral',
      'deepseek',
      'xai',
      'openrouter',
      'together',
      'cerebras',
      'fireworks',
    ])
  })

  it('gives every cloud provider an address the proxy knows', () => {
    /*
     * Il test che conta di piu' quando se ne aggiunge uno. Il catalogo dell'app e la
     * tabella degli indirizzi nel proxy sono due elenchi in due file, e senza questo
     * possono divergere: l'app offre un provider, il proxy risponde 404 su
     * `unknown provider`, e la scelta va a vuoto senza che nessun errore lo dica.
     */
    expect(PROVIDER_SPECS.filter((spec) => isCloudProvider(spec.id)).map((spec) => spec.id).sort())
      .toEqual(proxyProviderIds().sort())
  })

  it('gives every cloud provider a page to get a key on', () => {
    /*
     * Una voce senza `keysUrl` chiede una chiave che l'utente non sa dove prendere.
     * Il campo e' opzionale solo perche' il provider locale non ne usa, quindi la
     * verifica riguarda i provider in cloud e non tutti.
     */
    for (const spec of PROVIDER_SPECS) {
      if (!isCloudProvider(spec.id)) continue
      expect(spec.keysUrl, spec.id).toMatch(/^https:\/\//)
    }
  })

  it('agrees with the proxy on which providers exist', () => {
    // La parte che non si vede finche non si sceglie un provider a caso. Se
    // l'app offre un provider che il proxy non instrada, la scelta va a vuoto.
    const app = PROVIDER_SPECS.filter((spec) => isCloudProvider(spec.id)).map((spec) => spec.id)
    expect(app.sort()).toEqual(proxyProviderIds().sort())
  })

  it('needs no key for LM Studio and one for the cloud ones', () => {
    for (const spec of PROVIDER_SPECS) {
      expect(spec.needsKey, spec.id).toBe(spec.id !== 'lmstudio')
    }
  })

  it('says where the key comes from, for every provider that needs one', () => {
    // Un campo per la chiave senza un posto dove prenderla e un muro.
    for (const spec of PROVIDER_SPECS) {
      if (!spec.needsKey) continue
      expect(spec.keysUrl, spec.id).toMatch(/^https:\/\//)
    }
  })

  it('needs no written address from anyone, because both providers have one', () => {
    for (const spec of PROVIDER_SPECS) {
      expect(spec.needsBaseUrl, spec.id).toBe(false)
    }
  })

  it('writes one line for every provider, because a dropdown with no text is a guess', () => {
    for (const spec of PROVIDER_SPECS) {
      expect(spec.label.trim().length, spec.id).toBeGreaterThan(0)
      expect(spec.blurb.trim().length, spec.id).toBeGreaterThan(10)
    }
  })

  it('never claims a vision capability it cannot know', () => {
    // "Chiedere" e una risposta onesta: e il modello a sapere se legge immagini,
    // non il provider. Dichiararlo e inventare una capacita.
    for (const spec of PROVIDER_SPECS) {
      expect(['yes', 'no', 'ask'], spec.id).toContain(spec.vision)
    }
    expect(providerSpec('nvidia').vision).toBe('ask')
    // Google e "ask" anche se Gemini legge immagini: il servizio mescola modelli con
    // e senza visione, quindi dichiarare "yes" direbbe all'utente che puo mandare
    // un'immagine a un modello che la rifiuta, e l'errore arriverebbe come un blocco
    // invece che come una scelta.
    expect(providerSpec('google').vision).toBe('ask')
  })

  it('knows the Brain is local-only, and says so in the spec', () => {
    // Il Brain scrive file davvero e manda il contenuto delle cartelle a un
    // modello. Mandare il contenuto di una cartella a un servizio di terzi e una
    // decisione che l'utente non ha preso scegliendo un provider cloud.
    for (const spec of PROVIDER_SPECS) {
      expect(spec.brain, spec.id).toBe('local-only')
    }
  })
})

describe('isCloudProvider', () => {
  it('is false only for LM Studio', () => {
    expect(isCloudProvider('lmstudio')).toBe(false)
    expect(isCloudProvider('nvidia')).toBe(true)
    expect(isCloudProvider('google')).toBe(true)
  })
  it('narrows the type, so a proxy URL needs no cast', () => {
    const id: ProviderId = 'nvidia'
    if (isCloudProvider(id)) {
      // Il punto: dopo il controllo, `id` non e piu `ProviderId` generico.
      expect(`/p/${id}`).toBe('/p/nvidia')
    }
  })
})

describe('isProviderId', () => {
  it('accepts only what is in the catalogue', () => {
    for (const spec of PROVIDER_SPECS) {
      expect(isProviderId(spec.id), spec.id).toBe(true)
    }
  })

  it('refuses anything else, so a hand-edited file cannot aim the app', () => {
    // Il buco che questo chiude: un documento importato a mano con
    // `provider: "http://mio-indirizzo"` non deve poter diventare una destinazione.
    for (const value of ['attaccante', '', 'LMSTUDIO', 42, null, undefined, {}, ['groq'], 'github']) {
      expect(isProviderId(value), String(value)).toBe(false)
    }
  })
})

describe('providerSpec', () => {
  it('falls back to LM Studio for an id it does not know', () => {
    // Il fallback e il default e non un caso sparso: il tipo garantisce che non
    // arrivi qui, ma un fallback esplicito e meglio di un'eccezione in un render.
    expect(providerSpec('inesistente' as ProviderId).id).toBe('lmstudio')
  })
})
