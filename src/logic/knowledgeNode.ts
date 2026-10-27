import { neighboursOf, pickedInjection } from './knowledge'
import type {
  KnowledgeEntry,
  KnowledgeHub,
  KnowledgeId,
} from '../types/knowledge'
import type { AppEdge, AppNode, KnowledgeNodeData } from '../types/document'

/**
 * Il nodo che pesca dall'archivio: che cosa manda al prompt, e che cosa non manda.
 *
 * Tutto qui dentro e' **puro e sincrono**, come il resto di `logic/knowledge.ts`, e per la
 * stessa ragione: la domanda «quali note arrivano al modello quando eseguo questo prompt?» e'
 * la piu' importante di questa parte del programma, ed e' l'unica che si puo' decidere con
 * un test invece che guardando una risposta e sperando che sia giusta.
 *
 * Il caso che chiude questo file e' la nota **cancellata**: la lista del nodo tiene degli id,
 * e un id che non porta piu' da nessuna parte e' esattamente quello che `neighboursOf` chiama
 * «un filo appeso». Qui non si butta via in silenzio, perche' un blocco che manda quattro
 * note quando ne erano state scelte cinque e' una risposta costruita su materiale diverso da
 * quello che l'utente aveva davanti — e l'unico indizio e' una risposta un po' strana.
 */

/** What a Knowledge node sends to the prompt, and what happened on the way. */
export interface KnowledgePick {
  /** The text to put in the context, or `null` when there is nothing to send. */
  block: string | null
  /** The main point it pulled from, or `null` when none was chosen. */
  hubTitle: string | null
  /** The notes that went in, oldest first. */
  notes: KnowledgeEntry[]
  /** Ids the node still remembers that no longer exist in the archive. */
  missing: KnowledgeId[]
  /** A rough token figure, for the node's own footer. */
  estimatedTokens: number
}

/**
 * The shape a node may be in before the schema has filled in its defaults.
 *
 * Accetta anche `undefined` perche' il componente chiama queste funzioni **prima** del suo
 * controllo `if (!data) return null`, e spostare il controllo dentro la funzione renderebbe
 * il nodo un caso speciale: si chiama una funzione che risponde «niente da mandare» per un
 * nodo che forse non esiste, e la risposta giusta a una domanda su un nodo inesistente e'
 * esattamente la stessa che si darebbe a un nodo vuoto.
 */
type MaybeNodeData = (Partial<KnowledgeNodeData> & { kind?: string }) | undefined

/**
 * Which notes this node sends, in the order they are sent.
 *
 * L'ordine e' quello di arrivo nell'archivio — cioe' l'ordine in cui sono state salvate — e non
 * quello della lista del nodo. Il motivo e' che la lista si riordina ogni volta che l'utente
 * tocca una spunta, e un blocco che cambia ordine fra due esecuzioni dello stesso prompt
 * produce risposte diverse alla stessa domanda; l'ordine di arrivo e' l'unico che non
 * dipende dall'ultimo gesto.
 */
