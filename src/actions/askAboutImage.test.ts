/**
 * Chiedere qualcosa di un'immagine senza dover collegare niente a mano.
 *
 * Il difetto che questo file chiude e' che per farlo bisognava **trascinare** la
 * maniglia del nodo immagine su un prompt, e su un grafo grande e' una operazione da
 * tre gesti su una maniglia di otto pixel. La parte peggiore non era il fastidio: era
 * che la domanda — che e' la parte difficile — non poteva essere scritta da nessuna
 * parte finche' quel collegamento non esisteva. La parte difficile dipendeva da un
 * gesto meccanico.
 *
 * E il vincolo che conta di piu': il collegamento che nasce dal bottone deve essere
 * un **bordo come tutti gli altri**. Se fosse un aggancio speciale, l'utente
 * dovrebbe imparare che esistono due modi di collegare un'immagine a un prompt, e uno
 * dei due si comporterebbe diversemente dagli altri in mille modi. Invece la strada
 * breve e quella lunga sono lo stesso oggetto: si vede, si stacca, si ricolllega.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { useUiStore } from '../store/uiStore'
import { useWorkspaceStore, workspaceDocumentFromState } from '../store/workspaceStore'
import { askAboutImage } from './imageActions'
import { assembleMessages } from '../logic/assemble'
import { document, edge, image, prompt as promptNode } from '../test/factories'

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function addImage(overrides: Record<string, unknown> = {}): string {
  return useWorkspaceStore.getState().addNode(
    'image',
    { x: 0, y: 0 },
    { name: 'shot.png', mediaType: 'image/png', src: PNG, width: 1, height: 1, sizeBytes: 40, ...overrides },
  )
}

describe('asking about an image', () => {
  beforeEach(() => {
    useUiStore.getState().closeDialog()
    useWorkspaceStore.getState().resetDocument()
  })

  it('creates a prompt and connects the image, in one press', () => {
    const id = addImage()
    const result = askAboutImage(id, useWorkspaceStore)
    expect(result.promptId).toBeTruthy()
    expect(result.refused).toBeUndefined()

    const state = useWorkspaceStore.getState()
    const created = state.nodes.find((node) => node.id === result.promptId)
    expect(created?.type).toBe('prompt')

    const edgeToPrompt = state.edges.find((candidate) => candidate.target === result.promptId)
    expect(edgeToPrompt?.source).toBe(id)
    // L'ingresso dedicato, non il contesto: il contesto e' testo e finirebbe nel
    // messaggio come stringa, e il modello non vedrebbe la foto.
    expect(edgeToPrompt?.targetHandle).toBe('image')
    expect(edgeToPrompt?.kind).toBe('image')
  })

  it('puts the prompt where it can be seen, not on top of the picture', () => {
    /*
     * Il prompt e' piu' largo dell'immagine. Se nascesse nella stessa x finirebbe
     * sopra la foto — che e' la cosa che si sta per guardare — e si leggerebbe come un
     * errore di posizione. La foto e' il soggetto; la domanda sta accanto.
     */
    const id = useWorkspaceStore.getState().addNode('image', { x: 100, y: 200 }, {
      name: 'shot.png', mediaType: 'image/png', src: PNG, width: 1, height: 1, sizeBytes: 40,
    })
    const result = askAboutImage(id, useWorkspaceStore)
    const created = useWorkspaceStore.getState().nodes.find((node) => node.id === result.promptId)
    expect(created?.position.x).toBeGreaterThan(100)
    expect(created?.position.y).toBe(200)
  })

  it('puts the caret in the question, which is the hard part', () => {
    const id = addImage()
    const result = askAboutImage(id, useWorkspaceStore)
    const ui = useUiStore.getState()
    // Selezionato **e** con il fuoco: selezionato da solo lascerebbe il cursore
    // altrove, e l'utente dovrebbe cercare dove scrivere.
    expect(ui.selectedNodeId).toBe(result.promptId)
    expect(ui.focusNodeId).toBe(result.promptId)
  })

  it('makes the image actually reach the prompt', () => {
    /*
     * Il collegamento non basta: deve arrivare al modello come **immagine**, non come
     * un nome di file. Se il bordo ci fosse ma il testo non contenesse il prompt, il
     * modello risponderebbe a parole senza sapere cosa avesse davanti — una risposta
     * plausibile e falsa, che e' il modo peggiore in cui questa cosa puo' fallire.
     */
    const id = addImage()
    const result = askAboutImage(id, useWorkspaceStore)
    const promptId = result.promptId
    expect(promptId).toBeTruthy()
    useWorkspaceStore.getState().updateNodeData(promptId!, { text: 'What does this say?' })
    const { messages } = assembleMessages(workspaceDocumentFromState(useWorkspaceStore.getState()), promptId!)
    const user = messages[messages.length - 1]
    const parts = Array.isArray(user?.content) ? user.content : []
    expect(parts.some((part) => part.type === 'image_url')).toBe(true)
    expect(
      parts.some((part) => part.type === 'text' && String(part.text).includes('What does this say?')),
    ).toBe(true)
  })
})

