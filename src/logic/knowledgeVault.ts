import type { KnowledgeEntry, KnowledgeHub, KnowledgeId } from '../types/knowledge'

/**
 * Il deposito: l'archivio scritto **come file**, in una cartella scelta dall'utente.
 *
 * Una nota per file, in markdown con un front matter. La scelta non e' una formato fra
 * tanti, e' quello che rende l'archivio **spostabile**: un file di testo si può portare in
 * un'altra cartella, aprire con qualsiasi editor, e leggere anche se questa applicazione
 * non esiste piu'. Un archivio chiuso dentro un database del browser è un posto dove le
 * note si perdono, e «dov'è il mio archivio» finisce per essere «non lo so».
 *
 * Qui dentro c'e' solo la **forma del file**: scrivere e rileggere. La scrittura sul disco e
 * la scelta della cartella stanno in `store/knowledgeVault.ts`, e il motivo e' lo stesso di
 * sempre — questa parte e' pura e ha un test, quella no e va verificata con le mani.
 */

/** Il nome del file che elenca i file scritti, e quindi che si puo' cancellare. */
export const VAULT_INDEX = '_nchat-vault.json'

/** Il nome del file di una nota. Con l'id dentro, cosi' due titoli uguali non si sovrappono. */
export function vaultFileName(entry: KnowledgeEntry): string {
  const title = entry.title
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  const short = entry.id.slice(0, 6)
  // Il titolo c'e' perche' la cartella si guarda con il file manager, e un archivio di file
  // chiamati `k1a2b3.md` non si puo' navigare. L'id c'e' perche' due note con lo stesso
  // titolo non possono scriversi l'una sopra l'altra: e' l'unico modo per cui una nota
  // sparisce senza che nessuno lo dica.
  return `${title || 'nota'}-${short}.md`
}

/** The tag the front matter is fenced with. */
const FENCE = '---'

/**
 * Una nota in markdown.
 *
 * Il front matter porta quello che **non** si vede guardando il testo: il punto di contesto
 * a cui è appesa e le note a cui è legata. Il testo viene dopo, e resta il testo: il file
 * si legge per intero anche se nessuno di questi campi esiste, che è la parte che rende il
 * deposito leggibile e non solo utilizzabile da questa applicazione.
 *
 * I collegamenti sono per **id** e non per titolo. Per id, perché rinominare una nota non
 * deve staccare i legami che portano a lei: un archivio in cui cambiare un titolo rompe i
 * collegamenti è un archivio in cui non si può rinominare niente.
 */
export function renderVaultNote(
  entry: KnowledgeEntry,
  hubs: readonly KnowledgeHub[],
): string {
  const hub = hubs.find((candidate) => candidate.id === entry.hubId)
  const lines = [
    FENCE,
    `id: ${entry.id}`,
    `title: ${yamlValue(entry.title)}`,
    `hub: ${hub ? yamlValue(hub.title) : ''}`,
    `links: ${entry.links.join(',')}`,
    `source: ${entry.source.workspaceName ?? ''}`,
    `node: ${entry.source.nodeTitle ?? ''}`,
    `created: ${new Date(entry.createdAt).toISOString()}`,
    FENCE,
    '',
    entry.text,
    '',
  ]
  return lines.join('\n')
}

/**
 * Quello che si ricava da un file, **anche se qualcosa non torna**.
 *
 * Il file puo' essere stato modificato a mano, spostato, o scritto da un'altra versione. Per
 * questo ogni campo e' facoltativo e un file senza front matter non e' un errore: e' una
 * nota che non ha ancora nessuna di queste informazioni, e va comunque letta. Restituire
 * `null` solo quando non si puo' ricavare **niente** — cioe' nessun id e nessun testo —
 * che e' il caso in cui il file non e' una nota e va lasciato stare.
 */