export function resolveKnowledgePick(
  data: MaybeNodeData,
  entries: readonly KnowledgeEntry[],
  hubs: readonly KnowledgeHub[],
): KnowledgePick {
  const empty: KnowledgePick = {
    block: null,
    hubTitle: null,
    notes: [],
    missing: [],
    estimatedTokens: 0,
  }
  if (!data || data.kind !== 'knowledge') return empty

  /*
   * Un nodo in modalita' `auto` non e' un nodo senza centro: e' un nodo che chiede il
   * recupero.
   *
   * Qui si risponde «niente da mandare» perche' il recupero non puo' stare in questa
   * funzione — serve la **domanda**, e questa funzione non la conosce. Percio' la risposta e'
   * vuota e non un errore: il chiamante che sa la domanda (vedi `assemble.ts`) fa il recupero
   * e costruisce il blocco. Mettere il recupero qui avrebbe significato passare la domanda
   * in questa funzione, e allora questa non sarebbe piu' «che cosa manda il nodo da solo» ma
   * «che cosa manda il nodo quando qualcuno sa che cosa stai chiedendo»: due funzioni
   * diverse, con due test diversi.
   */
  if (data.auto === true) return empty

  const hubId = typeof data.hubId === 'string' && data.hubId ? data.hubId : null
  if (!hubId) return empty

  const hub = hubs.find((candidate) => candidate.id === hubId)
  // Il centro non c'e' piu'. Non e' un errore da fermare la corsa per: si manda quello che
  // c'e' e si dice. Fermarsi lascerebbe l'utente con un prompt che non parte e nessuna
  // spiegazione, e la spiegazione — «il punto di contesto non c'e' piu'» — arriva in un
  // avviso che non blocca niente.
  const missing: KnowledgeId[] = hub ? [] : [hubId]

  const under = entries.filter((entry) => entry.hubId === hubId)
  const chosen: KnowledgeEntry[] = []
  const seen = new Set<KnowledgeId>()

  const take = (entry: KnowledgeEntry): void => {
    if (seen.has(entry.id)) return
    seen.add(entry.id)
    chosen.push(entry)
  }

if (data.includeNotes === true) {
    /*
     * La lista e' **esattamente** quello che viene mandato: vuota vuol dire nessuna.
     *
     * C'e' stato un tempo in cui vuota voleva dire «tutte», per non far partire blocchi vuoti
     * appena si sceglieva un centro. Ma allora la stessa lista vuota voleva dire anche «nessuna»,
     * e una casella di spunta non spuntata accanto a un piede che dice «2 note» e' la peggiore
     * delle contraddizioni: l'utente legge la spunta, crede di aver tolto due note, e le due
     * note vengono mandate lo stesso.
     *
     * Quindi il vuoto ha un solo significato — nessuna — e il momento in cui si accende «manda
     * le note di questo centro» **riempie** la lista con tutte quelle che ci sono. Da quel
     * momento la lista e' la verita'. Una nota che arriva dopo non si aggiunge da sola: si
     * vede non spuntata e la si spunta, che e' preferibile a una nota che entra in un blocco
     * gia' in uso senza che nessuno lo decida.
     */
    const picked = Array.isArray(data.entryIds) ? data.entryIds : []
    const wanted = new Set(picked)
    for (const entry of under) {
      if (wanted.has(entry.id)) take(entry)
    }
    /*
     * Una spunta che punta a un id che non c'e' piu' non e' un problema da segnalare: e' il caso
     * normale di una nota cancellata, e il nodo non ha modo di accorgersene da solo. Quello che
     * si segnala e' il contrario — una spunta che punta a un id che **esiste** ma non sta sotto
     * **quel** centro — perche' li' il nodo credeva di aver preso qualcosa che l'utente aveva
     * scelto e che non sarebbe arrivato, e senza dire niente.
     */
    for (const id of picked) {
      if (under.some((entry) => entry.id === id)) continue
      if (entries.some((entry) => entry.id === id)) continue
      missing.push(id)
    }
  }
  if (data.includeLinked === true) {
    for (const entry of [...chosen]) {
      for (const neighbourId of neighboursOf(entries, entry.id)) {
        const neighbour = entries.find((candidate) => candidate.id === neighbourId)
        if (neighbour) take(neighbour)
      }
    }
  }

  /*
   * `pickedInjection` invece di costruire il blocco qui.
   *
   * Il testo che arriva al modello ha una **forma sola** in tutta l'applicazione — la stessa
   * intestazione, la stessa avviso di sola lettura, gli stessi due punti che chiudono il
   * blocco. Costruirne un secondo qui accanto vuol dire che i due divergono al primo
   * ritocco, e che in quel momento una nota scelta a mano entrerebbe nel contesto senza
   * l'avviso che il modello non puo' modificarla: cioe' senza la promessa che tiene insieme
   * tutta questa parte.
   */
  const injection = pickedInjection(chosen, hub?.title ?? null)
  return {
    block: injection,
    hubTitle: hub?.title ?? null,
    notes: chosen,
    missing,
    estimatedTokens: injection ? estimate(injection) : 0,
  }
}

/** Rough token figure for the node's own footer, on the same estimate the run uses. */
function estimate(block: string): number {
  return Math.ceil(block.length / 3.6)
}

/**
 * Le note che stanno sotto il centro che questo nodo indica, **tutte**.
 *
 * Due scelte deliberate, entrambe da una cosa osservata.
 *
 * La prima: la lista non guarda `includeNotes`. Un tempo lo guardava, e il risultato era un
 * difetto invisibile — il momento in cui si accende «manda le note di questo centro» la
 * spunta riempie la lista con tutte le note del centro, ma la lista veniva calcolata **prima**
 * che la spunta cambiasse, quindi con la lista ancora vuota. Il nodo si accendeva e non
 * selezionava niente: due note elencate, tutte da spuntare a mano, e un piede che diceva
 * «0 notes». Non un errore di logica, un ordine sbagliato: la funzione che doveva rispondere
 * «cosa c'e' sotto questo centro» rispondeva invece «cosa c'e' sotto questo centro **e che sto
 * gia' mandando**», e le due domande non coincidono.
 *
 * La seconda: la lista contiene **tutte** le note del centro, spuntate o no. Una nota tolta
 * dalla spunta deve restare nella lista: e' l'unica riga che dice quale nota era stata tolta,
 * e senza di essa l'unico modo per recuperare una nota levata per sbaglio sarebbe spegnere e
 * riaccendere la casella, che azzera tutta la lista.
 *
 * E' una funzione e non un `useMemo` dentro il componente perche' la stessa lista serve al
 * componente, al piede del nodo e ai test. Tre copie della stessa enumerazione sono tre
 * occasioni che il numero mostrato e quello mandato divergano — e il numero e' l'unica cosa
 * che l'utente usa per capire quanto sta per costare.
 */
