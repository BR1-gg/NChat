/**
 * La finestra della ricerca: cosa mostra e cosa non mostra.
 *
 * Il testo che spiegava cosa si poteva cercare e' stato tolto, e il casovuoto e' una
 * richiesta esplicita: la casella vuota deve stare zitta e aspettare che si scriva.
 *
 * Quello che **resta** e' «non c'e' niente», e la ragione per cui resta merita un
 * test tutto suo: e' la differenza fra «la ricerca funziona e non ha trovato niente» e
 * «la ricerca e' rotta». Senza, si scrive una parola, la lista resta vuota, e le due
 * cose sono identiche sullo schermo — che e' il modo piu' economico di costringere
 * l'utente a riprovare tre volte prima di rendersi conto che la ricerca funziona e che
 * la parola non c'era.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useUiStore } from '../../store/uiStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { SearchBar } from './SearchBar'

function open(): void {
  act(() => {
    useUiStore.getState().openSearch()
  })
  render(<SearchBar />)
}

function type(text: string): void {
  const input = screen.getByLabelText('Search the project')
  fireEvent.change(input, { target: { value: text } })
}

describe('the search window', () => {
  beforeEach(() => {
    useUiStore.getState().closeSearch()
    useWorkspaceStore.getState().resetDocument()
    useWorkspaceStore.getState().addNode('prompt', { x: 0, y: 0 }, { text: 'a question about deadlines' })
  })

  it('says nothing while the box is empty', () => {
    /*
     * Il testo che c'era prima spiegava cosa si poteva cercare. Ma il segnaposto nella
     * casella lo dice gia', meglio e in meno posto, e la prosa sopra un'interfaccia e'
     * rumore. Poi l'utente scrive e la lista prende il suo posto.
     */
    open()
    expect(screen.queryByText(/Type to look through/i)).not.toBeInTheDocument()
    // E non c'e' nemmeno un risultato: la lista parte vuota, non con "nessuno".
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.queryByText(/Nothing matches/i)).not.toBeInTheDocument()
  })

  it('still shows the search field, so there is something to type into', () => {
    // Togliere il testo non vuol dire togliere la finestra: senza la casella, la ricerca
    // non si puo' proprio usare.
    open()
    expect(screen.getByLabelText('Search the project')).toBeInTheDocument()
  })

  it('says plainly when nothing matches, because silence is not an answer', () => {
    /*
     * Il caso che il testo del «non c'e' niente» protegge. Una ricerca che non trova
     * nulla e dice solo «niente», e una ricerca rotta che non trova nulla, sullo
     * schermo sono la stessa cosa. Il messaggio e' l'unica differenza che l'utente ha
     * per capire se deve cambiare parola o se il programma e' fermo.
     */
    open()
    type('qwertyuiop')
    expect(screen.getByText(/Nothing matches/i)).toBeInTheDocument()
  })

  it('explains the all-words rule only when there was more than one word', () => {
    // Con due parole la ricerca pretende **tutte e due** nello stesso nodo, che e' una
    // scelta che l'utente non farebbe da solo. Dirlo solo li' evita la frase inutile
    // quando la ricerca aveva una parola sola e non c'entrava niente.
    open()
    type('deadlines nothinglikethis')
    expect(screen.getByText(/Every word has to be in the same node/i)).toBeInTheDocument()

    type('qwertyuiop')
    expect(screen.queryByText(/Every word has to be in the same node/i)).not.toBeInTheDocument()
  })

  it('lists the results, with the word lit up', () => {
    open()
    type('deadlines')
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByText('deadlines', { selector: 'mark' })).toBeInTheDocument()
  })

  it('stays shut until it is asked for', () => {
    render(<SearchBar />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

/**
 * Nessun risultato parte gia' evidenziato.
 *
 * La finestra si apre con la scorciatoia, quindi con l'intenzione gia' chiara di
 * scrivere una ricerca nuova. Una riga accesa all'apertura dice il contrario — che
 * c'e' gia' qualcosa di scelto — e l'utente non l'ha scelto: non se n'e' accorto e non
 * ha un modo per tornare indietro senza premere una freccia che non sapeva di dover
 * premere.
 *
 * La conseguenza per `Invio` e' separata e va verificata a parte: togliere
 * l'evidenziatura non puo' far smettere di funzionare `Invio`, altrimenti il tasto
 * sembrerebbe guasto proprio nel caso piu' comune, cioe' una ricerca che torna un
 * risultato solo.
 */
describe('nothing is pre-selected in the results', () => {
  beforeEach(() => {
    useUiStore.getState().closeSearch()
    useWorkspaceStore.getState().resetDocument()
    useWorkspaceStore.getState().addNode('prompt', { x: 0, y: 0 }, { text: 'a question about deadlines' })
  })

  it('leaves every row plain when the results appear', () => {
    open()
    type('deadlines')
    const rows = screen.getAllByRole('option')
    expect(rows.length).toBeGreaterThan(0)
    expect(document.querySelectorAll('.search-hit.is-active')).toHaveLength(0)
    // Anche per l'accessibilita': una riga che dice di essere scelta e' una scelta
    // che l'utente non ha fatto, e uno screen reader la annuncerebbe come tale.
    expect(rows.filter((row) => row.getAttribute('aria-selected') === 'true')).toHaveLength(0)
  })

  it('still opens the result on Enter, with no row highlighted', () => {
    open()
    type('deadlines')
    expect(document.querySelectorAll('.search-hit.is-active')).toHaveLength(0)

    fireEvent.keyDown(screen.getByLabelText('Search the project'), { key: 'Enter' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(useUiStore.getState().searchTarget?.nodeId).not.toBeNull()
  })

  it('highlights the first row once the arrow key is used', () => {
    open()
    type('deadlines')
    // La freccia entra sul primo risultato senza saltarlo: `-1` e' "nessuno", non
    // "il secondo".
    fireEvent.keyDown(screen.getByLabelText('Search the project'), { key: 'ArrowDown' })
    expect(document.querySelectorAll('.search-hit.is-active')).toHaveLength(1)
    const [firstRow] = screen.getAllByRole('option')
    expect(firstRow?.getAttribute('aria-selected')).toBe('true')
  })

  it('drops the highlight again when the query changes', () => {
    open()
    type('deadlines')
    fireEvent.keyDown(screen.getByLabelText('Search the project'), { key: 'ArrowDown' })
    expect(document.querySelectorAll('.search-hit.is-active')).toHaveLength(1)

    // Scrivere un'altra parola ricomincia: l'evidenziatura della ricerca precedente
    // sarebbe un resto, e resterebbe sulla riga sbagliata.
    type('about')
    expect(document.querySelectorAll('.search-hit.is-active')).toHaveLength(0)
  })
})
