/**
 * Scegliere un risultato deve **mostrare la parola**, non solo centrare il nodo.
 *
 * Il difetto che questo file chiude e' che la ricerca centrava il nodo e basta. Su un
 * prompt o su una nota va bene, perche' il testo e' tutto li' e si vede. Ma su una
 * risposta lunga, o su un file, il nodo riempie lo schermo con parole che non sono
 * quella cercata, e l'utente si ritrova a rileggere per ritrovare quello che la
 * ricerca aveva appena scritto. Il lavoro veniva fatto e poi rifatto.
 *
 * Due cose sono sul tasto e vengono verificate qui:
 *
 * - **la parola viene selezionata davvero**, non colorata in un modo che sembri
 *   selezionato. Due terzi dei nodi scrivono in una `textarea`, e dentro una
 *   `textarea` non si puo' mettere un `<mark>`: il testo e' un valore, non markup. La
 *   selezione e' l'unico meccanismo che funziona in tutti i nodi, e lo fa il browser.
 * - **il click fuori la toglie**, altrimenti l'evidenziatura resterebbe li' a spiegare
 *   qualcosa che e' gia' finito, e l'utente non saprebbe piu' se quella parola fosse
 *   ancora il risultato della ricerca o solo un testo selezionato per caso.
 */

import { ReactFlowProvider } from '@xyflow/react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUiStore } from '../../store/uiStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { PromptNode } from '../nodes/PromptNode'
import { SearchBar } from './SearchBar'
import { SearchHighlight } from './SearchHighlight'

/** Il prompt con le props allargate: vedi `PromptNode.test.tsx` per il perche'. */
const Prompt = PromptNode as unknown as (props: Record<string, unknown>) => ReactElement

/**
 * Il tempo che l'evidenziatura aspetta prima di agire.
 *
 * Deve corrispondere alla durata della centratura (`setCenter` usa 300ms). Prima
 * l'evidenziatura agirebbe su una posizione che il nodo sta ancora perdendo, e la
 * parola finirebbe fuori vista proprio mentre l'utente la sta cercando.
 */
const SETTLE_MS = 320

function openSearchAndType(query: string): void {
  act(() => {
    useUiStore.getState().openSearch()
  })
  render(<SearchBar />)
  fireEvent.change(screen.getByLabelText('Search the project'), { target: { value: query } })
}

function pickResult(kind: RegExp): void {
  const hit = screen
    .getAllByRole('option')
    .find((option) => kind.test(option.querySelector('.search-kind')?.textContent ?? ''))
  if (!hit) throw new Error(`no result matching ${kind}`)
  act(() => {
    fireEvent.click(hit)
  })
}

/** Rende un prompt vero, perche' l'evidenziatura cerca un nodo nel documento. */
function renderPrompt(id: string, selected = true): void {
  // I `Handle` del nodo chiedono un `ReactFlowProvider` sopra di se': senza, React Flow
  // si rifiuta di renderizzarli. Aggiungerlo e' una riga e rende il test fedele a
  // quello che vede davvero il browser.
  render(
    <ReactFlowProvider>
      <Prompt
        id={id}
        selected={selected}
        type="prompt"
        zIndex={0}
        isConnectable
        dragging={false}
      />
    </ReactFlowProvider>,
  )
}

describe('picking a result remembers what to highlight', () => {
  beforeEach(() => {
    useUiStore.getState().closeSearch()
    useUiStore.getState().setSearchTarget(null)
    useWorkspaceStore.getState().resetDocument()
    useWorkspaceStore.getState().addNode('prompt', { x: 0, y: 0 }, {
      text: 'Prima riga.\n\nAdesso la parola cercata, deadlines, sta qui nel mezzo.',
    })
    useWorkspaceStore.getState().addNode('note', { x: 0, y: 400 }, { text: 'Una nota su budgets.' })
  })

  it('keeps the word after the window closes, which is when it is needed', () => {
    openSearchAndType('deadlines')
    pickResult(/Prompt/)
    // La finestra e' gia' chiusa: il bersaglio deve sopravvivire, perche' e' proprio
    // il momento in cui l'utente guarda il nodo.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(useUiStore.getState().searchTarget?.terms).toEqual(['deadlines'])
  })

  it('keeps every word of the query, not just the first', () => {
    /*
     * Con due parole cercate ne vanno evidenziate due. Segnalarne una lascerebbe il
     * dubbio che l'altra non ci sia — e l'utente non saprebbe se la ricerca ha
     * funzionato a meta' o se il nodo e' quello giusto.
     */
    useWorkspaceStore.getState().addNode('note', { x: 0, y: 800 }, {
      text: 'Una nota con budgets e deadlines insieme.',
    })
    openSearchAndType('budgets deadlines')
    pickResult(/Note/)
    expect(useUiStore.getState().searchTarget?.terms).toEqual(['budgets', 'deadlines'])
  })
})

