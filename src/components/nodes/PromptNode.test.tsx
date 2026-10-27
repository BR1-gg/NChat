/**
 * Il nodo Prompt deve poter essere renderizzato senza far morire l'applicazione.
 *
 * Questo test esiste perche' un selettore di Zustand che restituisce un array nuovo a
 * ogni lettave faceva **esplodere l'applicazione all'avvio**: `Maximum update depth
 * exceeded`, la tela non si montava, e la pagina restava vuota. Nessun errore di rete,
 * nessun messaggio — solo un programma partito e rotto.
 *
 * Perche' nessun altro test lo aveva preso, e perche' qui il rendering e' l'unica
 * prova che conta: il difetto non e' nel valore restituito (era giusto) ma nel fatto
 * che era un valore **diverso** a ogni lettura, e l'unico modo di accorgersene e'
 * far girare React davvero e lasciarlo rendersi piu' volte da solo.
 */

import { ReactFlowProvider } from '@xyflow/react'
import { render, screen, cleanup } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useUiStore } from '../../store/uiStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { PromptNode } from './PromptNode'

/**
 * Il componente con le props allargate.
 *
 * `NodeProps` contiene l'intero `Node` di React Flow — decine di campi, metà dei quali
 * calcolati a runtime. Elencarli qui renderebbe il test fragile a ogni versione della
 * libreria, e non aggiungerebbe niente: il difetto che si sta guardingando sta nel
 * corpo del componente, dove vive il selettore, e non nelle props.
 */
const Prompt = PromptNode as unknown as (props: Record<string, unknown>) => ReactElement

function addPrompt(text: string, x = 0): string {
  return useWorkspaceStore.getState().addNode('prompt', { x, y: 0 }, { text })
}

describe('the prompt node renders, and stays rendered', () => {
  beforeEach(() => {
    useUiStore.getState().closeDialog()
    useWorkspaceStore.getState().resetDocument()
  })

  afterEach(() => {
    cleanup()
  })

  /**
   * Il nodo da solo, con le props minime che React Flow passerebbe.
   *
   * Il selettore problematico stava nel corpo del componente, quindi il difetto si
   * manifesta senza Canvas, senza provider e senza una riga di CSS: basta il
   * componente. Ed e' per questo che il test e' economico e puo' stare qui.
   *
   * Le props sono forzate con `as never` perche' `NodeProps` porta dentro un intero
   * `Node` con decine di campi che React Flow aggiunge a runtime e che qui non
   * servono. Elencarli renderebbe il test fragile a ogni versione della libreria,
   * mentre il difetto che si sta guardingando e' nel corpo del componente e non nelle
   * props.
   */
  const promptProps = (id: string, selected: boolean) => ({
    id,
    selected,
    type: 'prompt',
    zIndex: 0,
    isConnectable: true,
    dragging: false,
  })

  /*
   * I Handle del nodo chiedono un ReactFlowProvider sopra di se': senza, React Flow
   * si rifiuta di renderizzarli. Aggiungerlo e' una riga e rende il test fedele a
   * quello che vede davvero il browser, invece di una versione amputata del nodo.
   */
  const renderPrompt = (id: string, selected = false) =>
    render(
      <ReactFlowProvider>
        <Prompt {...promptProps(id, selected)} />
      </ReactFlowProvider>,
    )

  it('renders a prompt with text, without looping', () => {
    const id = addPrompt('What goes in a prompt?')
    // Se il selettore fosse instabile, React darebbe errore qui e il test fallirebbe
    // con «Maximum update depth exceeded» invece di passare.
    renderPrompt(id)
    expect(screen.getByLabelText('Prompt text')).toBeInTheDocument()
  })

  it('renders an empty prompt too', () => {
    const id = addPrompt('')
    renderPrompt(id)
    expect(screen.getByLabelText('Prompt text')).toBeInTheDocument()
  })

  it('says how many prompts are selected, from the store', () => {
    /*
     * La funzionalita' per cui la sottoscrizione esiste: con tre prompt selezionati il
     * bottone deve dire «Run 3» su **tutti** e tre. Se il nono si ridisegnasse, quello
     * gia' selezionato mostrerebbe un numero vecchio — e un numero vecchio su un
     * bottone che avvia richieste a pagamento e' peggio di nessun numero.
     */
    const a = addPrompt('First', 0)
    const b = addPrompt('Second', 400)
    const c = addPrompt('Third', 800)
    useWorkspaceStore.getState().selectOnlyNode(a)

    // Si disegna il nodo che era gia' selezionato, poi si allarga la selezione.
    const view = renderPrompt(a)
    expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument()

    useWorkspaceStore.getState().selectOnlyNodes([a, b, c])
    view.rerender(
      <ReactFlowProvider>
        <Prompt {...promptProps(a, true)} />
      </ReactFlowProvider>,
    )
    expect(screen.getByRole('button', { name: /Run 3/ })).toBeInTheDocument()
  })
})
