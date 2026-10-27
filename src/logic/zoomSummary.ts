import type { AppNodeData } from '../types/document'

/**
 * The line a node shows when the whole canvas is zoomed far out.
 *
 * At that zoom a node is a few pixels of unreadable text, and a canvas of two
 * hundred of them is noise: you can see the shape of the work and nothing else.
 * So the content blurs and one line of it comes forward, chosen per kind:
 *
 * - an **answer** shows its **title**, because that is what identifies it. The
 *   answer's own text is the one thing on this canvas there is no point showing
 *   at a distance: it is a screen or two of paragraph, and a screen of paragraph
 *   per node turns the overview back into noise. The title already sits in the
 *   node's header, so the far view and the near view say the same thing about
 *   the node — which is the whole point of a summary;
 * - a **prompt** shows only its first words, because a prompt is an instruction
 *   and its first words are what it is about, while the rest is a paragraph
 *   nobody can read at that size;
 * - a **picture** is left completely alone. A blurred photograph is not a
 *   summary of anything, and the shape of the image is already the content.
 *
 * The summary is computed here rather than in each node, because the rule "which
 * line of this node is its point" belongs in one place, and a node that forgot to
 * pass one would just blur into nothing.
 */

/** Below this zoom a node cannot be read, so it blurs. */
export const FAR_ZOOM = 0.55

/** How much of a line is worth showing at that size. */
const MAX_SUMMARY_CHARS = 220

/**
 * A title is a title, so it gets its own budget, and a small one.
 *
 * It is already short by construction — the store takes the first line of the
 * prompt and cuts it at 70 characters — so this rarely bites. It exists for the
 * titles that were set by hand, and for the fallback below, where a first line of
 * an answer can be a whole sentence.
 */
const MAX_TITLE_CHARS = 90

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/**
 * How much of the budget a word-boundary cut must keep.
 *
 * Sotto questa soglia si preferisce una parola spezzata a tre lettere e puntini:
 * `parola pa…` almeno lascia capire che il testo continua, `tre…` non dice niente.
 */
const MIN_USEFUL_CUT = 0.4

function shorten(value: string, max = MAX_SUMMARY_CHARS): string {
  const text = collapse(value)
  if (text.length <= max) return text
  /*
   * Cut on a word, so the line does not end mid-word.
   *
   * Prima la soglia era una sola, `lo spazio deve essere oltre il 60% del tetto`, e
   * sotto quella si tagliava a meta' parola. Il buco era la **fascia** fra il 40% e
   * il 60%: li la parola esiste, si poteva tagliare sul confine, e invece si tagliava
   * in mezzo. Con i riassunti da 220 caratteri la fascia si attraversa raramente e
   * il difetto passava inosservato; con i **titoli**, che hanno un tetto di 90, capita
   * piu spesso.
   *
   * Quindi due soglie invece di una: taglia sul confine quando il confine esiste e
   * lascia abbastanza testo da valere la pena, altrimenti taglia dove capita — perche
   * inventare un confine sarebbe peggio che fermarsi dove finisce il testo.
   */
  const cut = text.slice(0, max)
  const space = cut.lastIndexOf(' ')
  if (space < max * MIN_USEFUL_CUT) return `${cut.trimEnd()}…`
  return `${cut.slice(0, space).trimEnd()}…`
}

/**
 * Whether this node's summary reads as a **title**, rather than as a line of body
 * text.
 *
 * A separate question from *what* the summary says, and deliberately so: the text
 * is decided by `zoomSummary` and every node passes that straight through, while
 * "how should this look" is presentation. Mixing the two would mean every node
 * component unpacking an object just to learn a boolean, and seven chances to get
 * the shape wrong.
 *
 * Today it is answers only, because an answer's summary *is* its title — the same
 * words the node header shows. Everything else summarises the content itself, and
 * content wants the same weight everywhere, or the overview starts to shout.
 */
export function zoomSummaryIsTitle(data: AppNodeData): boolean {
  return data.kind === 'response'
}

/**
 * The summary for a node, or `null` when the node should not blur at all.
 *
 * Returning `null` is a deliberate answer, not a missing one: a picture has no
 * line of text that stands in for it, so it keeps its content and stays sharp.
 */
export function zoomSummary(data: AppNodeData): string | null {
  switch (data.kind) {
    case 'prompt': {
      const text = typeof data.text === 'string' ? data.text : ''
      // The first words are the subject of the instruction; the rest is detail.
      return shorten(text.split('\n').slice(0, 2).join(' '), 120) || null
    }
    case 'response': {
      /*
       * Il titolo, non il testo.
       *
       * Il titolo e gia derivato dal primo rigo della domanda al momento della
       * corsa, quindi e la stessa cosa che l'intestazione del nodo mostra: a
       * distanza e a distanza ravvicinata il nodo si descrive allo stesso modo, e
       * l'utente non deve imparare due lezioni diverse per lo stesso oggetto.
       *
       * Il ripiego serve per i nodi vecchi, salvati prima che il titolo esistesse,
       * e per le risposte abbandonate: meglio la prima riga dell'risposta che
       * niente, ma non il paragrafo intero, che e proprio quello che non si
       * vuole vedere qui.
       */
      const title = data.title?.trim() ?? ''
      if (title) return shorten(title, MAX_TITLE_CHARS)
      const firstLine = (data.text ?? '').split('\n').find((line) => line.trim())
      if (firstLine) return shorten(firstLine, MAX_TITLE_CHARS)
      // An answer that has not arrived yet still says what it is for.
      const question = data.promptSnapshot?.trim()
      return question ? shorten(question, 120) : 'No answer yet'
    }
    case 'system':
      return shorten(data.text) || null
    case 'note':
      return shorten(data.text) || null
    case 'summary':
      return shorten(data.text) || null
    case 'output':
      return shorten(data.text) || null
    case 'file':
      return data.name ? `${data.name} · ${shorten(data.text, 140)}` : null
    case 'folder': {
      const count = data.fileCount
      if (count === 0) return data.name || null
      const refused = data.refused.length > 0 ? `, ${data.refused.length} not read` : ''
      return `${data.name} · ${count} file${count === 1 ? '' : 's'}${refused}`
    }
    case 'brain':
      return data.instruction.trim() ? `Brain · ${shorten(data.instruction, 120)}` : 'Brain'
    case 'knowledge':
      /*
       * Il nome del centro, non il testo delle note.
       *
       * Le note sono dentro l'archivio e non nel nodo — il nodo tiene degli id. Quindi qui non
       * c'e' niente da mostrare tranne **cosa** e' stato puntato, che e' l'informazione che
       * distingue due nodi Knowledge uguali a distanza ravvicinata.
       *
       * Senza centro scelto dice che non e' configurato, e non resta muto: un nodo che a
       * distanza ravvicinata sembra vuoto sembra un nodo rotto, e invece aspetta una scelta.
       */
      return data.hubId ? `Knowledge · ${data.hubId}` : 'Knowledge · pick a main point'
    case 'image':
      // Left alone on purpose: a blurred picture says nothing.
      return null
    default:
      return null
  }
}
