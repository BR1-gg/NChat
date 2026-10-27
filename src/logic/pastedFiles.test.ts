/**
 * Incollare roba presa fuori da qui deve funzionare.
 *
 * Il difetto che questo file chiude e' che la paste guardava **solo il testo**,
 * leggendo con `navigator.clipboard.readText()`. Su un'immagine degli appunti di
 * Windows quello restituisce la stringa vuota — non un errore, la stringa vuota — e
 * la paste finiva sul ramo del testo senza creare niente e senza dire niente.
 *
 * Il sintomo era quindi l'assenza di un effetto, non un errore: copiavi una
 * schermata, incollavi, e non succedeva niente. Non c'era un messaggio, non c'era
 * una riga nel registro, non c'era niente. L'unica informazione disponibile era che
 * qualcosa non era successo, che e' la forma peggiore in cui un difetto si possa
 * presentare — e quella da cui l'utente non ha modo di capire nemmeno da dove
 * cominciare a guardare.
 */

import { describe, expect, it } from 'vitest'
import { classifyPastedFile, hasClipboardContent, readClipboardContents } from './pastedFiles'

/**
 * Un `DataTransfer` finto, con la sola parte che la funzione guarda.
 *
 * `DataTransfer` vero non esiste in jsdom e costruirlo e' una lotta; e in ogni caso
 * non e' il browser a dover essere provato qui, ma la lettura: quali campi si
 * guardano, in che ordine, e cosa si scarta. Un finto che espone solo `getData`,
 * `items` e `files` basta, e fallisce se comincia a dipendere da qualcos'altro.
 */
function fakeTransfer(options: {
  text?: string
  files?: Array<{ name: string; type: string; size: number }>
  /** Set when the browser hides the file list, as some of them do. */
  hideFileList?: boolean
  /** Set when `getData` is blocked, as Firefox does outside a paste handler. */
  blockText?: boolean
}): DataTransfer {
  const files = (options.files ?? []).map(
    (file) => new File(['x'.repeat(Math.max(1, Math.min(file.size, 8)))], file.name, { type: file.type }),
  )
  return {
    getData: (type: string) => (options.blockText ? '' : type === 'text/plain' ? (options.text ?? '') : ''),
    items: files.map((file) => ({
      kind: 'file' as const,
      type: file.type,
      getAsFile: () => file,
    })),
    files: options.hideFileList ? ([] as unknown as FileList) : files,
  } as unknown as DataTransfer
}

describe('reading what is on the clipboard', () => {
  it('finds a screenshot, which is the case that used to do nothing', () => {
    const contents = readClipboardContents(
      fakeTransfer({ files: [{ name: 'image.png', type: 'image/png', size: 4 }] }),
    )
    // Non e' un test sulla classificazione: e' sul fatto che il file venga *letto*.
    // Con `readText()` questo era una stringa vuota e la paste finiva li'.
    expect(contents.files).toHaveLength(1)
    expect(contents.files[0]?.type).toBe('image/png')
    expect(hasClipboardContent(contents)).toBe(true)
  })

  it('finds files even when the browser hides the file list', () => {
    /*
     * Su alcuni browser `dataTransfer.files` e' vuoto durante un incolla来自 il
     * sistema, mentre `items` e' popolato. Leggendo solo `files`, `files[0]` e'
     * `undefined` e la paste muore **in silenzio** — di nuovo, senza avviso. La
     * lista usata perche' e `items`, che e' la lista completa, e `files` serve solo
     * come ripiego.
     */
    const contents = readClipboardContents(
      fakeTransfer({
        files: [{ name: 'note.txt', type: 'text/plain', size: 3 }],
        hideFileList: true,
      }),
    )
    expect(contents.files).toHaveLength(1)
    expect(contents.files[0]?.name).toBe('note.txt')
  })

  it('carries the text when there is text', () => {
    const contents = readClipboardContents(fakeTransfer({ text: 'hello' }))
    expect(contents.text).toBe('hello')
    expect(contents.files).toHaveLength(0)
  })

  it('keeps the text when the clipboard also carries a file', () => {
    // Alcune app mettono negli appunti sia il file sia un nome. Il nome non deve
    // sostituire il file: e' la trappola che fa diventare una schermata un Prompt
    // con dentro il nome del file, che sembra funzionare e non funziona.
    const contents = readClipboardContents(
      fakeTransfer({ text: 'screenshot.png', files: [{ name: 'image.png', type: 'image/png', size: 4 }] }),
    )
    expect(contents.text).toBe('screenshot.png')
    expect(contents.files).toHaveLength(1)
  })

  it('survives a browser that refuses to give the text', () => {
    // Firefox blocca getData fuori dal gestore. Perdere il testo e' brutto ma
    // sopravvivibile — i file sono cio' che serve — quindi non viene propagato.
    const contents = readClipboardContents(
      fakeTransfer({ blockText: true, files: [{ name: 'a.txt', type: 'text/plain', size: 2 }] }),
    )
    expect(contents.text).toBe('')
    expect(contents.files).toHaveLength(1)
  })

  it('is empty, not broken, when there is nothing', () => {
    for (const value of [null, undefined]) {
      const contents = readClipboardContents(value)
      expect(contents).toEqual({ text: '', files: [] })
      expect(hasClipboardContent(contents)).toBe(false)
    }
  })

  it('treats whitespace as nothing, so an empty paste does nothing', () => {
    // Uno spazio non e' un contenuto: creare un nodo Prompt per uno spazio
    // riempirebbe la tela di nodi vuoti, e nessuno chiederebbe perche'.
    expect(hasClipboardContent(readClipboardContents(fakeTransfer({ text: '   \n  ' })))).toBe(false)
  })
})

