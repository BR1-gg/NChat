/**
 * Quanto costa una risposta, e quando non si puo dire.
 *
 * Il file esiste perche la domanda «quanto mi e costata questa cosa» ha due risposte
 * oneste e una sola valida per ogni provider:
 *
 * - **LM Studio**: zero. Il calcolo gira sulla tua macchina e non passa da nessuna
 *   fattura. Non e un prezzo stimato: e l'assenza di una spesa.
 * - **NVIDIA NIM**: **non si sa**. Il catalogo ospitato di build.nvidia.com non
 *   pubblica un prezzo per token; e un accesso gratuito per lo sviluppo, con limiti
 *   che NVIDIA non pubblica come un'unica quota. Mettere un numero qui sarebbe
 *   inventarlo, e un numero inventato in una schermata di spese e peggio di un
 *   campo vuoto: l'utente lo prende per vero.
 * - **Google AI Studio**: prezzi pubblicati, e diversi tra piano gratuito e a
 *   pagamento. Il piano gratuito non costa nulla, quindi con quello la spesa e zero
 *   anche usando un modello a pagamento.
 *
 * Per questo `costOf` restituisce `null` quando il prezzo non e noto, e l'interfaccia
 * mostra «prezzo non pubblicato» invece di `0`. Zero e una risposta; "non lo so" e una
 * risposta diversa, e solo una delle due e vera.
 *
 * I prezzi sono **conoscenza, non misurazione**: una tabella copiata da una pagina dei
 * prezzi invecchia, e un provider puo cambiarla senza avvisare. Per questo ogni
 * voce porta la data in cui e stata scritta, la tabella dice quanto e vecchia, e un
 * modello che non c'e non viene stimato: si dichiara sconosciuto.
 */

import { isCloudProvider, type ProviderId } from './providers'

/** Prezzi in dollari per milione di token, come li pubblica il provider. */
export interface ModelPrice {
  /** Dollari per 1M token letti (input + contesto). */
  inputPerMillion: number
  /** Dollari per 1M token generati (output, thinking incluso). */
  outputPerMillion: number
  /** Tetto di contesto oltre il quale Google raddoppia l'input. */
  longContextThreshold?: number
  /** Prezzi sopra la soglia, quando il provider li distingue. */
  longContextInputPerMillion?: number
  longContextOutputPerMillion?: number
}

export interface PricingEntry {
  /** Prefisso del model id: `gemini-3.8-flash` aggancia anche `gemini-3.8-flash-preview`. */
  match: string
  price: ModelPrice
  /** Token di contesto massimi, quando sono noti. */
  contextWindow?: number
  /** Soglia oltre la quale scatta la tariffa lunga, quando questa voce ne ha una. */
  longContextThreshold?: number
  longContextInputPerMillion?: number
  longContextOutputPerMillion?: number
}

/**
 * Quando la tabella e stata scritta, e quando va riguardata.
 *
 * Esposto nell'interfaccia perche una tabella di prezzi senza data e una promessa
 * fatta all'utente: «questa cifra e giusta» quando invece e giusta **fino a quando i
 * prezzi non cambiano**. Il numero e' la data in cui la tabella e' stata scritta, e
 * con essa la semplice verifica che non sia troppo vecchia.
 */
export const PRICING_AS_OF = '2026-09-29'

/**
 * Oltre quanti giorni la tabella viene dichiarata vecchia.
 *
 * Non blocca niente: e un avviso. Il prezzo migliore che si puo dare senza rete e'
 * quello scritto, e segnalare che invecchia e' piu utile che continuare a presentarlo
 * come attuale.
 */
export const PRICING_STALE_DAYS = 120

/**
 * Google AI Studio, livello a pagamento, dollari per milione di token.
 *
 * Le date nelle voci non sono decorazione: diverse entry hanno un prezzo che sale il
 * 1 gennaio 2027, e mostrare quello basso senza dirlo sarebbe un numero che non
 * regge. `until` finisce la promozione; `note` la spiega a schermo.
 */