export function notesOfferedBy(
  data: MaybeNodeData,
  entries: readonly KnowledgeEntry[],
): KnowledgeEntry[] {
  if (data?.kind !== 'knowledge') return []
  const hubId = typeof data.hubId === 'string' && data.hubId ? data.hubId : null
  if (!hubId) return []
  return entries.filter((entry) => entry.hubId === hubId)
}

/**
 * Cosa farebbero i nodi Knowledge collegati a un prompt, **senza mandare niente**.
 *
 * Esiste per il caso in cui l'utente ha un nodo Knowledge sul grafo e non vede nulla. Senza
 * questa funzione la risposta semplicemente non parla di note, ed e' impossibile distinguere
 * tre cose che sembrano identiche: il nodo non e' collegato, e' collegato ma non configurato,
 * e' configurato e ha mandato le note. Tre situazioni diverse, una sola immagine — e quella
 * immagine e' «silenzio», che e' la risposta meno informativa che si possa dare.
 *
 * La firma prende **due array**, `nodes` ed `edges`, e non un documento intero. Non perche' sia
 * piu' comodo: perche' il chiamante e' un componente React, e passargli il documento lo
 * costringerebbe a costruire un oggetto nuovo a ogni render dentro un selettore — che e' il
 * difetto che fa girare il ciclo di render all'infinito e che in questa applicazione e' gia'
 * successo. `nodes` ed `edges` sono invece gli array stessi dello store, quindi sono stabili e
 * si possono usare come dipendenza di un `useMemo` senza accorgersene.
 *
 * Restituisce **perche'** non solo **quanto**. Un numero solo («0 note») costringerebbe a
 * scrivere un avviso generico, e un avviso generico che dice «scegli un punto di contesto» su
 * un nodo che ne ha gia' uno scelto e' peggio di nessun avviso: l'utente va a cercare un centro
 * che c'e' e non lo trova, e la riga che doveva chiarire il dubbio lo conferma.
 *
 * Percio' le due cause si contano separate: `unconfigured` per il nodo senza centro, e
 * `nothingTicked` per il nodo col centro ma con la lista vuota. Sono due cose che si
 * sistemano in due modi opposti, e confonderle fa perdere tempo a chi sta cercando il difetto.
 *
 * Restituisce un **conteggio** e non un elenco di nomi perche' l'uso e' un confronto: «il nodo
 * prometteva 2 note e ne sono arrivate 0» e' un fatto; i nomi servono solo al debug.
 */
export function knowledgeOfferedToPrompt(
  nodes: readonly AppNode[],
  edges: readonly AppEdge[],
  promptId: string,
  entries: readonly KnowledgeEntry[],
  hubs: readonly KnowledgeHub[],
): { nodes: number; notes: number; unconfigured: number; nothingTicked: number } {
  const sources = new Set<string>()
  for (const edge of edges) {
    if (edge.kind !== 'context') continue
    if (edge.target !== promptId) continue
    sources.add(edge.source)
  }
  let count = 0
  let notes = 0
  let unconfigured = 0
  let nothingTicked = 0
  for (const source of sources) {
    const node = nodes.find((candidate) => candidate.id === source)
    if (!node || node.data.kind !== 'knowledge') continue
    count += 1
    const hubId = typeof node.data.hubId === 'string' && node.data.hubId ? node.data.hubId : null
    if (!hubId) {
      /*
       * Nodo collegato ma senza centro: si conta a parte perche' e' l'unica causa per cui
       * ha senso dire «scegli un punto di contesto».
       */
      unconfigured += 1
      continue
    }
    const picked = resolveKnowledgePick(node.data, entries, hubs).notes.length
    notes += picked
    if (picked === 0) nothingTicked += 1
  }
  return { nodes: count, notes, unconfigured, nothingTicked }
}