describe('deciding what a pasted file becomes', () => {
  it('makes a screenshot an image', () => {
    expect(classifyPastedFile({ name: 'image.png', type: 'image/png', size: 1024 }).kind).toBe('image')
  })

  it('makes a video an image, because a node holds the frame', () => {
    // Un nodo Image mostra il video e manda al modello un fotogramma. E' gia' il
    // comportamento del trascinamento, e la paste deve coincidere.
    expect(classifyPastedFile({ name: 'clip.mp4', type: 'video/mp4', size: 2048 }).kind).toBe('image')
  })

  it('makes a text file a text node', () => {
    expect(classifyPastedFile({ name: 'notes.md', type: 'text/markdown', size: 20 }).kind).toBe('text')
    expect(classifyPastedFile({ name: 'main.ts', type: '', size: 20 }).kind).toBe('text')
  })

  it('trusts the declared type over the extension', () => {
    /*
     * Una schermata copiata da un'app che sbaglia il MIME arriva come
     * `application/octet-stream`. Il tipo dichiarato viene dal sistema ed e' l'informazione
     * piu' affidabile che c'e', quindi viene guardato per primo — e quando e' un tipo
     * conosciuto decide da solo.
     */
    expect(classifyPastedFile({ name: 'screenshot.png', type: 'image/png', size: 20 }).kind).toBe('image')
    // Un MIME sconosciuto non prova niente: si cade sul nome.
    expect(classifyPastedFile({ name: 'notes.md', type: 'application/octet-stream', size: 20 }).kind).toBe(
      'text',
    )
  })

  it('refuses a binary that only the name gives away, rather than reading it as text', () => {
    /*
     * Una `.png` che il sistema consegna come `application/octet-stream` **non**
     * diventa un nodo di testo. Il progetto conosce gia' le estensioni binarie e le
     * rifiuta per nome, ed e' la scelta giusta: un nodo File che contiene dei byte
     * PNG non si aprirebbe, e l'utente vedrebbe un nodo che sembra vuoto senza
     * sapere perche'. Il rifiuto porta con se la ragione, che il nodo mostra.
     */
    const verdict = classifyPastedFile({ name: 'photo.png', type: 'application/octet-stream', size: 20 })
    expect(verdict.kind).toBe('refused')
    expect(verdict.reason).toBeTruthy()
  })

  it('refuses a binary it cannot read, and says why', () => {
    // Il rifiuto ha una **ragione**, non solo un esito. Serve perche' il nodo la
    // mostra dentro: un file che sparisce senza lasciare traccia e' indistinguibile
    // da una paste fallita.
    const verdict = classifyPastedFile({ name: 'paper.pdf', type: 'application/pdf', size: 4000 })
    expect(verdict.kind).toBe('refused')
    expect(verdict.reason).toBeTruthy()
  })

  it('refuses an empty image rather than making a node that cannot decode', () => {
    /*
     * Un file da zero byte passa il controllo del tipo e poi fallisce alla
     * decodifica, lasciando un nodo vuoto senza spiegazione. Il messaggio e' lo
     * stesso del percorso di trascinamento, cosi' le due strade dicono la stessa
     * cosa.
     */
    const verdict = classifyPastedFile({ name: 'image.png', type: 'image/png', size: 0 })
    expect(verdict.kind).toBe('refused')
    expect(verdict.reason).toMatch(/empty/i)
  })
})
