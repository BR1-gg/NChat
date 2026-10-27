/**
 * Il totale dei consumi deve sapere quando non e' un totale.
 *
 * Il caso che questi test chiudono e' silenzioso e quindi pericoloso: un provider che
 * non rimanda `usage` nella risposta produce zero token, e senza il flag
 * `tokensKnown` finirebbe sommato come una corsa da zero dollari. La schermata
 * direbbe «$0.00» e l'utente prenderebbe per misurata una spesa che nessuno ha
 * misurato. Peggio: NVIDIA non pubblica prezzi, e la somma di token noti con prezzi
 * sconosciuti non e' un totale ma sembra un totale.
 */

import { describe, expect, it } from 'vitest'
import { UsageRecordSchema } from '../persistence/schema'
import { byModel, currentTotals, makeUsageRecord } from './usageStore'

function record(
  input: Partial<ReturnType<typeof makeUsageRecord>> = {},
): ReturnType<typeof makeUsageRecord> {
  return makeUsageRecord({
    provider: 'google',
    model: 'gemini-2.5-flash',
    promptTokens: 1000,
    completionTokens: 500,
    ...input,
  })
}

describe('makeUsageRecord', () => {
  it('marks a run without usage as unknown, not as zero', () => {
    /*
     * Il campo `tokensKnown` e l'unica differenza fra «non ha consumato niente» e
     * «non lo so». Senza di esso la somma non potrebbe distinguerle.
     */
    const unknown = record({ promptTokens: undefined, completionTokens: undefined })
    expect(unknown.tokensKnown).toBe(false)
    expect(unknown.totalTokens).toBe(0)
  })

  it('adds up a run whose usage the provider reported', () => {
    const known = record()
    expect(known.tokensKnown).toBe(true)
    expect(known.totalTokens).toBe(1500)
  })

  it('survives the persistence schema round trip', () => {
    const parsed = UsageRecordSchema.parse(record())
    expect(parsed.id).toBeTruthy()
    expect(parsed.provider).toBe('google')
    expect(parsed.tokensKnown).toBe(true)
  })
})

describe('currentTotals', () => {
  it('sums tokens and cost across runs', () => {
    const totals = currentTotals([record(), record(), record()])
    expect(totals.runs).toBe(3)
    expect(totals.promptTokens).toBe(3000)
    expect(totals.completionTokens).toBe(1500)
    expect(totals.totalTokens).toBe(4500)
    expect(totals.costUsd).not.toBeNull()
  })

  it('leaves out runs with unknown tokens instead of counting them as free', () => {
    const totals = currentTotals([
      record(),
      record({ promptTokens: undefined, completionTokens: undefined }),
      record(),
    ])
    expect(totals.runs).toBe(2)
    expect(totals.totalTokens).toBe(3000)
  })

  it('reports no total at all when one run has no published price', () => {
    /*
     * La meta' dei prezzi noti e la meta' sconosciuti non fa una cifra: fa un
     * numero che sembra completo e sottovaluta. Quindi `costUsd` diventa `null` e
     * l'interfaccia puo' dire «almeno questi dollari, e N corse senza prezzo».
     */
    const totals = currentTotals([
      record(),
      record({ provider: 'nvidia', model: 'meta/llama-3.3-70b-instruct' }),
    ])
    expect(totals.costUsd).toBeNull()
    expect(totals.unpricedRuns).toBe(1)
    // I token invece sono esatti e disponibili: sono un fatto, non una stima.
    expect(totals.totalTokens).toBe(3000)
  })

  it('is zero for a local provider, and says so rather than going blank', () => {
    const totals = currentTotals([record({ provider: 'lmstudio', model: 'qwen3-8b' })])
    expect(totals.costUsd).toBe(0)
    expect(totals.unpricedRuns).toBe(0)
  })

  it('drops the cost but keeps the tokens on a free tier', () => {
    /*
     * Sul piano gratuito non si paga, ma i token sono stati usati lo stesso. Azzerare
     * anche quelli nasconderebbe l'unico fatto che resta, e la schermata diventerebbe
     * una pagina vuota su un account che funziona benissimo.
     */
    const paid = currentTotals([record()], false)
    const free = currentTotals([record()], true)
    expect(paid.costUsd).toBeGreaterThan(0)
    expect(free.costUsd).toBe(0)
    expect(free.totalTokens).toBe(paid.totalTokens)
  })

  it('is empty, not null, with no runs at all', () => {
    const totals = currentTotals([])
    expect(totals.runs).toBe(0)
    expect(totals.totalTokens).toBe(0)
    // Zero corse conoscono il prezzo, quindi zero e' qui la risposta vera.
    expect(totals.costUsd).toBe(0)
  })
})

describe('byModel', () => {
  it('groups by model and orders by how often each was used', () => {
    const groups = byModel([
      record({ model: 'a' }),
      record({ model: 'b' }),
      record({ model: 'b' }),
      record({ model: 'b' }),
    ])
    expect(groups.map((group) => group[0]?.model)).toEqual(['b', 'a'])
  })

  it('gives each group its own total', () => {
    const [group] = byModel([record(), record()])
    expect(group).toBeDefined()
    const totals = currentTotals(group!)
    expect(totals.runs).toBe(2)
    expect(totals.totalTokens).toBe(3000)
  })
})
