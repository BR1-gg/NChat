import { ChevronRight, Library } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { knowledgeOfferedToPrompt } from '../../logic/knowledgeNode'
import { ensureKnowledgeLoaded, useKnowledgeStore } from '../../store/knowledgeStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import type { KnowledgeTrail } from '../../types/knowledge'

/**
 * La traccia: **quali note dell'archivio sono arrivate al modello** in questa risposta.
 *
 * E' qui perche' la domanda «l'AI sta usando i miei appunti?» non si puo' fare in nessun
 * altro punto dell'applicazione. Il nodo Knowledge risponde a «quante ne manderei» — e lo
 * dice prima di partire; il conteggio dei token risponde a «quanto costerebbe»; nessuno dei
 * due risponde a «quante ne sono arrivate davvero». E senza questo pezzo la risposta e' la
 * stessa identica sia quando il modello ha citato una nota sia quando l'ha ignorata del tutto.
 *
 * Fa anche una seconda cosa, che e' forse la piu' utile: quando un nodo Knowledge e'
 * collegato al prompt ma **non ha mandato niente**, lo dice. Il silenzio e' la risposta
 * peggiore, perche' e' identico per tre cause diverse — nodo non collegato, nodo non
 * configurato, note cancellate — e chi vede una risposta senza note non ha modo di sapere se
 * il canale e' rotto o semplicemente chiuso.
 */
export function ResponseKnowledge({
  promptId,
  used,
}: {
  promptId: string
  used: KnowledgeTrail | undefined
}) {
  const [open, setOpen] = useState(false)
  /*
   * I due array dell'archivio, presi **dal loro selettore** e non con `getState()` dentro il
   * selettore di un altro store.
   *
   * La differenza non e' di stile. Un `getState()` dentro una selezione non crea un
   * abbonamento: se l'archivio viene caricato dopo che il nodo e' comparso, il selettore non
   * viene richiamato e il confronto resta su un archivio vuoto — cioe' la riga direbbe «non e'
   * stato mandato niente» anche quando le note sono arrivate. E' il difetto esatto che questa
   * riga deve eliminare, quindi non puo' esserne essa stessa vittima.
   */
  const entries = useKnowledgeStore((state) => state.entries)
  const hubs = useKnowledgeStore((state) => state.hubs)
  /*
   * Due array dello store, presi **cosi' come sono**.
   *
   * Non si usa `workspaceDocumentFromState` come selettore, e la ragione e' quella che e'
   * costata piu' caro in questa applicazione: quella funzione costruisce un **oggetto nuovo**
   * a ogni chiamata, quindi come selettore restituisce sempre un valore diverso da prima,
   * React non smette mai di considerare il componente cambiato, e il ciclo non finisce. Il
   * sintomo e' `The result of getSnapshot should be cached to avoid an infinite loop`, che
   * lascia la pagina bianca senza spiegare niente.
   *
   * `nodes` ed `edges` sono gia' gli array dello store, quindi sono stabili: e' esattamente la
   * proprieta' che `selectorStability.test.ts` chiede a ogni selettore, e qui la si ottiene
   * scegliendo il selettore giusto invece di rimediare dopo.
   */
  const graphNodes = useWorkspaceStore((state) => state.nodes)
  const graphEdges = useWorkspaceStore((state) => state.edges)

  /*
   * L'archivio vive in un'altra pagina dell'applicazione e puo' non essere mai stato aperto
   * insieme a questa. Senza questa riga, un grafo in cui l'archivio non e' mai stato visitato
   * mostrerebbe «nessuna nota mandata» — che e' la risposta giusta, ma per il motivo sbagliato.
   */
  useEffect(() => {
    void ensureKnowledgeLoaded()
  }, [])

  const offered = useMemo(
    () => knowledgeOfferedToPrompt(graphNodes, graphEdges, promptId, entries, hubs),
    [graphNodes, graphEdges, promptId, entries, hubs],
  )

  /*
   * `used` assente e' un caso diverso da `entries` vuota, e la differenza conta.
   *
   * Assente vuol dire che la risposta e' anteriore alla traccia — un file salvato prima che
   * esistesse, o un file scritto a mano — quindi da li' non si puo' dedurre niente e non si
   * dice niente. Vuoto vuol dire che la corsa c'e' stata e le note non c'erano, che e'
   * un'informazione vera. Un avviso su un file vecchio sarebbe rumore, e il rumore e' il
   * motivo per cui gli avvisi vengono smessi.
   */
  if (!used) return null

  if (used.entries.length === 0) {
    if (offered.nodes === 0) return null
    /*
     * Il messaggio dice **perche'**, non solo che non e' successo qualcosa.
     *
     * Un avviso generico — «nessuna nota mandata, apri il nodo» — costringerebbe l'utente a
     * indovinare fra tre cause, e la piu' probabile non e' quella che il testo adivina. Qui la
     * riga sa quale delle due si e' verificata e la nomina, quindi la persona sa subito se
     * deve scegliere un punto di contesto o togliere la spunta a una nota che si e' accorta
     * di aver tolto.
     */
    /*
     * I pezzi cominciano con «has» e non con «it has» perche' la frase li precede
     * («the connected Knowledge node ...»). Con «it has» si leggeva «the node it has no main
     * point», che e' una frase rotta — e una riga di diagnostica rotta fa perdere fiducia
     * proprio nel momento in cui serve fidarsi.
     */
    const because =
      offered.unconfigured > 0
        ? 'has no main point of context yet — open the node and pick one'
        : offered.nothingTicked > 0
          ? 'has every note under its main point unticked, or that main point has no notes'
          : 'has nothing to send'
    return (
      <div className="response-knowledge is-quiet">
        <Library size={10} aria-hidden />
        <span>No notes were sent: the connected Knowledge node {because}.</span>
      </div>
    )
  }

  const listed = used.entries
  const hubNames = [...new Set(listed.map((entry) => entry.hub).filter((hub): hub is string => !!hub))]

  return (
    <div className="response-knowledge">
      <button
        type="button"
        className="response-knowledge-toggle"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <ChevronRight size={10} className={open ? 'is-open' : ''} aria-hidden />
        <Library size={10} aria-hidden />
        <span>
          Answered with <strong>{listed.length}</strong>{' '}
          {listed.length === 1 ? 'note' : 'notes'}
          {hubNames.length > 0 ? ` · ${hubNames.join(', ')}` : ''}
        </span>
      </button>
      {/*
        L'elenco aperto, perche' «2 note» non basta a nulla: quello che serve e' poter mettere
        la risposta accanto al materiale che aveva a disposizione e capire da li' se il canale
        sta funzionando. Il conteggio e' l'indizio, i titoli sono la prova.
      */}
      {open ? (
        <ul className="response-knowledge-list">
          {listed.map((entry) => (
            <li key={entry.id}>
              <span className="response-knowledge-title">{entry.title}</span>
              {entry.hub ? <span className="response-knowledge-hub">{entry.hub}</span> : null}
              {/*
                * Da dove e' arrivata. Due parole che sembrano superflue e tolgono l'ambiguita'
                * piu' comune di tutta questa parte: «questa nota l'ho scelta io, o il programma
                * l'ha trovata simile alla domanda?». Sono due comportamenti diversi con
                * conseguenze diverse, e senza questa riga sono indistinguibili.
                */}
              <span className="response-knowledge-via">
                {entry.via === 'node' ? 'you chose this' : 'picked as similar'}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}