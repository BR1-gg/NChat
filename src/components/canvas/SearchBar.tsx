import { useMemo, useState } from 'react'
import { queryTerms, searchNodes, type SearchField, type SearchHit } from '../../logic/search'
import { useUiStore } from '../../store/uiStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { SearchPanel, type SearchPanelHit } from './SearchPanel'

/**
 * La ricerca del progetto: una barra che compare e una lista sotto.
 *
 * Il difetto che chiude e' che su un grafo grande non si poteva **cercare niente**.
 * C'era la palette per aggiungere nodi, il menu per le azioni, e per trovare «quella
 * cosa che avevo scritto» l'unica opzione era scorrere la tela leggendo ogni nodo. E
 * su un grafo di trecento nodi non e' slow scrolling: e' non sapere in che direzione
 * guardare.
 *
 * La **forma** e' in `SearchPanel`, perche' la stessa finestra serve anche all'archivio
 * della conoscenza e due copie della stessa interfaccia divergerebbero alla prima
 * modifica. Qui dentro c'e' solo il lavoro specifico del workspace: che cosa e' un nodo
 * del grafo e che cosa succede scegliendolo.
 *
 * Due scelte che sembrano dettaglio e non lo sono:
 *
 * - **AND, non OR.** Un risultato che contiene una parola su tre e' rumore, e in una
 *   ricerca il rumore e' peggio di non trovare niente: l'utente smette di fidarsi e non
 *   guarda nemmeno quello che c'era davvero. Meglio due righe certe che venti probabili.
 * - **l'ordine per intenzione.** Un prompt scritto per essere eseguito viene prima di
 *   una risposta che la contiene per caso, e dentro lo stesso campo chi la contiene di
 *   piu' viene prima. L'utente trova giusto quello fra i risultati, e l'ordine e' la
 *   meta' del lavoro.
 */
