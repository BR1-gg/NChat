import type { KnowledgeColor } from '../types/knowledge'

/**
 * I colori delle note: **un posto solo** dove sapere quali sono e che aspetto hanno.
 *
 * La palette vive qui e non nel CSS perche' la mappa la usa in `three`, che accetta un
 * numero e non un nome di tonalita'. Ma la stessa palette e' gia' scritta nei fogli di
 * stile — per le pastiglie e per le cornici dei gruppi — e due elenchi uguali in due posti
 * sono due elenchi che divergono: uno ne aggiunge un tono, l'altro no, e da li' scegliere
 * il colore di una nota e scegliere quello di un gruppo significano due cose diverse.
 *
 * Quindi qui c'e' la **verifica** che i due elenchi coincidano, in `knowledgeColour.test.ts`.
 * Non e' una formalita': e' l'unica cosa che impedisce a questa riga di diventare una
 * copia che mente.
 *
 * `default` non e' un colore ed e' per questo che non ha un numero: e' «il colore del
 * tema», e la mappa lo traduce con i suoi mezzi — una tinta neutra che non compete con le
 * scelte dell'utente.
 */

/** Every colour a note may carry, in the order the swatches are shown. */
export const KNOWLEDGE_COLOURS: readonly KnowledgeColor[] = [
  'default',
  'amber',
  'sky',
  'rose',
  'green',
  'violet',
]

/**
 * The exact shade each name stands for.
 *
 * Questi numeri sono gli stessi dei fogli di stile, e il test lo controlla. Se uno cambia
 * qui e non li', la pallina e la pastiglia mostrano due colori diversi con lo stesso nome —
 * il difetto piu' subdolo di tutti, perche' **non si vede** finche' non si mettono le due
 * cose vicine.
 */
export const KNOWLEDGE_HEX: Record<Exclude<KnowledgeColor, 'default'>, number> = {
  amber: 0xf4b740,
  sky: 0x38bdf8,
  rose: 0xfb7185,
  green: 0x4ade80,
  violet: 0xa78bfa,
}

/**
 * The numbers the stylesheets use for the same shades, for the drift check.
 *
 * Sono qui come `stringa` e non come numero perche' il confronto e' con il **testo** del
 * foglio di stile: e' il numero in esadecimale che c'e' scritto li', e confrontare i due
 * valori richiederebbe di riformattare il numero esattamente come lo formatta il CSS — che
 * cambia e non cambierebbe niente di utile.
 */
export const KNOWLEDGE_CSS_HEX: Record<Exclude<KnowledgeColor, 'default'>, string> = {
  amber: '#f4b740',
  sky: '#38bdf8',
  rose: '#fb7185',
  green: '#4ade80',
  violet: '#a78bfa',
}

/** The names a user reads, in the app's language. */
export const KNOWLEDGE_COLOUR_NAMES: Record<KnowledgeColor, string> = {
  default: 'Neutral',
  amber: 'Amber',
  sky: 'Sky',
  rose: 'Rose',
  green: 'Green',
  violet: 'Violet',
}

/** True when a value from a saved file is one of ours. */
export function isKnowledgeColor(value: unknown): value is KnowledgeColor {
  return typeof value === 'string' && (KNOWLEDGE_COLOURS as readonly string[]).includes(value)
}

/**
 * The shade a note should be drawn in.
 *
 * `neutral` e' il ripiego quando l'utente non ha scelto niente, ed e' un parametro e non
 * una costante perche' la mappa ha un proprio neutro (caldo, per stare bene su fondo
 * scuro) che non e' quello di nessuna tonalita' della palette.
 */
export function shadeFor(colour: KnowledgeColor, neutral: number): number {
  return colour === 'default' ? neutral : KNOWLEDGE_HEX[colour]
}
