import { useMemo, useState } from 'react'
import { searchKnowledge, type KnowledgeSearchHit } from '../../logic/knowledge'
import { useKnowledgeStore } from '../../store/knowledgeStore'
import { useUiStore } from '../../store/uiStore'
import { SearchPanel, type SearchPanelHit } from '../canvas/SearchPanel'
import type { KnowledgeId } from '../../types/knowledge'

/**
 * La ricerca **sull'archivio**, con la stessa finestra del workspace.
 *
 * Non e' una barra nuova con un altro aspetto: e' lo stesso pannello, lo stesso campo, le
 * stesse frecce, lo stesso `Invio`. E' una cosa che sembra ovvia e che pero' e' la cosa
 * giusta: due ricerche con due forme diverse costringerebbero a imparare due volte la
 * stessa finestra, e l'utente che le usa in fila finirebbe col premere frecce dove non
 * c'e' niente da muovere.
 *
 * Quello che cambia e' **dove guarda**. Una finestra sola che cerca in due archivi
 * diversi sarebbe una terza cosa che non e' nessuno dei due: elencare nodi del grafo e
 * note dell'archivio nella stessa lista mostrerebbe risultati di due cose diverse senza
 * dire quale e' quale, e il peggio sarebbe che la ricerca costerebbe piu' di quanto vale:
 * si cerca una parola e si trova la parola giusta in un posto che non si stava guardando.
 *
 * Scegliendo un risultato la nota viene **centrata nella mappa** e non aperta in una
 * pagina: in un archivio la lettura la fa la mappa con il pannello, e aprire un'altra
 * scheda per una nota staccherebbe il testo dalla sua posizione — che e' l'unica cosa che
 * distingue questa nota da tutte le altre.
 */
export function KnowledgeSearchBar({
  onOpen,
}: {
  /** Called with the note that was chosen, so the map can centre it. */
  onOpen: (id: KnowledgeId) => void
}) {
  const open = useUiStore((state) => state.searchOpen)
  const scope = useUiStore((state) => state.searchScope)
  const query = useUiStore((state) => state.searchQuery)
  const setQuery = useUiStore((state) => state.setSearchQuery)
  const close = useUiStore((state) => state.closeSearch)
  const entries = useKnowledgeStore((state) => state.entries)
  const hubs = useKnowledgeStore((state) => state.hubs)
  const [active, setActive] = useState(-1)

  const hits = useMemo(() => {
    if (!open || scope !== 'knowledge') return []
    return searchKnowledge(entries, hubs, query)
  }, [open, scope, query, entries, hubs])

  /*
   * Nessun risultato parte gia' evidenziato, e per la stessa ragione che vale nel
   * workspace: la finestra si apre con l'intenzione gia' chiara di scrivere una ricerca
   * nuova, e una riga accesa all'apertura direbbe che c'e' gia' qualcosa di scelto che
   * l'utente non ha scelto.
   */
  const [lastQuery, setLastQuery] = useState(query)
  if (query !== lastQuery) {
    setLastQuery(query)
    setActive(-1)
  }

  if (!open || scope !== 'knowledge') return null

  return (
    <SearchPanel
      query={query}
      onQueryChange={setQuery}
      hits={hits.map(toPanelHit)}
      active={active}
      onActiveChange={setActive}
      onChoose={(hit) => {
        onOpen(hit)
        close()
      }}
      onClose={close}
      placeholder="Search words in your knowledge…"
      fieldLabel="Search your knowledge"
      dialogLabel="Search"
      emptyNote="Every word has to be in the same note."
      openLabel="centres the note in the map"
    />
  )
}

/**
 * Un risultato dell'archivio nella forma che il pannello sa disegnare.
 *
 * La riga dice **a quale centro** appartiene la nota, perche' in un archivio organizzato
 * la domanda «di cosa parla» si risponde spesso prima sul nome del gruppo che sul testo.
 * Il nome del centro sta nella riga e non nel titolo: sostituirlo al titolo nasconderebbe
 * il titolo della nota, che e' la parola con cui l'utente la conosce.
 */
function toPanelHit(hit: KnowledgeSearchHit): SearchPanelHit<KnowledgeId> {
  return {
    // La chiave e' l'id della nota e nient'altro: due righe per la stessa nota non
    // possono esistere, e con una chiave duplicata React ne mostrerebbe una sola senza
    // che nulla sembrasse rotto.
    key: hit.entryId,
    kind: hit.hubTitle ?? 'Note',
    kindClass: hit.hubTitle ? 'name' : 'response',
    title: hit.title,
    snippet: hit.snippet,
    at: hit.at,
    length: hit.length,
    occurrences: hit.occurrences,
    payload: hit.entryId,
  }
}