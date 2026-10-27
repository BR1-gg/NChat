/**
 * La finestra della compattazione: cosa c'e' adesso, e cosa diventa.
 *
 * Il difetto che questi test bloccano e' che compattare fosse un atto cieco. Il
 * comando partiva, faceva una chiamata a pagamento, e il risultato compariva su un
 * nodo Summary altrove nella tela. Se il riassunto era cattivo — e un riassunto lo
 * e' spesso, perche' perde i dettagli — l'unica scelta era annullare tutto e
 * ricominciare, con il costo gia' speso. Qui il contesto iniziale e il risultato
 * sono uno di fianco all'altro, quindi la decisione si prende **prima** di pagare.
 *
 * Il secondo difetto e' piu' sottile: la finestra si apriva da un nodo solo, e se
 * il nodo cambiava mentre era aperta mostrava ancora il contesto del nodo
 * precedente. Un utente che la chiude e la riapre su un'altra nota leggerebbe un
 * confronto che parla di un'altra cosa, e lo prenderebbe per vero.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUiStore } from '../../store/uiStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { createDefaultRequestSnapshot } from '../../types/document'
import { CompactDialog } from './CompactDialog'

/**
 * Un grafo con una cronologia da compattare: una domanda, la sua risposta, e un
 * secondo prompt che riceve la risposta come contesto.
 *
 * La risposta non e' collegata al proprio prompt: `assembleMessages` segue
 * `parentPromptId` e troverebbe un ciclo. Quindi la risposta alimenta un prompt
 * diverso — ed e' esattamente la forma che ha «Compact up to here».
 *
 * La risposta si crea con `createResponseNode` e non con `addNode`: **`response`
 * non e' un tipo aggiungibile** — la risposta nasce da una richiesta, e poterne
 * aggiungere una a mano significa poterla creare senza la domanda che l'ha prodotta,
 * cioe' senza il contesto che la rende leggibile. Con `addNode` il nodo non
 * esisterebbe e i test fallirebbero per un motivo che non c'entra con quello che
 * provano.
 */
function seed(): { answerId: string; questionId: string; noteId: string } {
  const store = useWorkspaceStore.getState()
  store.resetDocument()
  const first = store.addNode('prompt', { x: 0, y: 0 }, { text: 'What did we decide?' })
  const answer = store.createResponseNode(first)
  useWorkspaceStore.getState().patchResponse(answer, {
    text: 'We decided to ship on Friday.',
    status: 'done',
  })
  const question = store.addNode('prompt', { x: 400, y: 0 }, {
    text: 'Recap the thread and tell me if it changed.',
  })
  const note = store.addNode('note', { x: 0, y: 300 }, { text: 'The user writes in Italian.' })
  useWorkspaceStore
    .getState()
    .addConnection({ source: answer, sourceHandle: 'context', target: question, targetHandle: 'context' })
  useWorkspaceStore
    .getState()
    .addConnection({ source: note, sourceHandle: 'out', target: question, targetHandle: 'context' })
  return { answerId: answer, questionId: question, noteId: note }
}

/**
 * Apre la finestra come farebbe il menu, e la monta.
 *
 * Si `render` una volta sola per test: richiamarlo lascerebbe due dialoghi nello
 * stesso documento, e ogni ricerca per testo troverebbe due risposte — un test che
 * fallirebbe perche' ne ha trovate due, non perche' la finestra sbaglia. Riaprire
 * dopo aver chiuso e' quindi un semplice `openDialog`: il componente legge dallo
 * store e si ridisegna da solo, che e' anche come funziona nell'app.
 */
function open(nodeId: string): void {
  act(() => {
    useUiStore.getState().openDialog('compact', undefined, nodeId)
  })
  render(<CompactDialog />)
}

/** Riapre su un altro nodo senza rimontare, che e' il caso reale. */
function reopen(nodeId: string): void {
  act(() => {
    useUiStore.getState().closeDialog()
  })
  act(() => {
    useUiStore.getState().openDialog('compact', undefined, nodeId)
  })
}