describe('the connection is optional, because it is an ordinary one', () => {
  beforeEach(() => {
    useUiStore.getState().closeDialog()
    useWorkspaceStore.getState().resetDocument()
  })

  it('can be detached, and the prompt stays as an ordinary prompt', () => {
    /*
     * Se il collegamento fosse un aggancio speciale, staccarlo non sarebbe possibile e
     * l'utente sarebbe legato a una strada sola. Qui si stacca come qualsiasi altro
     * bordo: e' la prova che la strada breve e quella lunga sono lo stesso oggetto.
     */
    const id = addImage()
    const { promptId } = askAboutImage(id, useWorkspaceStore)
    const state = useWorkspaceStore.getState()
    const edgeToPrompt = state.edges.find((candidate) => candidate.target === promptId)
    expect(edgeToPrompt).toBeTruthy()

    state.removeEdge(edgeToPrompt!.id)
    expect(useWorkspaceStore.getState().edges).toHaveLength(0)
    expect(useWorkspaceStore.getState().nodes.find((node) => node.id === promptId)?.type).toBe('prompt')
  })

  it('lets the same image feed a second prompt, wired by hand as before', () => {
    const id = addImage()
    const first = askAboutImage(id, useWorkspaceStore)
    // Il secondo prompt nasce dal negozio, non da una fabbrica: `prompt()` costruisce
    // un nodo **scollegato**, e collegargli qualcosa fallirebbe con «nodo inesistente» —
    // un errore che sembrerebbe del regolamento dei collegamenti e non del test.
    const other = useWorkspaceStore
      .getState()
      .addNode('prompt', { x: 800, y: 0 }, { text: 'A different question about the same picture.' })

    const result = useWorkspaceStore.getState().addConnection({
      source: id,
      sourceHandle: 'out',
      target: other,
      targetHandle: 'image',
    })
    // `addConnection` restituisce il bordo creato, o un errore. Il secondo prompt
    // deve essere accettato, quindi nessuno dei due.
    expect('kind' in result && typeof result.kind === 'string' ? result.kind : null).toBe('image')

    // Entrambi i prompt ricevono la foto, e nessuno dei due e' stato disturbato.
    //
    // Il primo riceve anche un testo, perche' e' quello che succede davvero: il
    // bottone apre il prompt con il cursore dentro e l'utente scrive. Serve anche a
    // ricordare una cosa che sembra un difetto e non lo e': **un prompt vuoto non
    // manda niente, nemmeno la foto**. `assembleMessages` salta i prompt senza testo,
    // perche' una richiesta senza domanda non e' una richiesta — e una foto da sola
    // non e' una domanda.
    useWorkspaceStore.getState().updateNodeData(first.promptId!, { text: 'What is in this picture?' })
    for (const target of [other, first.promptId!]) {
      const { messages } = assembleMessages(
        workspaceDocumentFromState(useWorkspaceStore.getState()),
        target,
      )
      const content = messages[messages.length - 1]?.content
      const parts = Array.isArray(content) ? content : []
      expect(parts.some((p) => p.type === 'image_url')).toBe(true)
    }
    expect(useWorkspaceStore.getState().edges).toHaveLength(2)
  })

  it('sends nothing at all while the new question is still empty', () => {
    /*
     * Il caso appena descritto, verificato perche' e' il primo istante dopo aver
     * premuto il bottone. Un prompt appena creato e vuoto non deve produrre una
     * richiesta a meta' — solo la foto, senza domanda — perche' il modello
     * risponderebbe a qualcosa che non e' stato chiesto, e l'utente non saprebbe
     * da dove venga quella risposta.
     */
    const id = addImage()
    const { promptId } = askAboutImage(id, useWorkspaceStore)
    const { messages } = assembleMessages(
      workspaceDocumentFromState(useWorkspaceStore.getState()),
      promptId!,
    )
    expect(messages.filter((message) => message.role === 'user')).toHaveLength(0)
  })

  it('refuses on an empty image, rather than making a prompt with no picture', () => {
    /*
     * Un prompt collegato a un ingresso vuoto manderebbe solo parole, e il modello
     * risponderebbe senza sapere che non aveva guardato niente. Meglio non creare
     * nulla, e dire perche'.
     */
    const id = addImage({ src: '' })
    const before = useWorkspaceStore.getState().nodes.length
    const result = askAboutImage(id, useWorkspaceStore)
    expect(result.promptId).toBeUndefined()
    expect(result.refused).toMatch(/picture/i)
    expect(useWorkspaceStore.getState().nodes).toHaveLength(before)
  })

  it('accepts a video on its poster frame, which is what the model would see', () => {
    const id = addImage({ isVideo: true, src: 'blob:x', posterSrc: PNG })
    const result = askAboutImage(id, useWorkspaceStore)
    expect(result.promptId).toBeTruthy()
  })

  it('says so when the node is not an image at all', () => {
    const p = useWorkspaceStore.getState().addNode('prompt', { x: 0, y: 0 }, { text: 'just a prompt' })
    const result = askAboutImage(p, useWorkspaceStore)
    expect(result.promptId).toBeUndefined()
    expect(result.refused).toBeTruthy()
  })
})

