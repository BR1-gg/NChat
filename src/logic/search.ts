/**
 * Cercare una parola nel grafo.
 *
 * Il difetto che questo file chiude e' che su un grafo grande **non si poteva
 * cercare niente**. Esisteva la palette per aggiungere nodi e il menu per azioni, ma
 * per trovare «quella cosa che avevo scritto tre settimane fa» l'unica opzione era
 * scorrare la tela e leggere ogni nodo. E su un grafo di trecento nodi quello non e'
 * slow scrolling: e' non sapere nemmeno in che direzione guardare.
 *
 * Tutto qui dentro e' **puro e sincrono**: una funzione che prende un documento e una
 * domanda e restituisce i risultati. Niente store, niente DOM, niente attese. Il
 * motivo non e' la pulizia: e' che la ricerca deve poter girare a ogni tasto premuto
 * su un grafo grande, e una funzione che chiama lo store o aspetta un frame rende
 * ogni lettera un ricalcolo asincrono. Con i dati in mano la ricerca costa meno di un
 * render.
 */

import type { WorkspaceDocument } from '../types/document'

/** What a node's text is, so the results can say where the word was found. */
export type SearchField = 'prompt' | 'note' | 'response' | 'file' | 'summary' | 'system' | 'output' | 'name'

export interface SearchHit {
  nodeId: string
  /** Which kind of text matched, for the label beside the result. */
  field: SearchField
  /** A short label for the node itself: its title, or the first line of its text. */
  title: string
  /** A window of text around the match, with the query still inside it. */
  snippet: string
  /** Where the match starts inside `snippet`, for highlighting. */
  at: number
  /** The whole matched text's length, so highlighting knows where to stop. */
  length: number
  /** How many times the query appears in this node's text. */
  occurrences: number
}

/** Per-field weights: a hit in a prompt outranks one in a response body. */
const FIELD_RANK: Record<SearchField, number> = {
  prompt: 0,
  note: 1,
  name: 2,
  system: 3,
  output: 4,
  summary: 5,
  file: 6,
  response: 7,
}

/** The longest snippet worth showing. Long enough to judge, short enough to scan. */
const SNIPPET = 140

/** How far either side of the match the snippet reaches. */
const LEAD = 48

/** The node shape this module reads. Named so the signatures read as prose. */
type AnyNode = WorkspaceDocument['nodes'][number]

/**
 * Splits a query the way a person would type it.
 *
 * Lo spazio non e' "e'": e' una pausa. `errore timeout` e' la ricerca di due parole,
 * e restituirla come una frase intera non troverebbe niente anche se i due termini ci
 * sono entrambi. Per questo ogni termine viene cercato per conto suo e i risultati
 * sono i nodi che li hanno **tutti** — con `AND`, non `OR`, perche' un risultato che
 * contiene una parola su tre e' rumore.
 */
export function queryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
}

/** Counts non-overlapping occurrences, case-insensitively. */
function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at < 0) break
    count += 1
    from = at + needle.length
  }
  return count
}

/** A readable window around the first match, with room for the query to sit inside. */
function snippetAround(text: string, at: number, length: number): { snippet: string; at: number } {
  const start = Math.max(0, at - LEAD)
  const end = Math.min(text.length, Math.max(at + length, start + SNIPPET))
  let snippet = text.slice(start, end).replace(/\s+/g, ' ').trim()
  // The offsets shift when the whitespace collapses, so the match is found again in
  // the collapsed string rather than trusted to survive the transform.
  const shifted = snippet.toLowerCase().indexOf(text.slice(at, at + length).toLowerCase())
  if (start > 0) snippet = `…${snippet}`
  if (end < text.length) snippet = `${snippet}…`
  return { snippet, at: shifted < 0 ? 0 : shifted + (start > 0 ? 1 : 0) }
}

/** The text of a node, per field, or an empty string. */
function textOf(node: AnyNode, field: SearchField): string {
  const data = node.data
  if (field === 'name') {
    if (data.kind === 'image' || data.kind === 'file' || data.kind === 'folder') return data.name
    // Solo questi tre tipi hanno un nome proprio. Gli altri hanno un `title` che puo'
    // anche essere vuoto, e restituire `''` e' giusto: un titolo vuoto non e' una
    // corrispondenza, e Inventare un nome dal testo tradirebbe quello che l'utente ha
    // scritto.
    if (data.kind === 'output' || data.kind === 'summary' || data.kind === 'set') {
      return data.title ?? ''
    }
    /*
     * Il gruppo si cerca per il **nome**, e non per quello che contiene.
     *
     * E' l'unico campo che ha: il gruppo non ha testo. E la ragione per cui la ricerca
     * serve e' proprio il nome — se non lo ricordi, il nome del gruppo e' l'unica pista,
     * e i nodi dentro si cercano per il loro testo, che e' gia' indicizzato per conto
     * loro. Elencare i membri qui significherebbe che cercare una parola dentro il gruppo
     * restituirebbe il gruppo invece del nodo che la contiene, e la ricerca che porta al
     * testo giusto diventerebbe quella che porta alla cornice.
     */
    if (data.kind === 'group') return data.title ?? ''
    return ''
  }
  switch (data.kind) {
    case 'prompt':
      return field === 'prompt' ? data.text : ''
    case 'note':
      return field === 'note' ? data.text : ''
    case 'response':
      return field === 'response' ? data.text : ''
    case 'summary':
      return field === 'summary' ? data.text : ''
    case 'system':
      return field === 'system' ? data.text : ''
    case 'output':
      return field === 'output' ? data.text : ''
    case 'file':
      return field === 'file' ? data.text : ''
    case 'folder':
      // Una cartella si cerca per il testo che contiene, non per il suo nome: e' il
      // testo che l'utente ricorda, e il nome spesso e' solo il nome della cartella di
      // origine, che non e' quello che sta cercando.
      return field === 'file' ? data.text : ''
    case 'image':
      return ''
    default:
      return ''
  }
}