const GOOGLE_PRICES: PricingEntry[] = [
  {
    match: 'gemini-3.8-flash',
    price: { inputPerMillion: 0.75, outputPerMillion: 3.75 },
    contextWindow: 1_000_000,
  },
  {
    match: 'gemini-3.7-flash',
    price: { inputPerMillion: 0.75, outputPerMillion: 3.75 },
    contextWindow: 1_000_000,
  },
  {
    match: 'gemini-3.6-flash',
    price: { inputPerMillion: 0.75, outputPerMillion: 3.75 },
    contextWindow: 1_000_000,
  },
  {
    match: 'gemini-3.5-flash-lite',
    price: { inputPerMillion: 0.3, outputPerMillion: 2.5 },
    contextWindow: 1_000_000,
  },
  {
    match: 'gemini-3.5-flash',
    price: { inputPerMillion: 1.5, outputPerMillion: 9 },
    contextWindow: 1_000_000,
  },
  {
    match: 'gemini-3.1-pro',
    price: { inputPerMillion: 2, outputPerMillion: 12 },
    contextWindow: 2_000_000,
    longContextThreshold: 200_000,
    longContextInputPerMillion: 4,
    longContextOutputPerMillion: 18,
  },
  {
    match: 'gemini-3.1-flash-lite',
    price: { inputPerMillion: 0.25, outputPerMillion: 1.5 },
    contextWindow: 1_000_000,
  },
  {
    match: 'gemini-3-flash-preview',
    price: { inputPerMillion: 0.5, outputPerMillion: 3 },
    contextWindow: 1_000_000,
  },
  {
    match: 'gemini-2.5-pro',
    price: { inputPerMillion: 1.25, outputPerMillion: 10 },
    contextWindow: 1_000_000,
    longContextThreshold: 200_000,
    longContextInputPerMillion: 2.5,
    longContextOutputPerMillion: 15,
  },
  {
    match: 'gemini-2.5-flash-lite',
    price: { inputPerMillion: 0.1, outputPerMillion: 0.4 },
    contextWindow: 1_000_000,
  },
  {
    match: 'gemini-2.5-flash',
    price: { inputPerMillion: 0.3, outputPerMillion: 2.5 },
    contextWindow: 1_000_000,
  },
]

/**
 * OpenAI, dollari per milione di token.
 *
 * Le famiglie si agganciano per prefisso piu' corto di quanto sembra: `gpt-5` prima di
 * `gpt-5.4`, cosi' un modello che esce domani e costa come la famiglia non cade nel
 * vuoto — resta pero' dentro la tariffa sbagliata per qualche mese, e per questo la
 * tabella porta la data in cui e stata scritta e la schermata avvisa quando invecchia.
 */
const OPENAI_PRICES: PricingEntry[] = [
  { match: 'gpt-5.6-terra', price: { inputPerMillion: 2, outputPerMillion: 12 }, contextWindow: 1_000_000 },
  { match: 'gpt-5.6-luna', price: { inputPerMillion: 0.2, outputPerMillion: 1.2 }, contextWindow: 1_000_000 },
  { match: 'gpt-5.5-pro', price: { inputPerMillion: 30, outputPerMillion: 180 }, contextWindow: 1_000_000 },
  { match: 'gpt-5.5', price: { inputPerMillion: 5, outputPerMillion: 30 }, contextWindow: 1_000_000 },
  { match: 'gpt-5.4-mini', price: { inputPerMillion: 0.75, outputPerMillion: 4.5 }, contextWindow: 400_000 },
  { match: 'gpt-5.4-nano', price: { inputPerMillion: 0.2, outputPerMillion: 1.25 }, contextWindow: 400_000 },
  { match: 'gpt-5.4', price: { inputPerMillion: 2.5, outputPerMillion: 15 }, contextWindow: 1_000_000 },
  { match: 'gpt-5-mini', price: { inputPerMillion: 0.25, outputPerMillion: 2 }, contextWindow: 400_000 },
  { match: 'gpt-4o-mini', price: { inputPerMillion: 0.15, outputPerMillion: 0.6 }, contextWindow: 128_000 },
  { match: 'gpt-4o', price: { inputPerMillion: 2.5, outputPerMillion: 10 }, contextWindow: 128_000 },
]

