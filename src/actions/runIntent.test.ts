/**
 * Cosa gira il bottone Run di un prompt.
 *
 * Il difetto che questo file chiude e' che il Run di un nodo girava **solo** quel
 * nodo, anche con cinque prompt selezionati. Il menu del tasto destro aveva gia' «Run
 * N prompts», quindi la funzionalita c'era — ma bisognava aprire il menu, e il
 * pulsante che l'utente vede addosso al nodo prometteva un'altra cosa.
 *
 * Due bottoni con lo stesso nome e comportamenti diversi sono peggio di un bottone
 * solo: l'utente preme «Run» e non sa quale delle due cose sta usando. Qui il bottone
 * fa quello che il nome dice — **i prompt selezionati, tutti** — e lo dichiara con il
 * numero scritto sopra.
 *
 * E la regola che conta di piu' e' negativa: premere Run su un nodo **non**
 * selezionato non deve girare gli altri. Girare nodi che l'utente non ha scelto non e'
 * un'azione, e' una sorpresa — e le sorprese che costano denaro sono le peggiori.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { useUiStore } from '../store/uiStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { runIntent, runIntentFor, selectedRunnablePrompts } from './runIntent'
import { workspaceDocumentFromState } from '../store/workspaceStore'

function addPrompt(text: string, x = 0): string {
  return useWorkspaceStore.getState().addNode('prompt', { x, y: 0 }, { text })
}

function addNote(text: string, x = 0): string {
  return useWorkspaceStore.getState().addNode('note', { x, y: 0 }, { text })
}

describe('what the Run button does', () => {
  beforeEach(() => {
    useUiStore.getState().closeDialog()
    useWorkspaceStore.getState().resetDocument()
  })

  it('runs only this prompt when it is the only one selected', () => {
    const only = addPrompt('Do the thing')
    useWorkspaceStore.getState().selectOnlyNode(only)
    const intent = runIntentFor(only, useWorkspaceStore)
    expect(intent.promptIds).toEqual([only])
    expect(intent.label).toBe('Run')
    expect(intent.enabled).toBe(true)
  })

  it('runs every selected prompt, and says how many', () => {
    /*
     * Il numero non e' un dettaglio. Senza, un utente con tre prompt selezionati preme
     * «Run» e non sa se sta per spendere una richiesta o tre — e la scoperta arriva
     * dalla bolletta, o peggio dal fatto che la coda si sia riempita.
     */
    const a = addPrompt('First', 0)
    const b = addPrompt('Second', 400)
    const c = addPrompt('Third', 800)
    useWorkspaceStore.getState().selectOnlyNodes([a, b, c])

    for (const id of [a, b, c]) {
      const intent = runIntentFor(id, useWorkspaceStore)
      expect(intent.promptIds.sort(), `pressed on ${id}`).toEqual([a, b, c].sort())
      expect(intent.label).toBe('Run 3')
      expect(intent.enabled).toBe(true)
    }
  })

  it('runs the same set whichever selected prompt you press', () => {
    // Il pulsante e' su ciascun nodo, quindi premere il primo e premere l'ultimo
    // devono fare la stessa cosa. Se differissero, l'utente imparerebbe a premere
    // solo uno dei tre, il che significherebbe che due dei tre pulsanti mentono.
    const a = addPrompt('First', 0)
    const b = addPrompt('Second', 400)
    useWorkspaceStore.getState().selectOnlyNodes([a, b])
    const fromA = runIntentFor(a, useWorkspaceStore)
    const fromB = runIntentFor(b, useWorkspaceStore)
    expect(fromA.promptIds.sort()).toEqual(fromB.promptIds.sort())
    expect(fromA.label).toBe(fromB.label)
  })

  it('runs only itself when other nodes are selected but it is not', () => {
    /*
     * La regola negativa, ed e' quella che evita la sorpresa. Con tre prompt
     * selezionati e il quarto premuto, girare i tre toccherebbe nodi che l'utente non
     * ha indicato — e in un grafo che costa denaro ogni richiesta, «ho premuto Run e
     * ne sono partite tre» e' un tipo di errore che si ricorda.
     */
    const a = addPrompt('First', 0)
    const b = addPrompt('Second', 400)
    const outsider = addPrompt('Third', 800)
    useWorkspaceStore.getState().selectOnlyNodes([a, b])

    const intent = runIntentFor(outsider, useWorkspaceStore)
    expect(intent.promptIds).toEqual([outsider])
    expect(intent.label).toBe('Run')
    // E il tooltip lo dice, perche' il numero «Run» e il contesto possono deludere:
    // l'utente deve potore capire perche' gli altri non girano.
    expect(intent.title).toMatch(/not part of the current selection/i)
  })

  it('ignores selected notes and answers, which cannot be run', () => {
    const p = addPrompt('Only this', 0)
    const n = addNote('a note', 400)
    useWorkspaceStore.getState().selectOnlyNodes([p, n])
    const intent = runIntentFor(p, useWorkspaceStore)
    // La nota e' selezionata ma non e' un prompt: deve contare come «una selezione»,
    // non come «due prompt da girare».
    expect(intent.promptIds).toEqual([p])
    expect(intent.label).toBe('Run')
  })

  it('counts only the prompts that have text', () => {
    /*
     * Un prompt vuoto non ha niente da mandare. Il numero deve dire quanti gireranno
     * **davvero**: se dicesse «Run 3» e ne girassero due, l'utente resterebbe in
     * attesa di una terza risposta che non arriverebbe mai, senza capire perche'.
     */
    const a = addPrompt('First', 0)
    const b = addPrompt('Second', 400)
    const empty = addPrompt('   ', 800)
    useWorkspaceStore.getState().selectOnlyNodes([a, b, empty])

    const intent = runIntentFor(a, useWorkspaceStore)
    expect(intent.promptIds.sort()).toEqual([a, b].sort())
    expect(intent.label).toBe('Run 2')
    expect(intent.skipped).toEqual([empty])
  })

  it('stays disabled on an empty prompt when it is alone', () => {
    const empty = addPrompt('   ')
    useWorkspaceStore.getState().selectOnlyNode(empty)
    const intent = runIntentFor(empty, useWorkspaceStore)
    expect(intent.enabled).toBe(false)
    expect(intent.promptIds).toEqual([])
  })

  it('stays enabled on an empty prompt when the selection has work to do', () => {
    /*
     * Il caso che rende la regola necessaria. Se il pulsante guardasse solo «questo
     * nodo e' vuoto», resterebbe spento anche quando nella selezione c'e' lavoro da
     * fare — e l'utente con due prompt pieni e uno vuoto non avrebbe nessun modo di
     * lanciarli, perche' l'unico pulsante visibile sarebbe quello del vuoto.
     */
    const a = addPrompt('First', 0)
    const b = addPrompt('Second', 400)
    const empty = addPrompt('', 800)
    useWorkspaceStore.getState().selectOnlyNodes([a, b, empty])
    const intent = runIntentFor(empty, useWorkspaceStore)
    expect(intent.enabled).toBe(true)
    expect(intent.promptIds.sort()).toEqual([a, b].sort())
  })

  it('reads the selection at the moment of the press, not from an old render', () => {
    /*
     * La selezione puo' cambiare fra un render e la pressione — un click sulla tela la
     * cambia, e un altro bottone la cambia. Se la decisione fosse presa al render, il
     * pulsante mostrerebbe il numero di una selezione passata, e prometterebbe un
     * numero di richieste che non e' quello che sta per spendere.
     */
    const a = addPrompt('First', 0)
    const b = addPrompt('Second', 400)
    useWorkspaceStore.getState().selectOnlyNodes([a, b])
    expect(runIntentFor(a, useWorkspaceStore).label).toBe('Run 2')

    // La selezione cambia: adesso c'e' un solo prompt.
    useWorkspaceStore.getState().selectOnlyNode(a)
    expect(runIntentFor(a, useWorkspaceStore).label).toBe('Run')
  })

  it('gives the same answer to a node that was already selected', () => {
    /*
     * Il difetto che questa funzione aveva, trovato provandola nel browser e non a
     * tavolino. Il pulsante diceva «Run 3» sui due nodi selezionati **adesso**, e
     * «Run» su quello che era gia' selezionato prima: quel componente si ridisegna
     * solo quando cambia la sua selezione, e la sua non era cambiata.
     *
     * Il risultato era una barra con due numeri diversi sulla stessa azione, e uno
     * dei due sbagliato. Su un bottone che avvia richieste a pagamento, un numero
     * vecchio non e' un dettaglio: l'utente preme e non sa cosa sta lanciando.
     *
     * Qui la funzione e' pura e riceve la selezione, quindi non ha memoria di niente e
     * non puo' sbagliare — ma il caso resta scritto perche' e' la forma in cui
     * sbagliava.
     */
    const already = addPrompt('First', 0)
    const fresh1 = addPrompt('Second', 400)
    const fresh2 = addPrompt('Third', 800)

    // Selezione cresciuta: il primo era gia' dentro, gli altri due sono entrati dopo.
    const document = workspaceDocumentFromState(useWorkspaceStore.getState())
    const grown = [already, fresh1, fresh2]
    for (const id of grown) {
      const intent = runIntent(id, document, grown)
      expect(intent.label, `node ${id}`).toBe('Run 3')
      expect(intent.promptIds.sort(), `node ${id}`).toEqual([...grown].sort())
    }
  })
})

describe('which prompts are runnable', () => {
  beforeEach(() => {
    useWorkspaceStore.getState().resetDocument()
  })

  it('skips prompts that are only whitespace', () => {
    const a = addPrompt('text', 0)
    const b = addPrompt('  \n\t ', 400)
    const document = workspaceDocumentFromState(useWorkspaceStore.getState())
    expect(selectedRunnablePrompts(document, [a, b])).toEqual([a])
  })

  it('skips ids that are not in the graph', () => {
    // Una selezione puo' contenere un id sparito fra un render e l'altro. Deve essere
    // ignorato, non far fallire tutto: un id fantasma che interrompe l'azione
    // significherebbe che l'utente non puo' piu' lanciare niente.
    const a = addPrompt('text', 0)
    const document = workspaceDocumentFromState(useWorkspaceStore.getState())
    expect(selectedRunnablePrompts(document, [a, 'ghost'])).toEqual([a])
  })
})