export function SearchBar() {
  /*
   * «Nessuna riga evidenziata», che e' uno stato reale e non un valore sbagliato.
   *
   * Ha un nome perche' il numero magari sparisca in un refuso: `-1` scritto in tre
   * posti diversi, di cui uno solo spiegato, viene letto come un off-by-one e
   * «corretto» in un segno che rompe l'evidenziatura di apertura.
   */
  const NO_HIGHLIGHT = -1

  const open = useUiStore((state) => state.searchOpen)
  const scope = useUiStore((state) => state.searchScope)
  const query = useUiStore((state) => state.searchQuery)
  const setQuery = useUiStore((state) => state.setSearchQuery)
  const close = useUiStore((state) => state.closeSearch)
  const nodes = useWorkspaceStore((state) => state.nodes)
  const edges = useWorkspaceStore((state) => state.edges)
  const settings = useWorkspaceStore((state) => state.settings)
  const docVersion = useWorkspaceStore((state) => state.docVersion)
  const name = useWorkspaceStore((state) => state.name)
  const viewport = useWorkspaceStore((state) => state.viewport)
  const [active, setActive] = useState(NO_HIGHLIGHT)

  /*
   * I risultati si ricalcolano a ogni lettera, sul documento ricostruito dagli stessi
   * campi a cui il componente sottoscrive gia'. Non si legge lo store con `getState()`
   * perche' quello non farebbe ridisegnare nulla: la ricerca resterebbe ferma sul testo
   * di quando la barra si e' aperta, e sarebbe la stessa classe di difetto di quella
   * che si evita in `CompactDialog`.
   */
  const hits = useMemo(() => {
    if (!open || scope !== 'workspace') return []
    return searchNodes({ docVersion, savedAt: 0, name, nodes, edges, settings, viewport }, query)
  }, [open, scope, query, docVersion, name, nodes, edges, settings, viewport])

  /*
   * Nessun risultato e' evidenziato all'apertura.
   *
   * `-1` vuol dire "nessuno": e' uno stato possibile, non un errore. La finestra si
   * apre con la scorciatoia e quindi con l'intenzione gia' chiara di **scrivere una
   * ricerca nuova** — e una riga gia' evidenziata dice il contrario, cioe' che c'e'
   * gia' qualcosa di scelto. L'utente non l'ha scelto, e per primo risponde a cose
   * che non ha chiesto: una riga arancione che non sapeva di aver acceso, e la
   * sensazione che la finestra stia gia' lavorando da sola.
   *
   * Non e' una riga che si puo' togliere «un attimo dopo»: la scelta deve partire
   * pulita, altrimenti l'utente deve accorgersi di un dettaglio per indovinare come
   * tornare indietro.
   */
  const [lastQuery, setLastQuery] = useState(query)
  if (query !== lastQuery) {
    setLastQuery(query)
    setActive(NO_HIGHLIGHT)
  }

  if (!open || scope !== 'workspace') return null

  const choose = (hit: SearchHit | undefined): void => {
    if (!hit) return
    const state = useWorkspaceStore.getState()
    // La selezione e' **solo** quel nodo: come nella paste, la selezione si sostituisce,
    // e non si aggiunge a quello che c'era. Altrimenti una ricerca su un grafo con tre
    // nodi gia' selezionati lascerebbe selezionati sei, e il prossimo trascinamento
    // muoverebbe anche i tre che non c'entrano.
    state.selectOnlyNode(hit.nodeId)
    const ui = useUiStore.getState()
    ui.setSelectedNode(hit.nodeId)
    // Il nodo va anche al centro: selezionarlo non basta, perche' su un grafo grande
    // il nodo giusto puo' essere fuori dalla vista, e allora la ricerca avrebbe
    // risposto «ecco il tuo risultato» mostrando il vuoto.
    window.dispatchEvent(new CustomEvent('nchat:focus-node', { detail: hit.nodeId }))
    /*
     * E la parola va **evidenziata** dentro il nodo. Solo centrare non basta: su una
     * risposta lunga — o su un file — il nodo riempie lo schermo di parole che non
     * sono quella cercata, e l'utente si ritrova a rileggere per ritrovare quello che
     * gli avevano appena detto. La ricerca avrebbe finito il lavoro e lo rifarebbe da
     * capo.
     *
     * Vanno passate **tutte** le parole della domanda, non solo la prima: se ne
     * cercano due, segnalarne una lascia il dubbio che l'altra non ci sia.
     */
    ui.setSearchTarget({ nodeId: hit.nodeId, terms: queryTerms(query) })
    close()
  }

  return (
    <SearchPanel
      query={query}
      onQueryChange={setQuery}
      hits={hits.map(toPanelHit)}
      active={active}
      onActiveChange={setActive}
      onChoose={choose}
      onClose={close}
      placeholder="Search words in this workspace…"
      fieldLabel="Search the project"
      dialogLabel="Search"
      emptyNote="Every word has to be in the same node."
      openLabel="opens the node"
    />
  )
}

/**
 * Un risultato del grafo nella forma che il pannello sa disegnare.
 *
 * La chiave tiene **nodo e campo** insieme perche' lo stesso nodo puo' essere trovato in
 * due campi diversi — un prompt e il suo nome — e con la sola id due righe avrebbero la
 * stessa chiave: React ne mostrerebbe una sola e l'utente ne perderebbe una senza che
 * nulla sembrasse rotto.
 */
function toPanelHit(hit: SearchHit): SearchPanelHit<SearchHit> {
  return {
    key: `${hit.nodeId}-${hit.field}`,
    kind: FIELD_LABEL[hit.field],
    kindClass: hit.field,
    title: hit.title,
    snippet: hit.snippet,
    at: hit.at,
    length: hit.length,
    occurrences: hit.occurrences,
    payload: hit,
  }
}

/** What each kind of matched text is called in the result line. */
const FIELD_LABEL: Record<SearchField, string> = {
  prompt: 'Prompt',
  note: 'Note',
  response: 'Answer',
  file: 'File',
  summary: 'Summary',
  system: 'Instructions',
  output: 'Group',
  name: 'Name',
}