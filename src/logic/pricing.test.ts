/**
 * I prezzi devono dire la verita anche quando non la sanno.
 *
 * Il rischio di questo modulo non e' un calcolo sbagliato: e' un numero che sembra
 * giusto e non lo e'. Le tre regole che i test qui sotto bloccano sono le uniche cose
 * che separano «quanto ho speso» da «quanto penso di aver speso»:
 *
 * 1. un provider senza prezzo pubblicato non diventa `0` ma `null`;
 * 2. un modello locale costa `0` perche' non ha fattura, non perche' non lo sappiamo;
 * 3. il piano gratuito e' una scelta dell'utente, e con quello la spesa e' zero **ma i
 *    token restano quelli veri** — azzerare anche quelli sarebbe un secondo difetto.
 */

import { describe, expect, it } from 'vitest'
import { contextWindowFor, costOf, formatCost, priceFor } from './pricing'

describe('priceFor', () => {
  it('knows a Google model', () => {
    expect(priceFor('google', 'gemini-2.5-flash')).toEqual({
      inputPerMillion: 0.3,
      outputPerMillion: 2.5,
    })
  })

  it('matches on a prefix, not on an exact id', () => {
    // `/models` porta forme diverse dello stesso modello, e una tabella per
    // corrispondenza esatta mancerebbe meta' dei casi proprio quelli in uso.
    expect(priceFor('google', 'models/gemini-2.5-flash')).not.toBeNull()
    expect(priceFor('google', 'Gemini-2.5-Flash')).not.toBeNull()
    expect(priceFor('google', 'gemini-2.5-flash-preview')).not.toBeNull()
  })

  it('picks the more specific match, so flash-lite is not priced as flash', () => {
    /*
     * `gemini-3.5-flash-lite` contiene `gemini-3.5-flash` come prefisso. Con
     * l'aggancio al primo elemento trovato il modello economico avrebbe preso il
     * prezzo del modello costoso: un errore di 5x, e verso l'alto, che e' la
     * direzione in cui fa male.
     */
    const lite = priceFor('google', 'gemini-3.5-flash-lite')
    const full = priceFor('google', 'gemini-3.5-flash')
    expect(lite).not.toEqual(full)
    expect(lite?.outputPerMillion).toBeLessThan(full!.outputPerMillion)
  })

  it('does not invent a price for a model it has never heard of', () => {
    expect(priceFor('google', 'gemini-99-ultra-imaginary')).toBeNull()
  })

  it('has no price at all for NVIDIA, because none is published', () => {
    /*
     * Il catalogo ospitato di build.nvidia.com non pubblica un prezzo per token.
     * Un numero qui sarebbe inventato, e un numero inventato in una schermata di
     * spese e peggio di un campo vuoto.
     */
    for (const model of [
      'meta/llama-3.3-70b-instruct',
      'deepseek-ai/deepseek-r1',
      'qwen/qwen3-coder-480b-a35b-instruct',
    ]) {
      expect(priceFor('nvidia', model), model).toBeNull()
    }
  })

  it('has no price for a local model, because there is no bill', () => {
    expect(priceFor('lmstudio', 'qwen3-8b')).toBeNull()
  })
})

describe('costOf', () => {
  it('is exactly zero for a local model, and not null', () => {
    /*
     * L'unico caso in cui `0` e' la risposta giusta: qui la spesa non esiste, e
     * `null` direbbe "non lo so", che su un modello in locale sarebbe falso.
     */
    const cost = costOf('lmstudio', 'qwen3-8b', { promptTokens: 1_000_000, completionTokens: 1_000_000 })
    expect(cost).toBe(0)
  })

  it('is null for NVIDIA, so a total never silently becomes zero', () => {
    const cost = costOf('nvidia', 'meta/llama-3.3-70b-instruct', {
      promptTokens: 10_000,
      completionTokens: 2_000,
    })
    expect(cost).toBeNull()
  })

  it('adds input and output at their own rates', () => {
    // 1M input at 0.30 + 1M output at 2.50
    const cost = costOf('google', 'gemini-2.5-flash', {
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
    })
    expect(cost).toBeCloseTo(2.8, 6)
  })

  it('scales with the tokens actually used', () => {
    const cost = costOf('google', 'gemini-2.5-flash', {
      promptTokens: 10_000,
      completionTokens: 1_000,
    })
    expect(cost).toBeCloseTo(0.003 + 0.0025, 8)
  })

  it('charges the long-context rate only past the threshold, on the prompt', () => {
    const short = costOf('google', 'gemini-2.5-pro', {
      promptTokens: 100_000,
      completionTokens: 1_000,
    })
    const long = costOf('google', 'gemini-2.5-pro', {
      promptTokens: 300_000,
      completionTokens: 1_000,
    })
    /*
     * Sotto soglia l'input vale 1.25/M e l'output 10/M; sopra, 2.50/M e 15/M.
     * Entrambe le tariffe sono nella tabella, quindi il raddoppio dell'input e il
     * maggioramento dell'output vengono entrambi da li' e non da un trucco qui.
     */
    expect(short).toBeCloseTo((100_000 / 1e6) * 1.25 + (1_000 / 1e6) * 10, 8)
    expect(long).toBeCloseTo((300_000 / 1e6) * 2.5 + (1_000 / 1e6) * 15, 8)
  })

  it('decides the long-context rate on the prompt, not on the total', () => {
    /*
     * La soglia conta i token che il provider vede **arrivare**. Un output enorme con
     * un prompt piccolo resta una richiesta corta, quindi non puo' far scattare la
     * tariffa lunga: e cosi' che la funzione confronta `promptTokens` e non
     * `promptTokens + completionTokens`.
     */
    const cost = costOf('google', 'gemini-2.5-pro', {
      promptTokens: 1_000,
      completionTokens: 500_000,
    })
    expect(cost).toBeCloseTo((1_000 / 1e6) * 1.25 + (500_000 / 1e6) * 10, 8)
  })

  it('is zero on a free tier, whatever the list price is', () => {
    expect(
      costOf('google', 'gemini-2.5-pro', { promptTokens: 500_000, completionTokens: 50_000 }, true),
    ).toBe(0)
  })
})

describe('contextWindowFor', () => {
  it('knows the window of a published model', () => {
    expect(contextWindowFor('google', 'gemini-2.5-pro')).toBe(1_000_000)
  })

  it('is null for a model it does not know, rather than a guess', () => {
    // Un tetto inventato produrrebbe un avviso di "contesto pieno" che non esiste.
    expect(contextWindowFor('google', 'gemini-99-imaginary')).toBeNull()
    expect(contextWindowFor('nvidia', 'meta/llama-3.3-70b-instruct')).toBeNull()
    expect(contextWindowFor('lmstudio', 'qwen3-8b')).toBeNull()
  })
})

describe('formatCost', () => {
  it('never rounds a real cost down to $0.00', () => {
    // Sotto il centesimo, due decimali mostrerebbero "$0.00" anche spendendo soldi,
    // e un utente che vede zero smette di guardare.
    expect(formatCost(0.0004)).not.toBe('$0.00')
    expect(formatCost(0)).toBe('$0.00')
  })

  it('says plainly when there is no price', () => {
    expect(formatCost(null)).toBe('price not published')
  })
})
