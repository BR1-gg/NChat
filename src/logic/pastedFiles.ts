/**
 * Cosa c'era negli appunti quando si incolla, e che tipo di nodo ne vuole fare.
 *
 * Il difetto che questo file chiude e' che la paste guardava **solo il testo**.
 * `navigator.clipboard.readText()` su un'immagine degli appunti di Windows
 * restituisce la stringa vuota — non un errore, la stringa vuota — e la paste
 * finiva li': `if (!text.trim()) return`, senza creare niente e senza dire niente.
 *
 * Il sintomo era quindi l'assenza di un effetto, non un errore: si copiava una
 * schermata, si incollava, e non succedeva niente. E' il difetto piu' difficile da
 * diagnosticare di tutti, perche' l'unica traccia e' che qualcosa non e' successo e
 * niente lo dice.
 *
 * La classificazione e' una funzione pura su nome, tipo e dimensione, e non su un
 * `File`: la decisione «questo e' un'immagine» e' una domanda sul **formato**, e
 * risponderla qui vuol dire che si puo' provare senza costruire un file, senza un
 * browser e senza attendere che i byte arrivino. Il resto — leggere i byte, creare
 * il nodo — sta nelle azioni, che sanno cosa fare di una decisione.
 */

import { checkTextFile } from './filetext'
import { mediaKindOf } from './media'

/**
 * What kind of node a pasted file wants to become.
 *
 * `refused` non e' un errore: e' un file che il nodo puo' comunque mostrare, con la
 * ragione per cui il testo non e' stato letto. Serve perche' un rifiuto senza
 * traccia sembrerebbe una paste che non e' successa — che e' esattamente il difetto
 * che questo file chiude.
 */
export type PastedFileKind = 'image' | 'text' | 'refused'

export interface PastedFileVerdict {
  kind: PastedFileKind
  /** Why it was refused, in one sentence. Only set when `kind` is `refused`. */
  reason?: string
}

export interface ClipboardContents {
  /** The plain text on the clipboard, if any. */
  text: string
  /** The files on the clipboard: a screenshot, or files copied in a file manager. */
  files: File[]
}

/**
 * What a pasted file should become.
 *
 * L'ordine e' deliberato: **prima il tipo dichiarato, poi il nome**. Un file chiamato
 * `screenshot.png` che il sistema dichiara `image/png` e' un'immagine, e viceversa
 * un file che si chiama `foto.png` ma arriva come `application/octet-stream` non lo
 * e' e va detto. Se si guardasse prima il nome, una copia da un'app che sbaglia il
 * tipo finirebbe in un nodo File che non contiene niente di apribile.
 */
export function classifyPastedFile(file: {
  name: string
  type: string
  size: number
}): PastedFileVerdict {
  if (mediaKindOf(file) !== 'unsupported') {
    // A zero-byte file passes the type check and then fails to decode, which would
    // leave an empty node with no explanation. It is caught here instead, with the
    // same wording the drop path uses, so the two routes say the same thing.
    if (file.size === 0) {
      return {
        kind: 'refused',
        reason: `${file.name} is empty, so there is nothing to show.`,
      }
    }
    return { kind: 'image' }
  }
  const text = checkTextFile(file.name, file.size)
  if (text.ok) return { kind: 'text' }
  return { kind: 'refused', reason: text.reason }
}

/**
 * Pulls the text and the files out of a `DataTransfer`.
 *
 * Si accetta un `DataTransfer` perche' e' quello che l'evento `paste` dà, ma non si
 * tocca niente: la funzione e' una lettura, e ogni decisione la prende chi la
 * chiama.
 *
 * I file si prendono da `items` e non da `files`, perche' su alcuni browser i due
 * non coincidono: `files` e' vuoto mentre `items` ha l'elemento, e allora
 * `files[0]` e' `undefined` e la paste muore in silenzio — di nuovo, senza
 * avvisare. `items` e' la lista completa; `files` ne e' una vista filtrata che
 * alcuni browser non riempiono per gli incolla provenienti dal sistema.
 */
export function readClipboardContents(data: DataTransfer | null | undefined): ClipboardContents {
  if (!data) return { text: '', files: [] }
  let text = ''
  try {
    text = data.getData('text/plain')
  } catch {
    // Firefox restricts getData outside the event handler. Losing the text is bad
    // but survivable — the files are what the caller mainly needs — so this is
    // swallowed here rather than propagated.
    text = ''
  }
  const files: File[] = []
  const items = data.items
  if (items) {
    for (const item of Array.from(items)) {
      // `kind === 'file'` and not a string: pasting formatted text puts 'text/html'
      // and 'text/plain' in here too, and those are text, not files.
      if (item.kind !== 'file') continue
      const file = item.getAsFile()
      if (file) files.push(file)
    }
  }
  if (files.length === 0 && data.files?.length) files.push(...Array.from(data.files))
  return { text, files }
}

/**
 * Whether there is anything here worth acting on.
 *
 * Serve per decidere se chiamare `preventDefault`. Senza, il browser incolla il testo
 * grezzo nel documento — che in un'app a tela intera non ha nessun campo su cui
 * finire, quindi sparisce senza traccia. Con, il paste e' o nostro o lascia stare.
 */
export function hasClipboardContent(contents: ClipboardContents): boolean {
  return contents.text.trim().length > 0 || contents.files.length > 0
}
