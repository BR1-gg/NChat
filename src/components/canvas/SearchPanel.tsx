import { ArrowRight, Search, X } from 'lucide-react'
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'

/**
 * La finestra della ricerca, **senza sapere cosa sta cercando**.
 *
 * E' una parte separata dal resto perche' la ricerca e' l'unica cosa che si apre
 * **mentre** si guarda, e quindi viene usata in due posti con due archivi diversi: quello
 * del workspace e quello della conoscenza. Il modo in cui si presenta — la casella, la
 * lista sotto, le frecce, `Invio` che apre, `Esc` che chiude — e' identico nei due casi,
 * e se fosse scritto due volte finirebbe per divergere alla prima modifica: una delle due
 * copie avrebbe la parola cercata evidenziata e l'altra no, e l'utente che le usa in
 * fila penserebbe che una delle due sia rotta.
 *
 * Qui dentro c'e' solo la **forma**. Che cosa viene cercato, come si ordina e che cosa
 * succede scegliendo un risultato stanno fuori, e sono diverse domande nei due posti:
 * nel workspace un risultato e' un nodo da aprire, nella conoscenza e' una nota da
 * centrare in una mappa.
 *
 * Con la casella vuota non c'e' niente da dire: si scrive e i risultati compaiono. «Non
 * c'e' niente» invece **resta**, e non e' un'eccezione per coerenza: e' la differenza fra
 * «la ricerca funziona e non ha trovato niente» e «la ricerca e' rotta». Senza, si scrive
 * una parola, la lista resta vuota, e le due cose sono identiche.
 */

/** One result, in the shape the panel renders. `T` is what the caller gets back. */
export interface SearchPanelHit<T> {
  key: string
  /** The little label saying where the word was found. */
  kind: string
  /**
   * The class that colours that label.
   *
   * Il pannello non sa cosa sia un prompt e cosa sia una risposta, e non deve indovinarlo:
   * il colore e' quello che distingue i due campi e sta dentro il grafo, quindi arriva da
   * fuori con la riga. Senza, tutte le etichette prenderebbero il colore di una sola
   * categoria e la distinzione per cui quella colonna esiste sparirebbe.
   */
  kindClass: string
  /** The name of the thing that matched. */
  title: string
  /** A window of text around the match, with the word still inside it. */
  snippet: string
  /** Where the match starts inside `snippet`. */
  at: number
  /** How long the matched word is, so highlighting knows where to stop. */
  length: number
  /** How many times the word appears, shown only when it is more than one. */
  occurrences: number
  /** What the caller wants back when this row is chosen. */
  payload: T
}