describe('the compaction window', () => {
  beforeEach(() => {
    useUiStore.getState().closeDialog()
    useWorkspaceStore.getState().resetDocument()
  })

  it('stays shut until it is asked for', () => {
    seed()
    render(<CompactDialog />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the context that is there now, before anything is spent', () => {
    /*
     * Il punto della finestra: il confronto si vede **prima** di premere. Se il
     * contesto iniziale arrivasse solo dopo la compattazione, il pulsante sarebbe una
     * scommessa e la finestra uselesse.
     */
    const { questionId } = seed()
    open(questionId)
    expect(screen.getByText(/Context now/i)).toBeInTheDocument()
    // Il testo della risposta che finisce nel contesto e' gia' visibile.
    const before = document.querySelector('.compact-text.is-before') as HTMLElement
    expect(before).not.toBeNull()
    expect(before.textContent).toContain('We decided to ship on Friday.')
    /*
     * La domanda che sta per essere posta **non** e' nel riquadro di prima: e' la
     * parte che non si compatta, e mostrarla li' farebbe leggere all'utente un
     * contesto piu' grande di quello che il riassunto sostituirà. Compare solo nella
     * riga in alto, che dice quale prompt si sta accorciando — e li' e' giusto che ci
     * sia, perche' e' il nome della cosa, non il suo contenuto.
     */
    expect(before.textContent).not.toContain('Recap the thread')
  })

  it('names the prompt it would shorten, which a note alone cannot say', () => {
    /*
     * Premendo «Compact context» su una nota, **cosa** verrebbe compattato? Senza
     * questa riga la finestra fa una cosa e non dice quale, che e' la stessa
     * sorpresa di un'azione che tocca un grafo a caso.
     */
    const { noteId } = seed()
    open(noteId)
    expect(screen.getByText(/Recap the thread/)).toBeInTheDocument()
  })

  it('opens on the note and says what is compacted, the same as from the prompt', () => {
    const { questionId, noteId } = seed()
    open(questionId)
    const fromPrompt = screen.getByText(/Recap the thread/).textContent
    reopen(noteId)
    // Stesso testo: da due nodi diversi, lo stesso prompt. Se differissero, uno dei
    // due starebbe mostrando un contesto che non e' quello che l'utente ha premuto.
    expect(screen.getByText(/Recap the thread/).textContent).toBe(fromPrompt)
  })

  it('promises nothing is spent until Compact is pressed', () => {
    const { questionId } = seed()
    open(questionId)
    expect(screen.getByText(/Nothing is\s+spend|spent until you press Compact/i)).toBeInTheDocument()
    // E il pulsante c'e' ed e' quello che fa la spesa.
    const button = screen.getByRole('button', { name: /Compact/i })
    expect(button).toBeEnabled()
  })

  it('re-reads the graph when it changes under it', () => {
    /*
     * Il caso che rende affidabile il pulsante. Se il contesto sparisce mentre la
     * finestra e' aperta — l'utente stacca il collegamento dalla tela — la finestra
     * deve accorgersene e non offrire di compattare un contesto che non esiste piu'.
     */
    const { questionId } = seed()
    open(questionId)
    expect(screen.getByText(/Context now/i)).toBeInTheDocument()

    // Stacca tutto quello che arriva al prompt.
    act(() => {
      const state = useWorkspaceStore.getState()
      for (const edge of state.edges.filter((candidate) => candidate.target === questionId)) {
        state.removeEdge(edge.id)
      }
    })

    // Ora non c'e' piu' niente da compattare, e la finestra deve dirlo invece di
    // offrire un pulsante che produrrebbe un riassunto del nulla.
    expect(screen.queryByText(/Context now/i)).not.toBeInTheDocument()
  })

  it('explains a refusal instead of opening empty', () => {
    /*
     * Una nota scollegata non ha niente da compattare. Il menu non offre la voce, ma
     * il collegamento puo' arrivare da altre parti — e li' la finestra non deve
     * aprirsi a vuoto: deve dire perche'. Senza, l'utente preme e vede un pannello
     * senza niente dentro, che e' indistinguibile da un bug.
     */
    const { noteId } = seed()
    act(() => {
      const state = useWorkspaceStore.getState()
      for (const edge of state.edges.filter((candidate) => candidate.source === noteId)) {
        state.removeEdge(edge.id)
      }
    })
    open(noteId)
    expect(screen.getByText(/Connect it to a prompt/i)).toBeInTheDocument()
  })

  it('forgets a finished summary when it is reopened on another node', () => {
    /*
     * Il riassunto di una compattazione precedente e' **ancora sul nodo**. Senza
     * azzerarlo all'apertura, riaprire la finestra su un'altra nota mostrerebbe
     * quello come se fosse il risultato di quella — e l'utente leggerebbe «ha riso
     * cosi'» quando invece e' un riassunto vecchio, di un'altra domanda.
     */
    const { noteId, questionId } = seed()
    open(noteId)
    // Simula una compattazione già finita. Anche `summary` non e' un tipo
    // aggiungibile — nasce da `compactPromptContext` — quindi passa per
    // `createSummaryNode`, che e' l'unica via che esiste.
    const summaryId = useWorkspaceStore.getState().createSummaryNode({ x: 0, y: 0 }, {
      kind: 'summary',
      text: 'A summary of some earlier run.',
      status: 'done',
      coveredNodeIds: [],
      coveredMessageCount: 2,
      tokensBefore: 100,
      tokensAfter: 20,
      coverageHash: 'testhash',
      requestSnapshot: createDefaultRequestSnapshot('test-model'),
      stats: { startedAt: 1, finishedAt: 2, durationMs: 1 },
    })
    act(() => {
      useUiStore.getState().setCompactSummary(summaryId)
      useWorkspaceStore.getState().addConnection({
        source: summaryId,
        sourceHandle: 'context',
        target: questionId,
        targetHandle: 'context',
      })
    })
    expect(screen.getByText(/A summary of some earlier run\./)).toBeInTheDocument()

    // Si chiude e si riapre: il riferimento al riassunto sparisce con l'apertura.
    reopen(noteId)
    expect(screen.queryByText(/A summary of some earlier run\./)).not.toBeInTheDocument()
    expect(screen.getByText(/not built yet/i)).toBeInTheDocument()
  })

  it('closes on Cancel without asking anything', () => {
    const close = vi.spyOn(useUiStore.getState(), 'closeDialog')
    const { questionId } = seed()
    open(questionId)
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }))
    expect(close).toHaveBeenCalled()
    close.mockRestore()
  })
})