/** Every field worth searching on a node, best first. */
function fieldsFor(node: AnyNode): SearchField[] {
  switch (node.data.kind) {
    case 'prompt':
      return ['prompt', 'name']
    case 'note':
      return ['note', 'name']
    case 'response':
      return ['response', 'name']
    case 'summary':
      return ['summary', 'name']
    case 'system':
      return ['system', 'name']
    case 'output':
      return ['output', 'name']
    case 'group':
      // Solo il nome: vedi il commento sopra, in `textOf`.
      return ['name']
    case 'set':
      return ['name']
    case 'file':
      return ['name', 'file']
    case 'folder':
      return ['name', 'file']
    case 'image':
      return ['name']
    case 'brain':
      return ['name']
    case 'knowledge':
      /*
       * Solo il **nome** del nodo, e non i titoli delle note che punta.
       *
       * Sembra poco, e il motivo e' che il resto si cerca gia' nella sua casa: i titoli
       * dell'archivio sono ricercabili dal suo stesso elenco, e cercarli anche qui produrrebbe
       * due risultati per la stessa nota — uno che si apre e uno che si sposta su un nodo —
       * e l'utente che trova il primo non avrebbe motivo di sapere del secondo.
       */
      return ['name']
    default:
      return ['name']
  }
}

/** A node's own name, when it has one, for the result line. */
function labelOf(node: AnyNode): string {
  const data = node.data
  if (data.kind === 'image' || data.kind === 'file' || data.kind === 'folder') return data.name
  const title = (data as { title?: string }).title
  if (title && title.trim()) return title.trim().split('\n')[0] ?? ''
  const text = textOf(node, fieldsFor(node)[0] ?? 'name')
  const firstLine = text.trim().split('\n')[0] ?? ''
  return firstLine.slice(0, 60) || 'Untitled'
}

/**
 * The nodes matching every term, best first.
 *
 * L'ordine non e' cosmetico: e' quello in cui l'utente Finds giusto quello che cerca
 * fra venti risultati. Prima il campo piu' vicino a **intenzione** — un prompt
 * scritto per essere eseguito, non una risposta — e dentro quello, quello con piu'
 * occorrenze, perche' tre volte una parola e' quasi sempre piu' del caso di quello che
 * la contiene una volta per caso.
 */
export function searchNodes(
  document: WorkspaceDocument,
  query: string,
  limit = 40,
): SearchHit[] {
  const terms = queryTerms(query)
  if (terms.length === 0) return []

  const hits: Array<SearchHit & { rank: number; occurrences: number }> = []

  for (const node of document.nodes) {
    const fields = fieldsFor(node)
    // Tutti i termini devono comparire, ognuno in un campo qualsiasi della stessa
    // memoria. Con `AND`: un risultato che contiene una parola su tre e' rumore, e
    // in una ricerca il rumore e' peggio di non trovare niente, perche' l'utente
    // smette di fidarsi e non guarda nemmeno quello che c'era.
    const perTerm = terms.map((term) => {
      let best: { field: SearchField; at: number; count: number } | null = null
      for (const field of fields) {
        const text = textOf(node, field)
        if (!text) continue
        const at = text.toLowerCase().indexOf(term)
        if (at < 0) continue
        const count = countOccurrences(text.toLowerCase(), term)
        if (!best || FIELD_RANK[field] < FIELD_RANK[best.field] || count > best.count) {
          best = { field, at, count }
        }
      }
      return best
    })
    if (perTerm.some((entry) => entry === null)) continue

    // Il campo mostrato e' quello del **primo** termine: e' quello che l'utente ha
    // scritto per primo, quindi e' quello che sta cercando di ricordare.
    const lead = perTerm[0]
    if (!lead) continue
    const fieldText = textOf(node, lead.field)
    const { snippet, at } = snippetAround(fieldText, lead.at, terms[0]?.length ?? 0)
    const occurrences = perTerm.reduce((total, entry) => total + (entry?.count ?? 0), 0)

    hits.push({
      nodeId: node.id,
      field: lead.field,
      title: labelOf(node),
      snippet,
      at,
      length: terms[0]?.length ?? 0,
      occurrences,
      rank: FIELD_RANK[lead.field] * 1000 - Math.min(occurrences, 999),
    })
  }

  hits.sort((a, b) => a.rank - b.rank)
  return hits.slice(0, limit).map(({ rank: _rank, ...hit }) => hit)
}