describe('a question left on the image node', () => {
  /*
   * Il campo e' sparito dall'interfaccia, ma una domanda scritta quando esisteva
   * continua a viaggiare con l'immagine.
   *
   * La ragione per cui non si cancella e' che il campo finisce nelle richieste: se
   * sparisse, un documento gia' salvato manderebbe al modello una domanda in meno
   * senza avvisare, e la risposta cambierebbe da un giorno all'altro senza che
   * nissuno abbia toccato niente. E non si toglie nemmeno la **visibilita'**: una
   * domanda che non si vede e non si puo' cancellare e' peggio di una che non e' mai
   * stata scritta.
   */

  it('still travels with the image', () => {
    const shot = image('shot.png', { caption: 'Only the text in the picture.' })
    const question = promptNode('Describe it.')
    const doc = document([shot, question], [edge(shot, question, 'image')])
    const { messages } = assembleMessages(doc, question.id)
    const content = messages[messages.length - 1]?.content
    const text = Array.isArray(content)
      ? content.filter((p) => p.type === 'text').map((p) => String((p as { text: string }).text)).join('\n')
      : String(content ?? '')
    expect(text).toContain('Only the text in the picture.')
  })

  it('adds nothing when there is no old question', () => {
    const shot = image('shot.png')
    const question = promptNode('Describe it.')
    const doc = document([shot, question], [edge(shot, question, 'image')])
    const { messages } = assembleMessages(doc, question.id)
    const content = messages[messages.length - 1]?.content
    const text = Array.isArray(content)
      ? content.filter((p) => p.type === 'text').map((p) => String((p as { text: string }).text)).join('\n')
      : String(content ?? '')
    expect(text).not.toContain('About the image')
  })
})