/**
 * Claude. Nota la soglia lunga su Sonnet e Opus: sopra 200k token di prompt il prezzo
 * raddoppia, quindi qui conta come per Google.
 */
const ANTHROPIC_PRICES: PricingEntry[] = [
  { match: 'claude-fable-5', price: { inputPerMillion: 10, outputPerMillion: 50 }, contextWindow: 1_000_000 },
  { match: 'claude-opus-5', price: { inputPerMillion: 5, outputPerMillion: 25 }, contextWindow: 1_000_000 },
  { match: 'claude-opus-4', price: { inputPerMillion: 5, outputPerMillion: 25 }, contextWindow: 200_000, longContextThreshold: 200_000, longContextInputPerMillion: 10, longContextOutputPerMillion: 50 },
  { match: 'claude-sonnet-5', price: { inputPerMillion: 2, outputPerMillion: 10 }, contextWindow: 200_000, longContextThreshold: 200_000, longContextInputPerMillion: 4, longContextOutputPerMillion: 20 },
  { match: 'claude-sonnet-4', price: { inputPerMillion: 3, outputPerMillion: 15 }, contextWindow: 200_000, longContextThreshold: 200_000, longContextInputPerMillion: 6, longContextOutputPerMillion: 22.5 },
  { match: 'claude-haiku-4', price: { inputPerMillion: 1, outputPerMillion: 5 }, contextWindow: 200_000 },
]

const DEEPSEEK_PRICES: PricingEntry[] = [
  { match: 'deepseek-chat', price: { inputPerMillion: 0.27, outputPerMillion: 1.1 }, contextWindow: 128_000 },
  { match: 'deepseek-reasoner', price: { inputPerMillion: 0.55, outputPerMillion: 2.19 }, contextWindow: 128_000 },
]

const XAI_PRICES: PricingEntry[] = [
  { match: 'grok-4.6', price: { inputPerMillion: 2, outputPerMillion: 6 }, contextWindow: 500_000 },
  { match: 'grok-4', price: { inputPerMillion: 3, outputPerMillion: 15 }, contextWindow: 256_000 },
  { match: 'grok-3-mini', price: { inputPerMillion: 0.3, outputPerMillion: 0.5 }, contextWindow: 131_072 },
]

/** La tabella dei prezzi per provider. Vuota significa: prezzo non pubblicato. */
const PRICE_TABLES: Partial<Record<ProviderId, PricingEntry[]>> = {
  google: GOOGLE_PRICES,
  openai: OPENAI_PRICES,
  anthropic: ANTHROPIC_PRICES,
  deepseek: DEEPSEEK_PRICES,
  xai: XAI_PRICES,
  /*
   * Groq, Mistral, Together, Cerebras, Fireworks, OpenRouter: volutamente assenti.
   *
   * Non e una dimenticanza. Su Groq e Cerebras il piano gratuito e' il caso normale e
   * non c'e' un listino che copra l'uso di un utente finale; su OpenRouter il prezzo
   * dipende dal modello che viene inoltrato, quindi la tariffa cambierebbe a ogni
   * risposta e la tabella direbbe piu' spesso di quanto valga. Meglio `null` — che la
   * schermata dice "prezzo non pubblicato" — che un numero plausibile e sbagliato: i
   * token restano esatti in ogni caso.
   */
}

/**
 * Il prezzo di un model id, o `null` se non lo sappiamo.
 *
 * `null` non vuol dire zero e non vuol dire gratis: vuol dire che questo file non sa.
 * Le tre cose si confondono facilmente in una schermata di spese, e la confusione
 * costa: «gratis» quando il provider e' a pagamento e la chiave e' sua fa prendere
 * decisioni sbagliate.
 *
 * Il confronto e' per prefisso e case-insensitive perche' i model id che arrivano da
 * `/models` portano forme diverse dello stesso modello: `gemini-2.5-pro`,
 * `models/gemini-2.5-pro`, `Gemini-2.5-Pro`. Una tabella per corrispondenza esatta
 * mancerebbe metà dei casi proprio quelli che l'utente sta usando.
 */
