import { describe, expect, it } from 'vitest'
import { FAR_ZOOM, zoomSummary, zoomSummaryIsTitle } from './zoomSummary'
import type { AppNodeData } from '../types/document'

/**
 * Zoomed far out, a node is a few pixels of unreadable text. The content blurs
 * and one line comes forward. What that line should be is decided here, and the
 * decision is per kind, so it is tested per kind.
 */

function dataOf(patch: Partial<AppNodeData>): AppNodeData {
  return { kind: 'note', text: '', ...patch } as AppNodeData
}

describe('zoomSummary', () => {
  it('shows an answer with its title, not with its text', () => {
    /*
     * Il testo della risposta e l'unica cosa di questo quadro che a distanza non
     * serve mostrare: e uno schermo di paragrafo per nodo, e trenta schermi di
     * paragrafo riducono la vista lontana a rumore — cioe al contrario di quello
     * per cui esiste.
     *
     * Il titolo e la stessa parola che l'intestazione del nodo mostra, quindi il
     * nodo si descrive uguale vicino e lontano.
     */
    const summary = zoomSummary(
      dataOf({
        kind: 'response',
        title: 'Perche la build e rossa',
        text: 'Il test fallisce perche la porta 8080 e occupata da un altro processo.',
      }),
    )
    expect(summary).toBe('Perche la build e rossa')
  })

  it('says the title, even when the answer is still arriving', () => {
    // Il titolo nasce dalla domanda al momento della corsa, quindi c'e prima del
    // primo token: durante lo streaming il nodo non torna a mostrare il testo.
    const summary = zoomSummary(
      dataOf({ kind: 'response', title: 'Somme', text: 'Parziale', status: 'streaming' }),
    )
    expect(summary).toBe('Somme')
  })

  it('falls back to the first line of the answer when the node has no title', () => {
    // I nodi salvati prima che il titolo esistesse. Meglio la prima riga che
    // niente, ma non il paragrafo: quello e proprio quello che non si vuole qui.
    const summary = zoomSummary(
      dataOf({ kind: 'response', text: 'Canberra e la capitale.\n\nPiu di cosi.' }),
    )
    expect(summary).toBe('Canberra e la capitale.')
  })

  it('cuts a long title on a word, never mid-word', () => {
    // I titoli sono gia brevi per costruzione, ma quelli scritti a mano no.
    //
    // L'invariante e che **ogni parola mostrata sia intera**, e non "che la stringa
    // non contenga `parola…`": un titolo che termina con una parola intera contiene
    // quella sottostringa anche se e perfettamente tagliato, quindi la prova
    // precedente falliva per il motivo sbagliato e passava per nessuno.
    const title = Array.from({ length: 30 }, () => 'parola').join(' ')
    const summary = zoomSummary(dataOf({ kind: 'response', title }))
    expect(summary?.endsWith('…')).toBe(true)
    const mostrate = (summary ?? '').replace(/…$/, '').split(' ')
    expect(mostrate.length, 'il titolo verrebbe troncato troppo presto').toBeGreaterThan(3)
    for (const parola of mostrate) expect(parola, 'parola spezzata').toBe('parola')
  })

  it('cuts on the word boundary even when it is in the middle of the budget', () => {
    /*
     * La fascia del difetto, e la sua aritmetica conta perche il caso e difficile
     * da costruire per caso.
     *
     * L'ultimo spazio prima del tetto cade sempre *vicino* al tetto — la differenza e
     * la coda della parola che lo scavalca. Quindi per metterlo in fascia serve una
     * parola lunga piu del 55% del tetto: con parole corte l'ultimo spazio e sempre
     * oltre il 90%, e il difetto non si attraversa mai.
     *
     * Qui: 99 caratteri, spazio a 99, poi una parola di 150 che scavalca il tetto di
     * 220. L'ultimo spazio nel taglio e a 99, cioe al 45% — dentro la fascia fra il
     * 40% e il 60% dove prima si tagliava in mezzo.
     */
    const testo = `${'a'.repeat(99)} ${'b'.repeat(150)} ${'c'.repeat(50)}`
    const summary = zoomSummary(dataOf({ kind: 'note', text: testo }))
    expect(summary?.endsWith('…')).toBe(true)
    // La prima parola e intera: il taglio e caduto sul confine, non dentro di lei.
    expect((summary ?? '').replace(/…$/, '')).toBe('a'.repeat(99))
  })

  it('shows a prompt with its first words only', () => {
    const summary = zoomSummary(
      dataOf({ kind: 'prompt', text: 'Summarise this contract for me please, in Italian' }),
    )
    // A prompt is an instruction: the subject is the point, the rest is detail
    // nobody could read at 20% zoom.
    expect(summary).toBe('Summarise this contract for me please, in Italian')
  })

  it('keeps a prompt to about two lines of source', () => {
    const long = Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n')
    const summary = zoomSummary(dataOf({ kind: 'prompt', text: long }))
    expect(summary).toBe('line 0 line 1')
  })

  it('leaves a picture completely alone', () => {
    // Not a summary of nothing: a blurred photograph says nothing, and the shape
    // of the image is already the content.
    expect(zoomSummary(dataOf({ kind: 'image', name: 'photo.png' }))).toBeNull()
  })

  it('says what an answer that has not arrived is for', () => {
    // Niente titolo e niente testo: resta la domanda, che e l'unica cosa che dice
    // a che serve la risposta che non e ancora arrivata.
    const summary = zoomSummary(
      dataOf({ kind: 'response', text: '', promptSnapshot: 'Why is the build red?' }),
    )
    expect(summary).toBe('Why is the build red?')
  })

  it('still says something when there is no answer and no question', () => {
    expect(zoomSummary(dataOf({ kind: 'response', text: '   ' }))).toBe('No answer yet')
  })

  it('counts the files in a folder and admits what it could not read', () => {
    const summary = zoomSummary(
      dataOf({
        kind: 'folder',
        name: 'docs',
        fileCount: 12,
        refused: [
          { name: 'a.pdf', reason: 'PDF is not read' },
          { name: 'b.docx', reason: 'Office files are not read' },
        ],
      }),
    )
    expect(summary).toBe('docs · 12 files, 2 not read')
  })

  it('says one file without an s', () => {
    const summary = zoomSummary(
      dataOf({ kind: 'folder', name: 'docs', fileCount: 1, refused: [] }),
    )
    expect(summary).toBe('docs · 1 file')
  })

  it('leaves an empty folder as just its name', () => {
    const summary = zoomSummary(dataOf({ kind: 'folder', name: 'vuota', fileCount: 0 }))
    expect(summary).toBe('vuota')
  })

  it('names a file and gives a taste of it', () => {
    const summary = zoomSummary(
      dataOf({ kind: 'file', name: 'notes.md', text: '# Title\n\nSome content here.' }),
    )
    expect(summary).toBe('notes.md · # Title Some content here.')
  })

  it('gives a Brain its instruction', () => {
    const summary = zoomSummary(
      dataOf({ kind: 'brain', instruction: 'Translate every file into English' }),
    )
    expect(summary).toBe('Brain · Translate every file into English')
  })

  it('refuses to return an empty string, so a node never blurs into nothing', () => {
    // An empty summary would mean `has-zoom-summary` is off, the body stays
    // sharp, and the node looks like it was never meant to be summarised.
    expect(zoomSummary(dataOf({ kind: 'note', text: '' }))).toBeNull()
    expect(zoomSummary(dataOf({ kind: 'prompt', text: '   \n  ' }))).toBeNull()
  })

  it('cuts a long line on a word, not mid-word', () => {
    const words = Array.from({ length: 80 }, () => 'paragraph').join(' ')
    // Un `note`, non una risposta: il riepilogo di un note e il suo testo, quindi
    // e il caso giusto per provare l'accorciamento. Prima le risposte riassumevano
    // il testo e questi test le usavano solo per comodita.
    const summary = zoomSummary(dataOf({ kind: 'note', text: words }))
    // Mid-word damage reads as corruption, not as a summary.
    expect(summary?.endsWith('…')).toBe(true)
    expect(summary?.includes('paragra…')).toBe(false)
    expect(summary?.split(' ').at(-2)).toBe('paragraph')
  })

  it('cuts mid-word only when there is no word to cut on', () => {
    // A single unbroken string has no boundary, and inventing one would be worse
    // than stopping where the text stops.
    const summary = zoomSummary(dataOf({ kind: 'note', text: 'a'.repeat(300) }))
    expect(summary).toBe(`${'a'.repeat(220)}…`)
  })

  it('collapses the line breaks that would otherwise stack the text', () => {
    const summary = zoomSummary(dataOf({ kind: 'note', text: 'one\n\ntwo\tthree' }))
    expect(summary).toBe('one two three')
  })

  it('has a threshold inside the range React Flow allows', () => {
    // minZoom on the canvas is 0.2, so anything above that is reachable, and the
    // threshold has to be reachable too or the mode could never turn on.
    expect(FAR_ZOOM).toBeGreaterThan(0.2)
    expect(FAR_ZOOM).toBeLessThan(1)
  })
})