export function SearchPanel<T>({
  query,
  onQueryChange,
  hits,
  active,
  onActiveChange,
  onChoose,
  onClose,
  placeholder,
  fieldLabel,
  dialogLabel,
  emptyNote,
  openLabel,
}: {
  query: string
  onQueryChange: (query: string) => void
  hits: readonly SearchPanelHit<T>[]
  active: number
  onActiveChange: (index: number) => void
  onChoose: (payload: T) => void
  onClose: () => void
  placeholder: string
  /** Names the box you type in. This is what a test or a shortcut looks for. */
  fieldLabel: string
  /**
   * Names the window, and is **deliberately not** the same as the field's name.
   *
   * Con lo stesso nome, chi cerca «Search the project» — uno screen reader, un test, una
   * scorciatoia — trova due elementi e non sa quale sia. Il dialogo e' la finestra, la
   * casella e' il campo: si nominano con la parola che le distingue. E il nome della
   * finestra e' uguale nei due archivi perche' e' la **stessa** finestra: cambia dove
   * guarda, non che cos'e'.
   */
  dialogLabel: string
  /** Shown after «nothing matches», only when there was more than one word. */
  emptyNote: string
  openLabel: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  /*
   * L'indice viene limitato a ogni render, perche' i risultati possono diminuire senza
   * che cambi la domanda: basta che un nodo venga cancellato mentre la finestra e'
   * aperta, e `active` resterebbe oltre la fine della lista. `Invio` non aprirebbe nulla
   * e sembrerebbe che la ricerca sia rotta.
   *
   * `-1` passa attraverso il limite cosi' come sta: e' l'assenza di una scelta, e va
   * conservata invece di venire schiacciata a `0` — altrimenti il primo risultato si
   * riaccenderebbe da solo nel momento in cui la lista si accorcia.
   */
  const cursor = active < 0 || active > hits.length - 1 ? -1 : active

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      // Da `-1` la freccia entra sul primo risultato, senza saltarne uno: e' il posto da
      // cui comincia a muoversi, non un risultato da perdere.
      onActiveChange(Math.min(hits.length - 1, cursor + 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      onActiveChange(Math.max(-1, cursor - 1))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      /*
       * Invio senza niente evidenziato apre il **migliore** risultato.
       *
       * Sembra il contrario di quello che è stato chiesto sopra, ma non lo è: lì si è
       * tolto qualcosa che si **vede**, non una scorciatoia. Se Invio senza evidenziatura non
       * facesse niente, il tasto sembrerebbe rotto — e su una ricerca con un solo
       * risultato, che è il caso più comune, l'utente dovrebbe premere una freccia per
       * poter aprire quello che ha appena scritto.
       */
      const picked = hits[cursor] ?? hits[0]
      if (picked) onChoose(picked.payload)
    }
  }

  return (
    <div
      className="search-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose()
      }}
    >
      {/*
        Il nome della finestra e quello della casella sono **diversi**, e non per
        disattenzione: con lo stesso nome, chi cerca «Search the project» — uno screen
        reader, un test, una scorciatoia — trova due elementi e non sa quale sia. Il
        dialogo e' la finestra, la casella e' il campo: si nominano con la parola che le
        distingue.
      */}
      <div className="search-panel" role="dialog" aria-modal="true" aria-label={dialogLabel}>
        <div className="search-field">
          <Search size={14} aria-hidden />
          <input
            ref={inputRef}
            className="search-input"
            value={query}
            placeholder={placeholder}
            aria-label={fieldLabel}
            onChange={(event) => onQueryChange(event.currentTarget.value)}
            onKeyDown={onKeyDown}
          />
          <button
            type="button"
            className="search-close"
            onClick={onClose}
            aria-label="Close search"
            title="Close (Esc)"
          >
            <X size={13} />
          </button>
        </div>

        {query.trim() === '' ? null : hits.length === 0 ? (
          <p className="search-hint">
            Nothing matches <strong>{query}</strong>.
            {query.includes(' ') ? ` ${emptyNote}` : ''}
          </p>
        ) : (
          <ul className="search-results" role="listbox" aria-label="Search results">
            {hits.map((hit, index) => (
              <li key={hit.key}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === cursor}
                  className={`search-hit ${index === cursor ? 'is-active' : ''}`}
                  onMouseEnter={() => onActiveChange(index)}
                  onClick={() => onChoose(hit.payload)}
                >
                  <span className="search-hit-head">
                    <span className={`search-kind is-${hit.kindClass}`}>{hit.kind}</span>
                    <span className="search-hit-title">{hit.title}</span>
                    {hit.occurrences > 1 ? (
                      <span className="search-hit-count">{hit.occurrences}×</span>
                    ) : null}
                  </span>
                  <span className="search-hit-snippet">
                    <Highlighted hit={hit} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {hits.length > 0 ? (
          <footer className="search-foot">
            <span>
              {hits.length} {hits.length === 1 ? 'result' : 'results'}
            </span>
            <span className="search-foot-hint">
              <kbd>
                <ArrowRight size={9} />
              </kbd>{' '}
              {openLabel}
            </span>
          </footer>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Lo spezzone con la parola cercata accesa.
 *
 * Gli scarti arrivano gia' calcolati **nello spezzone** e riportati sull'indice dopo che
 * gli spazi sono collassati e i puntini di sospensione aggiunti, quindi qui non si cerca
 * niente. Un evidenziatore che ricalcolasse la posizione rischierebbe di illuminare la
 * parola nel posto sbagliato — un difetto che si vede subito e che fa dubitare di tutta
 * la ricerca.
 *
 * Il termine e' quello del **primo** termine della domanda, perche' e' quello che l'utente
 * ha scritto per primo e quello che sta cercando di ricordare. Con due parole diverse
 * sulla stessa riga viene illuminata solo la prima: la riga serve a orientarsi, non e' un
 * evidenziatore di sintassi.
 */
function Highlighted<T>({ hit }: { hit: SearchPanelHit<T> }): ReactNode {
  if (hit.length <= 0 || hit.at < 0 || hit.at + hit.length > hit.snippet.length) {
    return <>{hit.snippet}</>
  }
  return (
    <>
      {hit.snippet.slice(0, hit.at)}
      <mark className="search-mark">{hit.snippet.slice(hit.at, hit.at + hit.length)}</mark>
      {hit.snippet.slice(hit.at + hit.length)}
    </>
  )
}