export function parseVaultNote(filename: string, content: string): ParsedNote | null {
  const text = content.replace(/\r\n/g, '\n')
  let body = text
  let head = new Map<string, string>()
  if (text.startsWith(`${FENCE}\n`)) {
    const end = text.indexOf(`\n${FENCE}`, FENCE.length)
    if (end > 0) {
      for (const line of text.slice(FENCE.length + 1, end).split('\n')) {
        const at = line.indexOf(':')
        if (at < 0) continue
        head.set(line.slice(0, at).trim(), stripQuotes(line.slice(at + 1).trim()))
      }
      body = text.slice(end + FENCE.length + 2).replace(/^\n+/, '')
    }
  }
  // L'id viene dal front matter e, se non c'e', dal nome del file: il nome contiene l'id,
  // e senza questo un file rinominato a mano perderebbe la sua identita' e diventerebbe una
  // nota nuova a ogni lettura — cioe' l'archivio si moltiplicherebbe a ogni apertura.
  const fromName = /-([0-9a-z]{4,10})\.md$/i.exec(filename)?.[1]
  const id = head.get('id') || fromName
  const content_ = body.trim()
  if (!id && !content_) return null
  return {
    id: id ?? null,
    title: head.get('title') || firstLine(content_) || 'Untitled',
    text: content_,
    hubTitle: head.get('hub') || null,
    links: (head.get('links') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
    workspaceName: head.get('source') || null,
    nodeTitle: head.get('node') || null,
  }
}

/** Quello che si ricava da un file, senza ancora sapere se il file era valido. */
export interface ParsedNote {
  id: KnowledgeId | null
  title: string
  text: string
  hubTitle: string | null
  links: KnowledgeId[]
  workspaceName: string | null
  nodeTitle: string | null
}

/**
 * L'indice: la lista dei file che questa applicazione ha scritto.
 *
 * Serve a una cosa sola — sapere **quali file sono nostri** — e senza di esso l'unica
 * alternativa e' cancellare dalla cartella tutto quello che finisce in `.md`. In una
 * cartella scelta dall'utente ci sono anche le sue cose, e un'operazione che cancella
 * «i file markdown» non e' un'operazione che si fa senza chiedere.
 *
 * Quindi l'indice elenca i nomi, e vengono tolti solo quelli: un file che l'utente ha messo
 * li' per conto suo non e' nell'indice e non viene toccato, e un file che non finisce piu'
 * nell'indice viene rimosso perche' la nota non esiste piu'.
 */
export function renderVaultIndex(entries: readonly KnowledgeEntry[]): string {
  return `${JSON.stringify(
    {
      note: 'Written by NCHAT. Files listed here are managed; anything else in the folder is left alone.',
      files: entries.map((entry) => vaultFileName(entry)),
    },
    null,
    2,
  )}\n`
}

/** I nomi dei file che l'indice dice essere nostri, senza fidarsi del formato. */
export function parseVaultIndex(content: string): string[] {
  try {
    const value = JSON.parse(content) as { files?: unknown }
    if (!Array.isArray(value.files)) return []
    return value.files.filter((name): name is string => typeof name === 'string')
  } catch {
    // Un indice illeggibile non e' un errore da propagare: si tratta come se non ci fosse e
    // si riscrive. Il peggio che può succedere e' che i file di una versione precedente
    // restino li', e l'utente li vede — che e' meglio che cancellarli senza sapere cosa erano.
    return []
  }
}

/** Un valore con dentro i due punti o gli spazi non si rompe: si mette fra apici. */
function yamlValue(value: string): string {
  const clean = value.replace(/[\r\n]+/g, ' ').trim()
  if (clean === '') return ''
  return /[:#]/.test(clean) || clean !== clean.trim() ? `"${clean.replace(/"/g, '\\"')}"` : clean
}

function stripQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"')
  }
  return value
}

function firstLine(text: string): string {
  return text.split('\n').map((line) => line.trim()).find((line) => line.length > 0) ?? ''
}