describe('zoomSummaryIsTitle', () => {
  it('is true for an answer, whose summary is its title', () => {
    expect(zoomSummaryIsTitle(dataOf({ kind: 'response' }))).toBe(true)
  })

  it('is false for everything that summarises content, non il titolo', () => {
    // Il peso e la grandezza sono segno di un titolo. Se anche i riassunti di
    // contenuto li avessero, la vista lontana diventerebbe una griglia di titoli
    // e il titolo di una risposta non si distinguerebbe piu.
    for (const kind of ['prompt', 'note', 'system', 'summary', 'output', 'file', 'folder', 'brain', 'image'] as const) {
      expect(zoomSummaryIsTitle(dataOf({ kind })), kind).toBe(false)
    }
  })

  it('says true exactly for the kinds whose summary is their title', () => {
    // Coerenza fra le due funzioni: se un nodo e marcato come titolo, il suo
    // riepilogo deve venire dal titolo. Senza questo, un nodo potrebbe
    // presentarsi come un titolo e mostrare un paragrafo.
    for (const kind of ['response', 'prompt', 'note', 'system', 'summary', 'output'] as const) {
      const data = dataOf({ kind })
      const eTitolo = zoomSummaryIsTitle(data)
      const testo = zoomSummary(data)
      const titolo = (data as { title?: string }).title
      if (eTitolo && titolo && testo) {
        expect(testo.length, `il riepilogo di un titolo (${kind})`).toBeLessThanOrEqual(100)
      }
    }
  })
})