describe('the highlight itself', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    useUiStore.getState().closeSearch()
    useUiStore.getState().setSearchTarget(null)
    useWorkspaceStore.getState().resetDocument()
  })

  it('selects the word inside the node, not just centres it', () => {
    const id = useWorkspaceStore.getState().addNode('prompt', { x: 0, y: 0 }, {
      text: 'Prima riga.\n\nAdesso la parola cercata, deadlines, sta qui nel mezzo.',
    })
    renderPrompt(id)
    render(<SearchHighlight />)
    act(() => {
      useUiStore.getState().setSearchTarget({ nodeId: id, terms: ['deadlines'] })
    })
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS + 20)
    })

    const textarea = screen.getByLabelText('Prompt text') as HTMLTextAreaElement
    expect(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)).toBe('deadlines')
  })

  it('marks the node, so the highlight cannot be mistaken for an ordinary selection', () => {
    // Il marcatore e' quello che rende la selezione forte e con un bordo. Senza,
    // durante una ricerca una selezione qualsiasi e il risultato sarebbero identici
    // e l'utente non saprebbe quale delle due sta guardando.
    const id = useWorkspaceStore.getState().addNode('prompt', { x: 0, y: 0 }, { text: 'deadlines' })
    renderPrompt(id)
    render(<SearchHighlight />)
    act(() => {
      useUiStore.getState().setSearchTarget({ nodeId: id, terms: ['deadlines'] })
    })
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS + 20)
    })
    expect(document.querySelectorAll('[data-search-hit]')).toHaveLength(1)
  })

  it('clears the highlight when the user clicks away', () => {
    const id = useWorkspaceStore.getState().addNode('prompt', { x: 0, y: 0 }, { text: 'deadlines' })
    renderPrompt(id)
    render(<SearchHighlight />)
    act(() => {
      useUiStore.getState().setSearchTarget({ nodeId: id, terms: ['deadlines'] })
    })
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS + 20)
    })
    expect(document.querySelectorAll('[data-search-hit]')).toHaveLength(1)

    // Il click fuori dal nodo e' quello che l'utente fa per andare avanti.
    act(() => {
      document.body.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, isPrimary: true }),
      )
    })

    expect(document.querySelectorAll('[data-search-hit]')).toHaveLength(0)
    expect(useUiStore.getState().searchTarget).toBeNull()
  })

  it('leaves the highlight alone when the click is inside the node', () => {
    /*
     * Un click dentro il nodo non deve togliere l'evidenziatura: l'utente sta
     * leggendo la parola, e un click per sbaglio dentro il testo non e' un motivo
     * per fargliela perdere.
     */
    const id = useWorkspaceStore.getState().addNode('prompt', { x: 0, y: 0 }, { text: 'deadlines' })
    renderPrompt(id)
    render(<SearchHighlight />)
    act(() => {
      useUiStore.getState().setSearchTarget({ nodeId: id, terms: ['deadlines'] })
    })
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS + 20)
    })

    act(() => {
      document
        .querySelector('[data-node-id]')
        ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 2, isPrimary: true }))
    })
    expect(document.querySelectorAll('[data-search-hit]')).toHaveLength(1)
  })

  it('still finds the word in a node that also has a hidden file input', () => {
    /*
     * Il caso che e' costato un bug: un nodo file ha un `<input type="file">` **nascosto**
     * per scegliere il file, e il suo valore e' un percorso, non il testo del file. Se
     * l'evidenziatura si accontentasse di guardare i campi, su questo nodo troverebbe
     * quello, non ci troverebbe la parola, e si fermerebbe: il testo del file — cioe'
     * esattamente cio' che l'utente aveva cercato — non sarebbe mai guardato, e il
     * nodo si aprirebbe con la parola non evidenziata e senza dire niente.
     *
     * Il campo e' il posto giusto **quando contiene** la parola (una `textarea` di un
     * prompt o di una nota), ma non puo' essere l'unico posto da controllare.
     */
    const id = useWorkspaceStore.getState().addNode('file', { x: 0, y: 0 }, {
      name: 'contratto.txt',
      text: `riga di riempimento senza significato `.repeat(20) + 'clausola di riservato proprieta qui.',
    })
    // Il nodo file non si registra fra i tipi noti, quindi si rende a mano la struttura
    // che conta: un input nascosto **e** il testo del file, nell'ordine in cui ci sono
    // davvero (l'input viene dopo il corpo, ma l'ordine non e' il punto).
    const shell = document.createElement('section')
    shell.dataset.nodeId = id
    const pre = document.createElement('pre')
    pre.className = 'file-preview'
    pre.textContent = `riga di riempimento senza significato `.repeat(20) + 'clausola di riservato proprieta qui.'
    shell.appendChild(pre)
    const hidden = document.createElement('input')
    hidden.type = 'file'
    shell.appendChild(hidden)
    document.body.appendChild(shell)

    render(<SearchHighlight />)
    act(() => {
      useUiStore.getState().setSearchTarget({ nodeId: id, terms: ['clausola'] })
    })
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS + 20)
    })

    expect(document.querySelectorAll('[data-search-hit]')).toHaveLength(1)
    const selected = String(window.getSelection())
    expect(selected).toContain('clausola')
  })

  it('does not mark a node when the word is only part of its name', () => {
    /*
     * La ricerca accetta volentieri il **nome** di un'immagine o di un file, e li' non
     * c'e' niente da evidenziare dentro. La marcatura senza parola evidenziata sarebbe
     * solo rumore, quindi viene tolta — e non si avvisa, perche' e' il caso normale e non
     * un'anomalia.
     */
    const id = useWorkspaceStore.getState().addNode('image', { x: 0, y: 0 }, {
      name: 'invoice-2026.png',
      mediaType: 'image/png',
      src: 'data:image/png;base64,iVBORw0KGgo=',
      width: 1,
      height: 1,
      sizeBytes: 40,
    })
    // Si rende un segnaposto con lo stesso id: l'evidenziatura lavora sul documento, e
    // qui conta che il nodo esista e che dentro non ci sia la parola.
    const holder = document.createElement('section')
    holder.dataset.nodeId = id
    document.body.appendChild(holder)

    render(<SearchHighlight />)
    act(() => {
      useUiStore.getState().setSearchTarget({ nodeId: id, terms: ['invoice'] })
    })
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS + 20)
    })
    expect(document.querySelectorAll('[data-search-hit]')).toHaveLength(0)
  })
})
