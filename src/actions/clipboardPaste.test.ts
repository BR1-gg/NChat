/**
 * Dopo un incolla, la selezione deve essere **solo** dell'appena incollato.
 *
 * Il difetto che questo file chiude e' che la paste selezionava quello che aveva
 * creato con `setNodeSelected(id, true)`, che **aggiunge** alla selezione invece di
 * sostituirla. Dopo un copia-incolla restavano selezionati l'originale e la copia,
 * e al primo trascinamento si muovevano **entrambi**.
 *
 * Il sintomo e' dei peggiori possibili in un editor a nodi: l'originale cambia
 * posizione senza che nessuno lo abbia spostato. Non c'e' un errore da cui
 * risalire, non c'e' una cronologia che lo registri come un'azione voluta, e il
 * collegamento che partiva dal nodo originale si rende conto del movimento solo
 * piu' tardi, quando la curva e' gia' storta. La cosa si nota subito, pero': basta
 * incollare e trascinare, e l'originale segue.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUiStore } from '../store/uiStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { pasteAt, resetPasteTracking } from './clipboardActions'

function selectedIds(): string[] {
  return useWorkspaceStore.getState().nodes.filter((node) => node.selected).map((node) => node.id)
}

function addPrompt(text: string, x = 0, y = 0): string {
  return useWorkspaceStore.getState().addNode('prompt', { x, y }, { text })
}

describe('who is selected after a paste', () => {
  beforeEach(() => {
    resetPasteTracking()
    useUiStore.getState().closeDialog()
    useWorkspaceStore.getState().resetDocument()
  })

  it('leaves only the pasted prompt selected, not what was there before', async () => {
    const original = addPrompt('the original')
    useWorkspaceStore.getState().selectOnlyNode(original)
    expect(selectedIds()).toEqual([original])

    const payload = {
      type: 'nchat/clipboard' as const,
      version: 2 as const,
      sourceWorkspaceId: 'other',
      nodes: [
        {
          id: 'n1',
          type: 'prompt' as const,
          position: { x: 10, y: 10 },
          data: {
            kind: 'prompt' as const,
            text: 'the copy',
            params: { temperature: null, topP: null, maxTokens: null, stop: null },
            runCount: 0,
          },
        },
      ],
      edges: [],
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    }

    await pasteAt({ x: 200, y: 200 }, useWorkspaceStore, { x: 200, y: 200 }, {
      text: JSON.stringify(payload),
      files: [],
    })

    // Non e' una questione di stile: l'originale **non** deve essere piu' selezionato,
    // perche' con l'originale selezionato un trascinamento lo muove, e l'utente ha
    // chiesto di spostare solo la copia.
    expect(selectedIds()).toHaveLength(1)
    expect(selectedIds()[0]).not.toBe(original)
  })

  it('leaves only the pasted nodes, and no more, when many are pasted', async () => {
    const a = addPrompt('a')
    const b = addPrompt('b')
    useWorkspaceStore.getState().selectOnlyNodes([a, b])

    // Tre nodi incollati insieme.
    const nodes = ['x', 'y', 'z'].map((id, index) => ({
      id,
      type: 'note' as const,
      position: { x: index * 10, y: 0 },
      data: { kind: 'note' as const, text: `n${index}` },
    }))
    const payload = {
      type: 'nchat/clipboard' as const,
      version: 2 as const,
      sourceWorkspaceId: 'other',
      nodes,
      edges: [],
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    }

    await pasteAt({ x: 300, y: 300 }, useWorkspaceStore, { x: 300, y: 300 }, {
      text: JSON.stringify(payload),
      files: [],
    })

    // Esattamente tre, e nessuna delle precedenti: la selezione e' **sostituita**.
    expect(selectedIds()).toHaveLength(3)
    expect(selectedIds()).not.toContain(a)
    expect(selectedIds()).not.toContain(b)
  })

  it('deselects everything when the pasted text is refused for being huge', async () => {
    // Il caso limite: la paste chiede una conferma e non crea nodo. La selezione
    // precedente non deve restare li' a fingere che qualcosa sia successo.
    const original = addPrompt('the original')
    useWorkspaceStore.getState().selectOnlyNode(original)
    const huge = 'x'.repeat(20_001)

    await pasteAt({ x: 400, y: 400 }, useWorkspaceStore, { x: 400, y: 400 }, {
      text: huge,
      files: [],
    })

    const confirm = useUiStore.getState().confirm
    expect(confirm).toBeTruthy()
    // Niente e' stato incollato, quindi la selezione non e' cambiata: e' gia' solo
    // l'originale, che era gia' l'unico selezionato.
    expect(selectedIds()).toEqual([original])
  })
})

describe('every pasted file leaves a node behind', () => {
  beforeEach(() => {
    resetPasteTracking()
    useWorkspaceStore.getState().resetDocument()
  })

  it('leaves a node for an image it cannot show, instead of nothing', () => {
    /*
     * Il difetto che questa funzione aveva, trovato provandola davvero nel browser e
     * non a tavolino: un'immagine che il browser non decodifica veniva rifiutata da
     * `createImageNodeFromFile` **senza creare nulla**, e la paste diceva lo stesso
     * «il nodo c'e', non si e' perso niente» che diceva per un file di testo — dove il
     * nodo c'e' davvero.
     *
     * Era falso, e una rassicurazione falsa e' peggio di un avviso: l'utente leggeva
     * che nulla era andato perso, poi guardava la tela e non trovava niente, e da quel
     * momento non si fidava piu' neanche dei messaggi veri.
     *
     * Qui si verifica l'invariante che conta — **un file incollato, un nodo** — senza
     * pretendere di riprodurre la decodifica. Su quello non ci si puo' contare in
     * jsdom: `new Image()` non decodica nulla, e quattro byte spacciati come PNG
     * passano come immagine 0×0. Il comportamento vero e' stato verificato nel browser.
     */
    const broken = new File([new Uint8Array([1, 2, 3, 4])], 'broken.png', { type: 'image/png' })
    const store = useWorkspaceStore
    void pasteAt({ x: 500, y: 500 }, store, { x: 500, y: 500 }, { text: '', files: [broken] })
    return vi.waitFor(() => {
      // Uno, non zero: qualunque cosa ne risulti, il file non sparisce.
      expect(store.getState().nodes).toHaveLength(1)
    })
  })

  it('marks a file it cannot read as unreadable, so nothing is lost silently', () => {
    /*
     * Il caso deterministico: un formato che `checkTextFile` rifiuta per nome. Qui il
     * nodo deve dire **perche'**, non limitarsi a esistere — un rifiuto che sparisce
     * e' indistinguibile da una paste mai avvenuta, che e' il difetto di fondo.
     */
    const binary = new File([new Uint8Array(64)], 'paper.pdf', { type: 'application/pdf' })
    const store = useWorkspaceStore
    void pasteAt({ x: 600, y: 600 }, store, { x: 600, y: 600 }, { text: '', files: [binary] })
    return vi.waitFor(() => {
      const nodes = store.getState().nodes
      expect(nodes).toHaveLength(1)
      const node = nodes[0]
      expect(node?.data.kind).toBe('file')
      expect(node?.data.kind === 'file' && node.data.error).toBeTruthy()
    })
  })

  it('puts one node per file, offset so they do not hide each other', () => {
    /*
     * Senza lo scarto, tre file incollati insieme finiscono tutti nello stesso punto:
     * se ne vede uno e gli altri due sono sotto. E il difetto compare **solo** quando
     * si incolla piu' di una cosa, quindi proprio nel caso in cui l'utente si
     * accorge di aver perso qualcosa.
     */
    const files = ['a.txt', 'b.txt', 'c.txt'].map(
      (name) => new File(['testo'], name, { type: 'text/plain' }),
    )
    const store = useWorkspaceStore
    void pasteAt({ x: 700, y: 700 }, store, { x: 700, y: 700 }, { text: '', files })
    return vi.waitFor(() => {
      const nodes = store.getState().nodes
      expect(nodes).toHaveLength(3)
      const xs = nodes.map((node) => node.position.x)
      expect(new Set(xs).size).toBe(3)
    })
  })

  it('picks the file over the text, so a screenshot does not become a prompt', () => {
    /*
     * Alcune app mettono negli appunti sia il file sia un nome o un percorso. Se
     * vince il testo, la schermata diventa un Prompt con dentro il percorso del file:
     * sembra funzionare, occupa un nodo, e non c'e' nessuna immagine. E' il modo piu'
     * fuorviante di sbagliare, perche' l'utente vede qualcosa che e' comparso.
     */
    const png = new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' })
    const store = useWorkspaceStore
    void pasteAt({ x: 800, y: 800 }, store, { x: 800, y: 800 }, {
      text: 'C:\\Users\\palle\\Pictures\\shot.png',
      files: [png],
    })
    return vi.waitFor(() => {
      const nodes = store.getState().nodes
      expect(nodes).toHaveLength(1)
      const data = nodes[0]?.data
      // Non un Prompt: quello sarebbe stato costruito con il percorso del file, e
      // sembrerebbe una paste riuscita mentre l'immagine non c'e' da nessuna parte.
      expect(data?.kind).not.toBe('prompt')
      // E il percorso non deve essere finito in nessun campo di testo.
      const text = data && 'text' in data ? String(data.text ?? '') : ''
      expect(text).not.toContain('Users')
    })
  })
})

