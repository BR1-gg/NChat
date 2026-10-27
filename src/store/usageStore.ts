/**
 * I consumi, per quello che e' successo davvero.
 *
 * Un record per ogni corsa finita, con i token che il provider ha **dichiarato** e non
 * quelli stimati: la stima `length/4` serve per avvisare prima di partire, e non
 * sopporta un peso in una schermata di spese. Se il provider non manda `usage` il
 * record resta con `tokensKnown: false`, e la somma dice «n token non disponibili»
 * invece di contare zero — altrimenti un provider che non risponde l'uso sembrerebbe
 * identico a un provider che ha risposto a costo zero.
 *
 * Il consumo e' **per app**, non per workspace: la spesa la paga la persona, non il
 * grafo, e dividerla per documento nasconderebbe proprio il numero per cui si guarda
 * questa schermata. Per questo vive in `appState` accanto alle impostazioni e non nel
 * documento.
 */

import { nanoid } from 'nanoid'
import { create } from 'zustand'
import { costOf } from '../logic/pricing'
import { providerSpec, type ProviderId } from '../logic/providers'
import { loadUsageRecords, saveUsageRecords } from '../persistence/storage'
import type { UsageRecord } from '../persistence/schema'

export interface UsageTotals {
  /** Corse che hanno riportato dei token. */
  runs: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** Costo in dollari, o `null` se qualche record ha un prezzo sconosciuto. */
  costUsd: number | null
  /** Corse di cui il prezzo non e' conosciuto, e che quindi non fanno una cifra. */
  unpricedRuns: number
}

const emptyTotals = (): UsageTotals => ({
  runs: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  costUsd: 0,
  unpricedRuns: 0,
})

interface UsageState {
  records: UsageRecord[]
  hydrated: boolean
  add: (record: UsageRecord) => void
  hydrate: (records: UsageRecord[]) => void
  clear: () => void
}

export const useUsageStore = create<UsageState>((set, get) => ({
  records: [],
  hydrated: false,
  add(record) {
    /*
     * Il tetto e' una protezione, non una politica.
     *
     * Il file cresce di un record per corsa e la persistenza e un `set` in IndexedDB:
     * un utente che lavora per ore con la coda piena la riempie, e il giorno dopo il
     * salvataggio si blocca. Non serve la storia infinita per la domanda che questa
     * schermata risponde — «quanto ho speso» — quindi si tiene il piu' recente e si
     * dichiara il troncamento, perche un totale calcolato su una parte dei dati e'
     * peggio di un totale dichiarato come tale.
     */
    const next = [record, ...get().records].slice(0, MAX_RECORDS)
    set({ records: next })
    void saveUsageRecords(next)
  },
  hydrate(records) {
    set({ records, hydrated: true })
  },
  clear() {
    set({ records: [] })
    void saveUsageRecords([])
  },
}))

/**
 * Quanti record tenere.
 *
 * Duemila corse sono ~1000 prompt in una sessione lunga: abbondante per la domanda
 * «quanto ho speso in questa sessione», e abbastanza da non perdere il senso del
 * lavoro di qualche giorno.
 */
export const MAX_RECORDS = 2000

/**
 * Il totale di un insieme di record.
 *
 * `costUsd` diventa `null` se **qualche** record ha un prezzo sconosciuto, perche la
 * somma di metà prezzi noti e metà sconosciuti non e' un totale: e una cifra che
 * sembra completa e sottovaluta. Con quel flag la schermata puo dire "almeno questi
 * dollari, e N corse non hanno prezzo noto", che e' vero e verificabile.
 */
export function totalsOf(
  records: readonly UsageRecord[],
  costFor: (record: UsageRecord) => number | null,
): UsageTotals {
  const totals = emptyTotals()
  for (const record of records) {
    if (!record.tokensKnown) continue
    totals.runs += 1
    totals.promptTokens += record.promptTokens
    totals.completionTokens += record.completionTokens
    totals.totalTokens += record.totalTokens
    const cost = costFor(record)
    if (cost === null) {
      totals.unpricedRuns += 1
      totals.costUsd = null
    } else if (totals.costUsd !== null) {
      totals.costUsd += cost
    }
  }
  return totals
}

/** Il costo di un record, con la tariffa in vigore quando lo si guarda. */
export function currentCost(record: UsageRecord, freeTier = false): number | null {
  return costOf(
    record.provider,
    record.model,
    {
      promptTokens: record.promptTokens,
      completionTokens: record.completionTokens,
    },
    freeTier,
  )
}

/** Il totale di tutti i record, con i prezzi di oggi. */
export function currentTotals(
  records: readonly UsageRecord[],
  freeTier = false,
): UsageTotals {
  return totalsOf(records, (record) => currentCost(record, freeTier))
}

/** Un record nuovo, con i token che il provider ha dichiarato. */
export function makeUsageRecord(input: {
  provider: ProviderId
  model: string
  promptTokens?: number
  completionTokens?: number
  workspaceName?: string
}): UsageRecord {
  const known = typeof input.promptTokens === 'number' && typeof input.completionTokens === 'number'
  return {
    id: nanoid(),
    at: Date.now(),
    provider: input.provider,
    model: input.model,
    // Senza `usage` dal provider si registrano zero ma `tokensKnown: false`, cosi'
    // la somma non confonde "non lo so" con "zero".
    promptTokens: known ? input.promptTokens! : 0,
    completionTokens: known ? input.completionTokens! : 0,
    totalTokens: known ? input.promptTokens! + input.completionTokens! : 0,
    tokensKnown: known,
    ...(input.workspaceName ? { workspaceName: input.workspaceName } : {}),
  }
}

/** I record raggruppati per modello, dal piu' usato. */
export function byModel(records: readonly UsageRecord[]): UsageRecord[][] {
  const groups = new Map<string, UsageRecord[]>()
  for (const record of records) {
    const key = record.model || '(nessun modello)'
    const list = groups.get(key)
    if (list) list.push(record)
    else groups.set(key, [record])
  }
  return [...groups.values()].sort((a, b) => b.length - a.length)
}

/** Il totale di un gruppo di record. */
export function groupTotals(records: readonly UsageRecord[], freeTier = false): UsageTotals {
  return currentTotals(records, freeTier)
}

/** Il nome leggibile di un provider, per le intestazioni. */
export function providerLabel(provider: ProviderId): string {
  return providerSpec(provider).label
}

/** Carica i consumi da disco. Va chiamato una volta all'avvio. */
export function hydrateUsage(): void {
  useUsageStore.getState().hydrate(loadUsageRecords() ?? [])
}