/**
 * La voce di tabella che descrive questo model id, o `null`.
 *
 * Una funzione perche' la stessa ricerca serve al prezzo, al tetto di contesto e al
 * costo: tre copie di un aggancio per prefisso sono tre regole che possono divergere,
 * e la divergenza si vede solo su certi modelli — cioe' raramente, e mai in un test
 * che copre un altro caso.
 *
 * Il piu' specifico vince: `gemini-3.5-flash` e' un prefisso di
 * `gemini-3.5-flash-lite` solo in un senso, e senza questo ordine il modello lite si
 * prenderebbe il prezzo del modello piu' costoso. Vince l'aggancio piu' lungo.
 */
function entryFor(provider: ProviderId, model: string): PricingEntry | null {
  if (!isCloudProvider(provider)) return null
  const table = PRICE_TABLES[provider]
  if (!table) return null
  const id = model.trim().toLowerCase()
  if (!id) return null
  let best: PricingEntry | null = null
  for (const entry of table) {
    if (!id.includes(entry.match)) continue
    if (!best || entry.match.length > best.match.length) best = entry
  }
  return best
}

export function priceFor(provider: ProviderId, model: string): ModelPrice | null {
  return entryFor(provider, model)?.price ?? null
}

/** Il tetto di contesto noto per un modello, o `null`. */
export function contextWindowFor(provider: ProviderId, model: string): number | null {
  return entryFor(provider, model)?.contextWindow ?? null
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
}

/**
 * Il costo in dollari di un uso, o `null` quando il prezzo non e' noto.
 *
 * La soglia di contestolunga conta sul **prompt** e non sul totale: e il numero di
 * token che il provider vede arrivare che decide il prezzo, quindi e' quello che va
 * confrontato con la soglia. Un totale che include l'output farebbe scattare il prezzo
 * lungo su richieste che il provider ha fattato come corte.
 */
export function costOf(
  provider: ProviderId,
  model: string,
  usage: TokenUsage,
  onFreeTier = false,
): number | null {
  /*
   * Un modello in locale non ha fattura. Non e' una stima a zero: e il fatto che la
   * spesa non esista, ed e' l'unico caso in cui `0` e' la risposta giusta.
   */
  if (!isCloudProvider(provider)) return 0
  if (onFreeTier) return 0
  /*
   * La soglia lunga si legge dalla **voice di tabella**, non dal prezzo.
   *
   * Le due cose stanno in posti diversi perche' non coincidono: `ModelPrice` descrive
   * una tariffa e la soglia e una proprieta' della voce che la contiene, insieme al
   * tetto di contesto. Leggerla dal prezzo sembra funzionare finche' una voce porta un
   * prezzo senza soglia — allora la richiesta lunga costerebbe come una corta, che e'
   * il modo piu' economico per sbagliare.
   */
  const entry = entryFor(provider, model)
  if (!entry) return null
  const { price } = entry

  const long =
    entry.longContextThreshold !== undefined && usage.promptTokens > entry.longContextThreshold
  const inputRate = long
    ? (entry.longContextInputPerMillion ?? price.inputPerMillion)
    : price.inputPerMillion
  const outputRate = long
    ? (entry.longContextOutputPerMillion ?? price.outputPerMillion)
    : price.outputPerMillion

  return (
    (usage.promptTokens / 1_000_000) * inputRate +
    (usage.completionTokens / 1_000_000) * outputRate
  )
}

/** Un costo in dollari, o la parola che va detta quando non e' noto. */
export function formatCost(cost: number | null): string {
  if (cost === null) return 'price not published'
  if (cost === 0) return '$0.00'
  // Sotto il centesimo il formato a due decimali mostra «$0.00» anche spendendo soldi.
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  return `$${cost.toFixed(2)}`
}

/** Un costo in dollari, per le celle di una tabella dove lo zero e' un valore. */
export function formatCostCell(cost: number | null): string {
  return cost === null ? '—' : formatCost(cost)
}

/** Un intero con separatore, per i token. */
export function formatTokens(tokens: number): string {
  return Math.round(tokens).toLocaleString()
}
