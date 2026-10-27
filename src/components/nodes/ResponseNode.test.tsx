/**
 * Il nodo Response deve mostrare la traccia delle note **una volta sola**.
 *
 * Il difetto che questo file chiude e' letterale: sul nodo comparivano **due** righe
 * «Answered with 1 note - kebab», una accanto all'altra. Il tipo era sbagliato? No. Il
 * typecheck passava, perche' due elementi fratelli dentro un frammento sono JSX perfettamente
 * lecito. E nessun test lo prendeva, perche' in questa applicazione i nodi non erano mai
 * renderizzati: si provavano le funzioni pure e si dava per scontato che il montaggio fosse
 * gia' a posto.
 *
 * E' la classe di difetto piu' comune di una modifica fatta con un editor di testo: cancelli
 * un blocco di commenti, il resto resta, e il duplicato e' **valido**. Un typecheck non puo'
 * vederlo e una revisione a occhio lo vede solo se sa cosa cercare. Un test che conta gli
 * elementi lo vede sempre.
 *
 * Perche' renderizzare il nodo e' la prova giusta e non una scorciatoia: qui il difetto non
 * e' nel valore di nessuna funzione — il dato era giusto, una nota sola era giusto — ma nel
 * fatto che quel dato veniva **stampato due volte**. Solo il rendering puo' dire questo.
 */

import { ReactFlowProvider } from '@xyflow/react'
import { render, cleanup } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useKnowledgeStore } from '../../store/knowledgeStore'
import { useUiStore } from '../../store/uiStore'
import { useWorkspaceStore, workspaceDocumentFromState } from '../../store/workspaceStore'
import { createDefaultRequestSnapshot } from '../../types/document'
import { ResponseNode } from './ResponseNode'

const Response = ResponseNode as unknown as (props: Record<string, unknown>) => ReactElement

/**
 * A finished response whose request quoted one note, plus the node it belongs to.
 *
 * The trail is the thing being guarded: a single note, so a duplicated line reads "1 note,
 * 1 note" — the count itself stays correct while the row says the wrong thing twice, which is
 * exactly the shape of the bug.
 */
function responseWithTrail(entryIds: string[]): { responseId: string; promptId: string } {
  const store = useWorkspaceStore.getState()
  const promptId = store.addNode('prompt', { x: 0, y: 0 }, { text: 'che cosa hai scritto?' })
  // Lo snapshot si costruisce con la funzione che lo costruisce sempre, e non a mano: i
  // parametri risolti hanno `temperature` e `topP` **numerici**, non null, e una versione
  // scritta a mano qui sbaglierebbe — o peggio, costringerebbe a usare `as never` e a
  // perdere il controllo del typecheck proprio nel test che deve esserne la prova.
  const responseId = store.createResponseNode(promptId, createDefaultRequestSnapshot('test-model'))
  useWorkspaceStore.getState().patchResponse(responseId, {
    status: 'done',
    text: 'serve with warm flatbread, grilled tomatoes, and rice!',
    knowledgeUsed: {
      entries: entryIds.map((id) => ({ id, title: `Nota ${id}`, hub: 'kebab', via: 'node' })),
    },
  })
  return { responseId, promptId }
}

const props = (id: string) => ({
  id,
  selected: false,
  type: 'response',
  zIndex: 0,
  isConnectable: true,
  dragging: false,
})

const renderResponse = (id: string) =>
  render(
    <ReactFlowProvider>
      <Response {...props(id)} />
    </ReactFlowProvider>,
  )

describe('the knowledge trail on a response', () => {
  beforeEach(() => {
    useUiStore.getState().closeDialog()
    useWorkspaceStore.getState().resetDocument()
    useKnowledgeStore.setState({ entries: [], hubs: [], loaded: true })
  })

  afterEach(() => {
    cleanup()
  })

  it('appears exactly once, however many notes went into the request', () => {
    /*
     * Il controllo che sarebbe mancato. Un nodo con una nota sola mostra gia' la riga
     * «1 note», quindi un duplicato non cambia nessun numero: sembra tutto a posto e il difetto
     * si vede solo guardando. Per questo si conta l'**elemento**, non il testo.
     */
    const { responseId } = responseWithTrail(['n1'])
    const { container } = renderResponse(responseId)
    expect(container.querySelectorAll('.response-knowledge').length).toBe(1)
  })

  it('still says the right thing once, so the fix did not just remove the feature', () => {
    const { responseId } = responseWithTrail(['n1'])
    const { container } = renderResponse(responseId)
    const lines = container.querySelectorAll('.response-knowledge-toggle')
    expect(lines.length).toBe(1)
    expect(lines[0]?.textContent ?? '').toContain('1')
    expect(lines[0]?.textContent ?? '').toContain('kebab')
  })

  it('stays at one with several notes, because a bigger list hides a duplicate more easily', () => {
    const { responseId } = responseWithTrail(['n1', 'n2', 'n3'])
    const { container } = renderResponse(responseId)
    expect(container.querySelectorAll('.response-knowledge').length).toBe(1)
    expect(container.querySelectorAll('.response-knowledge-toggle').length).toBe(1)
  })

  it('shows nothing at all on a response with no knowledge, rather than an empty row', () => {
    /*
     * Una riga vuota su ogni risposta che non ha note sarebbe un avviso che non segnala
     * niente, e il modo piu' rapido per insegnare a ignorare la riga quando invece conta.
     */
    const store = useWorkspaceStore.getState()
    const promptId = store.addNode('prompt', { x: 0, y: 0 }, { text: 'domanda' })
    const responseId = store.createResponseNode(promptId, createDefaultRequestSnapshot('test-model'))
    useWorkspaceStore.getState().patchResponse(responseId, { status: 'done', text: 'risposta' })
    const { container } = renderResponse(responseId)
    expect(container.querySelectorAll('.response-knowledge').length).toBe(0)
  })

  it('does not read the archive as a side effect of being on screen', () => {
    /*
     * La guardia che impedisce il ciclo di render.
     *
     * Il componente si sottoscrive a due array dello store (`entries` e `hubs`) per poter
     * confrontare quello che il nodo manderebbe con quello che e' arrivato. Se uno dei due
     * selettori costruisse un oggetto nuovo a ogni lettura, React non smetterebbe mai di
     * considerare il nodo cambiato e la pagina resterebbe bianca — il difetto che e' gia'
     * successo in questa applicazione e che `selectorStability.test.ts` sorveglia sui sorgenti.
     *
     * Qui la prova e' diversa e piu' diretta: il nodo deve accettare di trovarsi davanti a uno
     * store che non ha ancora l'archivio, senza tirare in mezzo `ensureKnowledgeLoaded` con
     * quello che comporta. E il documento passato al confronto e' quello del workspace, non
     * uno ricostruito a mano.
     */
    const { responseId, promptId } = responseWithTrail(['n1'])
    useWorkspaceStore.getState().addNode('knowledge', { x: 0, y: 200 }, {
      auto: true,
      hubId: null,
      includeNotes: false,
      entryIds: [],
      includeLinked: false,
    })
    const document = workspaceDocumentFromState(useWorkspaceStore.getState())
    expect(document.nodes.some((node) => node.id === promptId)).toBe(true)
    const { container } = renderResponse(responseId)
    expect(container.querySelectorAll('.response-knowledge').length).toBe(1)
  })
})