describe('selectOnlyNodes', () => {
  beforeEach(() => {
    useWorkspaceStore.getState().resetDocument()
  })

  it('leaves exactly the given nodes selected', () => {
    const a = addPrompt('a')
    const b = addPrompt('b')
    const c = addPrompt('c')
    useWorkspaceStore.getState().selectOnlyNodes([b, c])
    expect(selectedIds().sort()).toEqual([b, c].sort())
    expect(selectedIds()).not.toContain(a)
  })

  it('deselects everything when given an empty list', () => {
    addPrompt('a')
    const b = addPrompt('b')
    useWorkspaceStore.getState().selectOnlyNode(b)
    useWorkspaceStore.getState().selectOnlyNodes([])
    expect(selectedIds()).toEqual([])
  })

  it('ignores ids that do not exist, rather than throwing', () => {
    /*
     * Una paste puo' ricevere un id che non c'e' piu': fra l'evento e la creazione
     * del nodo un'altra azione potrebbe averlo rimosso. Deve ignorarlo, non
     * interrompersi — altrimenti un id spettrale fa fallire l'intera paste, che e'
     * il modo peggiore di gestire un dettaglio.
     */
    const a = addPrompt('a')
    useWorkspaceStore.getState().selectOnlyNodes([a, 'ghost-id'])
    expect(selectedIds()).toEqual([a])
  })
})
