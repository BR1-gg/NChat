import { nanoid } from 'nanoid'
import { create } from 'zustand'
import { db, type KnowledgeHubRow, type KnowledgeRow } from '../persistence/db'
import { neighboursOf, prepareEntry } from '../logic/knowledge'
import { clearShellPoint, corePoint } from '../logic/knowledgeShell'
import { isKnowledgeColor as isKnowledgeColour } from '../logic/knowledgeColour'
import type {
  KnowledgeDraft,
  KnowledgeEntry,
  KnowledgeColor,
  KnowledgeHub,
  KnowledgeId,
  Vec3,
} from '../types/knowledge'

/**
 * L'archivio della conoscenza: uno per applicazione, condiviso da tutti i workspace.
 *
 * E' deliberatamente **separato** dallo store del workspace. Non per eleganza, ma perche'
 * la conoscenza attraversa i confini che il workspace non attraversa: si salva da un
 * progetto e si usa in un altro, e la si deve ritrovare senza sapere in quale progetto sia
 * stata salvata. Un archivio dentro il documento sarebbe partigiano — del progetto in cui
 * e' nato — e un archivio in memoria sparirebbe chiudendo la scheda.
 *
 * **Il modello non scrive qui.** Non esiste un'azione che il modello possa invocare, e non
 * esiste un canale che porti una richiesta di cancellazione fino a `removeEntry`: la
 * promessa e' strutturale, non una riga di prompt. Vedi `KNOWLEDGE_READ_ONLY_NOTICE`.
 */

export interface KnowledgeState {
  entries: KnowledgeEntry[]
  /** The main points of context the user made. Empty is the normal state, not a failure. */
  hubs: KnowledgeHub[]
  loaded: boolean
  /** Bumped on every write, so views can tell a no-op reload from a real change. */
  revision: number

  load: () => Promise<void>
  save: (draft: KnowledgeDraft) => Promise<KnowledgeEntry | null>
  removeEntry: (id: KnowledgeId) => Promise<void>
  rename: (id: KnowledgeId, title: string) => Promise<void>

  /**
   * Makes a new main point and hangs a note on it.
   *
   * Le due cose insieme e non in due chiamate perche' e' un solo gesto dell'utente: il
   * centro e' nato perche' c'e' una nota che non sapeva dove mettersi. Lasciare i due
   * passi separati aprirebbe uno stato a meta' — un centro vuoto che nessuno ha chiesto
   * e che vive fino al prossimo avvio — e uno stato a meta' e' uno stato che l'utente
   * non sa come riparare.
   */
  createHub: (title: string, entryId?: KnowledgeId) => Promise<KnowledgeHub | null>

  renameHub: (id: KnowledgeId, title: string) => Promise<void>

  /**
   * Removes a main point, leaving its notes where they are.
   *
   * Le note **non vengono cancellate**: restano nell'archivio e diventano note libere. Il
   * punto di contesto e' stato un modo per ordinarle, non un contenitore, e cancellare
   * con il contenitore significa che il gesto di riordinare ha il costo di perdere il
   * lavoro. Verrebbe richiesta una conferma, e questa funzione non chiede niente perche'
   * non c'e' niente da confermare: il testo e' rimasto.
   */
  removeHub: (id: KnowledgeId) => Promise<void>

  /** Moves a note under a different main point, or off any with `null`. */
  attachToHub: (entryId: KnowledgeId, hubId: KnowledgeId | null) => Promise<void>

  /** Ties two notes together. Doing it twice changes nothing. */
  linkEntries: (a: KnowledgeId, b: KnowledgeId) => Promise<void>

  /** Unties two notes. Doing it twice changes nothing. */
  unlinkEntries: (a: KnowledgeId, b: KnowledgeId) => Promise<void>

  /**
   * Writes back where the notes ended up, after the map settled or after a drag.

   *
   * E' l'unica via con cui la posizione esce dalla mappa, ed e' lei — non un
   * ricalcolo — a decidere dove sta una nota. `positions` e' completo perche' la mappa
   * conosce tutti i pezzi: mandare un'id alla volta costerebbe una scrittura per nota a
   * ogni fotogramma in cui qualcosa si muove.
   */
  moveEntries: (positions: ReadonlyMap<KnowledgeId, Vec3>) => Promise<void>

  /**
   * Writes back where a main point ended up.
   *
   * Stessa soglia di `moveEntries` e per la stessa ragione: sotto una certa differenza la
   * posizione non e' cambiata in modo che si veda, e scriverla produrrebbe una scrittura a
   * ogni fotogramma per una mappa che sembra ferma.
   */
  moveHub: (id: KnowledgeId, position: Vec3) => Promise<void>

  /**
   * Adds or replaces notes that came from the vault folder.
   *
   * E' l'unica via con cui una nota entra nell'archivio **da fuori**, ed e' separata da `save`
   * per una ragione precisa: `save` calcola il posto e l'antefatto, e quelle due cose sono
   * la scelta dell'applicazione. Una nota che arriva da un file ha invece un posto e un gruppo
   * **dentro il file**, e ricalcolarli qui farebbe sparire il raggruppamento scritto a mano —
   * cioe' la cosa che l'utente ha spostato in quella cartella per ritrovarla.
   *
   * Le note che arrivano sostituiscono quelle con lo stesso id, e quelle con un id nuovo si
   * aggiungono. Quindi rileggere la cartella due volte non crea doppioni: e' il motivo per cui
   * gli id stanno nel nome del file.
   */
  importEntries: (entries: readonly KnowledgeEntry[]) => Promise<{ added: number; updated: number }>

  /**
   * Changes the shade a note is drawn in.
   *
   * Il nome della tonalita' viene **controllato** e non fidato: viene da un bottone oggi,
   * ma questa azione finisce anche in un file importato, e un colore che arriva da li'
   * entrerebbe nello stile di una pallina cosi' com'e'. Il controllo e' lo stesso della
   * lettura dal database, e per la stessa ragione.
   */
  setColour: (id: KnowledgeId, colour: KnowledgeColor) => Promise<void>
}

/** Reads an id list that may be missing, without never returning a shared array. */
function readLinks(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((id): id is string => typeof id === 'string' && id.length > 0)
}

/**
 * The colours a note may carry.
 *
 * Non e' una copia: viene da `logic/knowledgeColour.ts`, che e' il posto dove la palette e'
 * dichiarata e dove c'e' il test che verifica che corrisponda ai fogli di stile. Una seconda
 * lista qui si sarebbe allineata bene oggi e male domani, e senza nessun errore.
 */
const isKnowledgeColor = isKnowledgeColour

function rowToEntry(row: KnowledgeRow): KnowledgeEntry {
  return {
    id: row.id,
    title: row.title,
    text: row.text,
    source: {
      workspaceId: row.workspaceId,
      workspaceName: row.workspaceName,
      nodeTitle: row.nodeTitle,
      nodeId: row.nodeId,
    },
    // `hubId` e `links` non ci sono nelle righe scritte prima che esistessero: senza il
    // valore di ripiego, aprire un archivio gia' pieno getterebbe `undefined` dove il
    // resto del programma aspetta una lista, e il difetto si vedrebbe solo al riavvio.
    hubId: typeof row.hubId === 'string' && row.hubId ? row.hubId : null,
    links: readLinks(row.links),
    // Come sopra, ma per il colore: le righe senza questa colonna non hanno una scelta, e
    // l'assenza di una scelta **e'** una scelta — «il colore del tema». Rimapparirebbero
    // senza colore solo al prossimo salvataggio, che e' il modo peggiore di accorgersene.
    color: isKnowledgeColor(row.color) ? row.color : 'default',
    position: { x: row.positionX, y: row.positionY, z: row.positionZ },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    placedBecause: row.placedBecause,
  }
}

function entryToRow(entry: KnowledgeEntry): KnowledgeRow {
  return {
    id: entry.id,
    title: entry.title,
    text: entry.text,
    workspaceId: entry.source.workspaceId,
    workspaceName: entry.source.workspaceName,
    nodeTitle: entry.source.nodeTitle,
    nodeId: entry.source.nodeId,
    positionX: entry.position.x,
    positionY: entry.position.y,
    positionZ: entry.position.z,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    placedBecause: entry.placedBecause,
    hubId: entry.hubId,
    links: [...entry.links],
    // Copiata come **nome**, non come colore: la tabella tiene il nome della tonalita' e la
    // pallina la traduce in un numero esatto. Se qui finisse un esadecimale, un cambio di
    // tema cambierebbe il colore delle note gia' salvate senza che nessuno lo decida.
    color: entry.color,
  }
}

function rowToHub(row: KnowledgeHubRow): KnowledgeHub {
  return {
    id: row.id,
    title: row.title,
    position: { x: row.positionX, y: row.positionY, z: row.positionZ },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function hubToRow(hub: KnowledgeHub): KnowledgeHubRow {
  return {
    id: hub.id,
    title: hub.title,
    positionX: hub.position.x,
    positionY: hub.position.y,
    positionZ: hub.position.z,
    createdAt: hub.createdAt,
    updatedAt: hub.updatedAt,
  }
}

/** The name a new main point gets when the user has not written one. */
export const DEFAULT_HUB_TITLE = 'New main point'

/**
 * Where the next main point goes.
 *
 * Anello attorno all'origine, a distanza crescente con l'ordine di arrivo: e' la stessa
 * forma della separazione fra i punti, e per lo stesso motivo — due centri nati
 * consecutivamente devono poter essere distinti **a colpo d'occhio**, e la posizione e'
 * l'unica cosa che si vede senza dover leggere un nome. L'ordine e' quello di arrivo e
 * non si riordina: vedi il commento sul caricamento, dove vale lo stesso ragionamento.
 *
 * L'anello parte **stretto** e i passi sono piccoli, perche' la finestra mostra poco: un
 * centro a tredici unita' e le sue note a sedici escono dal campo visivo, e la mappa
 * sembra vuota mentre l'archivio e' pieno. Meglio un archivio che si vede tutto e si
 * accavalla un poco — che si puo' sempre allontanare con la rotella — che uno che non si
 * vede e non si puo' nemmeno giudicare.
 */
/**
 * Where the next main point goes.
 *
 * Il nocciolo, non l'anello. La formula e' in `logic/knowledgeShell.ts` — geometria in un
 * posto solo, perche' qui si chiama e li' si verifica, e due copie di una sfera di Fibonacci
 * divergono appena qualcuno ne cambia un numero.
 */
function nextHubPosition(index: number, total: number): Vec3 {
  return corePoint(index, total)
}

export const useKnowledgeStore = create<KnowledgeState>((set, get) => ({
  entries: [],
  hubs: [],
  loaded: false,
  revision: 0,

  async load() {
    if (get().loaded) return
    try {
      const [rows, hubRows] = await Promise.all([db.knowledge.toArray(), db.knowledgeHubs.toArray()])
      // In ordine di arrivo: e' l'ordine in cui sono nate, ed e' quello che stabilisce
      // dove finiscono le note successive. Riordinare per titolo renderebbe la mappa
      // diversa a ogni apertura dal punto di vista di chi l'ha costruita.
      rows.sort((a, b) => a.createdAt - b.createdAt)
      hubRows.sort((a, b) => a.createdAt - b.createdAt)
      set({ entries: rows.map(rowToEntry), hubs: hubRows.map(rowToHub), loaded: true })
    } catch {
      // Un archivio che non si apre non e' un motivo per non far partire l'applicazione:
      // si parte vuoto e si dice. Fermarsi qui lascerebbe l'utente con una schermata
      // morta e nessuna spiegazione.
      set({ entries: [], hubs: [], loaded: true })
    }
  },

  async save(draft) {
    const id = nanoid(12)
    const now = Date.now()
    /*
     * Il punto di contesto e' **quello che l'utente ha scelto**, mai uno indovinato.
     *
     * Il confronto fra le parole resta, ma decide **soltanto** dove cade la nota quando
     * l'utente non ha indicato un centro. Quando lo ha indicato, la nota va li': e' la
     * differenza fra un archivio che ti ascolta e uno che ti spiega perche' ha deciso di
     * non ascoltarti.
     *
     * Un centro che non esiste piu' viene trattato come nessun centro, perche' una nota
     * appesa a un id sparito resterebbe con un filo verso il vuoto — che e' la stessa
     * ragione per cui i collegamenti verso note cancellate si ignorano in lettura.
     */
    const hubId =
      draft.hubId && get().hubs.some((hub) => hub.id === draft.hubId) ? draft.hubId : null
    const prepared = prepareEntry(draft, get().entries, id, get().hubs)
    const entry: KnowledgeEntry = {
      id,
      title: prepared.title,
      text: prepared.text,
      source: draft.source,
      hubId,
      links: [],
      // Il colore parte da `default`, che vuol dire «il colore del tema». Non e' che la
      // nota non ne abbia: e' che l'utente non ne ha ancora scelto uno, e la differenza
      // conta perche' «non scelto» segue il tema mentre un colore fisso no.
      color: isKnowledgeColor(draft.color) ? draft.color : 'default',
      position: prepared.placement.position,
      createdAt: now,
      updatedAt: now,
      placedBecause: prepared.placement.because,
    }
    set((state) => ({ entries: [...state.entries, entry], revision: state.revision + 1 }))
    try {
      await db.knowledge.put(entryToRow(entry))
    } catch {
      // Resta comunque in memoria: perderla del tutto sarebbe peggio che perderla solo
      // in modo permanente, e l'utente la vede e puo' decidere.
    }
    return entry
  },

  async removeEntry(id) {
    /*
     * I collegamenti che puntavano a questa nota spariscono **dalle altre**, insieme alla
     * nota. Non si lasciano: un id che non porta piu' da nessuna parte e' esattamente
     * quello che `KnowledgeEntry.links` dichiara di non volere, e tenere un filo verso
     * una nota cancellata fa apparire un legame che non esiste piu' per il solo motivo
     * che qualcuno ha cancellato una nota — un difetto che sembra un ricordo e non lo e'.
     */
    const kept = get()
      .entries.filter((entry) => entry.id !== id)
      .map((entry) =>
        entry.links.includes(id)
          ? { ...entry, links: entry.links.filter((link) => link !== id), updatedAt: Date.now() }
          : entry,
      )
    set((state) => ({ entries: kept, revision: state.revision + 1 }))
    const orphans = get().entries.filter((entry) => entry.links.includes(id))
    try {
      await db.transaction('rw', db.knowledge, db.knowledgeHubs, async () => {
        await db.knowledge.delete(id)
        for (const entry of orphans) await db.knowledge.put(entryToRow(entry))
      })
    } catch {
      // Se il file non si cancella la nota sparisce comunque dalla schermata. Il caso
      // inverso — resta nella tabella e ricompare al prossimo avvio — e' l'unico davvero
      // fastidioso, ed e' per questo che si toglie prima dalla memoria.
    }
  },

  async rename(id, title) {
    const clean = title.replace(/\s+/g, ' ').trim()
    const now = Date.now()
    set((state) => ({
      entries: state.entries.map((entry) =>
        entry.id === id ? { ...entry, title: clean, updatedAt: now } : entry,
      ),
      revision: state.revision + 1,
    }))
    const entry = get().entries.find((candidate) => candidate.id === id)
    if (!entry) return
    try {
      await db.knowledge.put(entryToRow({ ...entry, title: clean, updatedAt: now }))
    } catch {
      /* come sopra: la memoria e' la verita' per quello che si vede */
    }
  },

  async createHub(title, entryId) {
    await get().load()
    const now = Date.now()
    const clean = title.replace(/\s+/g, ' ').trim() || DEFAULT_HUB_TITLE
    const hub: KnowledgeHub = {
      id: nanoid(12),
      title: clean,
      position: nextHubPosition(get().hubs.length, get().hubs.length + 1),
      createdAt: now,
      updatedAt: now,
    }
    set((state) => ({ hubs: [...state.hubs, hub], revision: state.revision + 1 }))

    if (entryId) {
      /*
       * La nota che ha fatto nascere il centro viene appesa subito, e la sua posizione
       * ricalcolata sul guscio del centro.
       *
       * Senza questo il centro apparirebbe vuoto per un istante e la nota resterebbe
       * dov'era, lontana, con un filo che attraversa mezzo spazio: la mappa direbbe che
       * la nota e' sua mentre la posizione direbbe il contrario, e dei due segni quello
       * che si vede di piu' e' quello falso.
       */
      const index = get().entries.filter((entry) => entry.hubId === hub.id).length
      // La posizione si calcola **fuori** dalla set, perche' ha bisogno delle altre note e
      // dentro ci sarebbero solo dentro il map, dove si rifarebbe per ogni nota
      // incontrata. La nota che si sposta e' esclusa dal confronto: sta andando
      // li', e misurarla contro se stessa darebbe sempre zero.
      const others = get().entries.filter((entry) => entry.id !== entryId)
      const position = clearShellPoint(hub.position, index + 1, entryId, get().hubs.length + 1, others)
      set((state) => ({
        entries: state.entries.map((entry) =>
          entry.id === entryId
            ? {
                ...entry,
                hubId: hub.id,
                position,
                placedBecause: `under "${trimForTitle(clean)}"`,
                updatedAt: now,
              }
            : entry,
        ),
        revision: state.revision + 1,
      }))
    }

    try {
      const hung = get().entries.filter((entry) => entry.hubId === hub.id)
      await db.transaction('rw', db.knowledge, db.knowledgeHubs, async () => {
        await db.knowledgeHubs.put(hubToRow(hub))
        for (const entry of hung) await db.knowledge.put(entryToRow(entry))
      })
    } catch {
      /* come sopra: resta in memoria e si vede */
    }
    return hub
  },

  async renameHub(id, title) {
    const clean = title.replace(/\s+/g, ' ').trim()
    const now = Date.now()
    const hub = get().hubs.find((candidate) => candidate.id === id)
    if (!hub) return
    const renamed = { ...hub, title: clean || hub.title, updatedAt: now }
    set((state) => ({
      hubs: state.hubs.map((candidate) => (candidate.id === id ? renamed : candidate)),
      // L'antefatto delle note cita il nome del centro, quindi rinominare il centro
      // cambia anche la frase che spiega **perche'** quelle note stanno li'. Se la frase
      // restasse quella vecchia, la mappa direbbe una cosa e la nota un'altra.
      entries: state.entries.map((entry) =>
        entry.hubId === id ? { ...entry, placedBecause: `under "${trimForTitle(renamed.title)}"`, updatedAt: now } : entry,
      ),
      revision: state.revision + 1,
    }))
    try {
      await db.transaction('rw', db.knowledge, db.knowledgeHubs, async () => {
        await db.knowledgeHubs.put(hubToRow(renamed))
        for (const entry of get().entries.filter((candidate) => candidate.hubId === id)) {
          await db.knowledge.put(entryToRow(entry))
        }
      })
    } catch {
      /* come sopra */
    }
  },

  async removeHub(id) {
    const now = Date.now()
    set((state) => ({
      hubs: state.hubs.filter((hub) => hub.id !== id),
      entries: state.entries.map((entry) =>
        entry.hubId === id
          ? { ...entry, hubId: null, placedBecause: 'no main point yet', updatedAt: now }
          : entry,
      ),
      revision: state.revision + 1,
    }))
    /*
     * Le note da riscrivere si rileggono **dopo** l'aggiornamento, non prima.
     *
     * Leggendole prima si prenderebbero le righe con il centro ancora attaccato, e
     * riscriverle rimetterebbe quell'id sul disco: in memoria il centro sparirebbe, nel
     * file resterebbe, e alla riapertura l'archivio mostrerebbe di nuovo il centro che
     * l'utente aveva appena tolto — con le note gia' sganciate, quindi con un involucro
     * vuoto che non si spiega. E' il difetto peggiore di tutti, perche' i due posti dove si
     * guarda discordano e non si sa quale dei due abbia ragione.
     */
    const detached = get().entries.filter((entry) => entry.hubId === null)
    try {
      await db.transaction('rw', db.knowledge, db.knowledgeHubs, async () => {
        await db.knowledgeHubs.delete(id)
        for (const entry of detached) await db.knowledge.put(entryToRow(entry))
      })
    } catch {
      /* come sopra */
    }
  },

  async attachToHub(entryId, hubId) {
    const now = Date.now()
    const entry = get().entries.find((candidate) => candidate.id === entryId)
    if (!entry) return
    const hub = hubId ? get().hubs.find((candidate) => candidate.id === hubId) ?? null : null
    const cleanHubId = hub?.id ?? null
    /*
     * La posizione segue il centro solo quando la nota ne cambia. Una nota gia' appesa
     * che viene riappesa allo stesso centro resta dove l'utente l'ha messa: il centro
     * organizza, non possiede, e una nota spostata da un gesto che non chiedeva di
     * spostarla e' una nota che si perde sotto gli occhi.
     */
    const moved = entry.hubId !== cleanHubId && cleanHubId !== null
    const position = moved
        ? clearShellPoint(
            hub!.position,
            indexInHub(get().entries, cleanHubId) + 1,
            entryId,
            get().hubs.length,
            get().entries,
          )
        : entry.position
    const because = cleanHubId
      ? `under "${trimForTitle(hub!.title)}"`
      : 'no main point yet'
    const next = { ...entry, hubId: cleanHubId, position, placedBecause: because, updatedAt: now }
    set((state) => ({
      entries: state.entries.map((candidate) => (candidate.id === entryId ? next : candidate)),
      revision: state.revision + 1,
    }))
    try {
      await db.knowledge.put(entryToRow(next))
    } catch {
      /* come sopra */
    }
  },

  async linkEntries(a, b) {
    if (a === b) return
    const state = get()
    if (!state.entries.some((entry) => entry.id === a) || !state.entries.some((entry) => entry.id === b)) {
      return
    }
    // Il rapporto e' letto come simmetrico, quindi il collegamento si scrive una volta
    // sola, sul lato che **non** ce l'ha ancora. Scriverlo due volte produrrebbe due
    // fili per lo stesso rapporto, e una mappa che mostra doppio quello che e' uno solo.
    const already = neighboursOf(state.entries, a).includes(b)
    if (already) return
    const now = Date.now()
    const next = {
      ...state.entries.find((entry) => entry.id === a)!,
      links: [...state.entries.find((entry) => entry.id === a)!.links, b],
      updatedAt: now,
    }
    set((current) => ({
      entries: current.entries.map((entry) => (entry.id === a ? next : entry)),
      revision: current.revision + 1,
    }))
    try {
      await db.knowledge.put(entryToRow(next))
    } catch {
      /* come sopra */
    }
  },

  async unlinkEntries(a, b) {
    /*
     * Il rapporto e' letto come simmetrico, quindi si toglie da **chi lo tiene**: puo'
     * essere `a` che punta a `b`, `b` che punta a `a`, o nessuno dei due. Si controlla
     * tutti e due i lati e si scrive solo quello che cambia, cosi' togliere due volte non
     * scrive niente e non tocca `updatedAt` di una nota che non e' stata toccata.
     */
    const now = Date.now()
    const changed = get()
      .entries.map((entry) => {
        if (entry.id === a && entry.links.includes(b)) {
          return { ...entry, links: entry.links.filter((link) => link !== b), updatedAt: now }
        }
        if (entry.id === b && entry.links.includes(a)) {
          return { ...entry, links: entry.links.filter((link) => link !== a), updatedAt: now }
        }
        return entry
      })
      .filter((entry, index) => entry !== get().entries[index])
    if (changed.length === 0) return
    set((state) => ({
      entries: state.entries.map((entry) => changed.find((target) => target.id === entry.id) ?? entry),
      revision: state.revision + 1,
    }))
    try {
      await db.transaction('rw', db.knowledge, async () => {
        for (const entry of changed) await db.knowledge.put(entryToRow(entry))
      })
    } catch {
      /* come sopra */
    }
  },

  async moveEntries(positions) {
    if (positions.size === 0) return
    const now = Date.now()
    const changed: KnowledgeEntry[] = []
    set((state) => ({
      entries: state.entries.map((entry) => {
        const at = positions.get(entry.id)
        // Sotto una soglia la posizione non e' cambiata in modo che si veda, e scriverla
        // produrrebbe una scrittura a ogni fotogramma per una mappa che sembra ferma.
        // La soglia e' piu' grande della precisione del salvataggio perche' un decimo di
        // mm non cambia dove si vede una pallina.
        if (!at) return entry
        const moved =
          Math.abs(at.x - entry.position.x) > 0.05 ||
          Math.abs(at.y - entry.position.y) > 0.05 ||
          Math.abs(at.z - entry.position.z) > 0.05
        if (!moved) return entry
        const next = { ...entry, position: { ...at }, updatedAt: now }
        changed.push(next)
        return next
      }),
      revision: state.revision + 1,
    }))
    if (changed.length === 0) return
    try {
      await db.transaction('rw', db.knowledge, async () => {
        for (const entry of changed) await db.knowledge.put(entryToRow(entry))
      })
    } catch {
      /* come sopra: la memoria e' la verita' per quello che si vede */
    }
  },

  async moveHub(id, position) {
    const hub = get().hubs.find((candidate) => candidate.id === id)
    if (!hub) return
    if (
      Math.abs(hub.position.x - position.x) < 0.05 &&
      Math.abs(hub.position.y - position.y) < 0.05 &&
      Math.abs(hub.position.z - position.z) < 0.05
    ) {
      return
    }
    const next = { ...hub, position: { ...position }, updatedAt: Date.now() }
    set((state) => ({
      hubs: state.hubs.map((candidate) => (candidate.id === id ? next : candidate)),
      revision: state.revision + 1,
    }))
    try {
      await db.knowledgeHubs.put(hubToRow(next))
    } catch {
      /* come sopra */
    }
  },

  async setColour(id, colour) {
    // Il nome viene controllato **prima** di entrare nello stato, non dopo: una nota con un
    // colore che non esiste non si vedrebbe, e il difetto si scoprirebbe guardando la
    // mappa, che e' il posto peggiore per accorgersi di un errore di scrittura.
    if (!isKnowledgeColor(colour)) return
    const entry = get().entries.find((candidate) => candidate.id === id)
    if (!entry || entry.color === colour) return
    const next = { ...entry, color: colour, updatedAt: Date.now() }
    set((state) => ({
      entries: state.entries.map((candidate) => (candidate.id === id ? next : candidate)),
      revision: state.revision + 1,
    }))
    try {
      await db.knowledge.put(entryToRow(next))
    } catch {
      /* come sopra: la memoria e' la verita' per quello che si vede */
    }
  },

  async importEntries(incoming) {
    if (incoming.length === 0) return { added: 0, updated: 0 }
    const before = new Set(get().entries.map((entry) => entry.id))
    let added = 0
    let updated = 0
    for (const entry of incoming) {
      if (before.has(entry.id)) updated += 1
      else added += 1
    }
    /*
     * Le note che arrivano sostituiscono quelle con lo stesso id, e si mettono in **ordine di
     * arrivo** insieme a quelle che gia' c'erano.
     *
     * L'ordine conta perche' stabilisce dove cadono le note successive: un archivio letto da
     * una cartella deve continuare a crescere come prima, non ricominciare a ogni lettura.
     * E per la stessa ragione le note importate non passano da `placeKnowledge`: il loro
     * posto e' scritto nel file e ricalcolarlo farebbe sparire il raggruppamento che
     * l'utente ha messo li' a mano.
     */
    const merged = [...get().entries]
    for (const entry of incoming) {
      const at = merged.findIndex((candidate) => candidate.id === entry.id)
      if (at < 0) merged.push(entry)
      else merged[at] = entry
    }
    merged.sort((a, b) => a.createdAt - b.createdAt)
    set((state) => ({ entries: merged, revision: state.revision + 1 }))
    try {
      await db.transaction('rw', db.knowledge, async () => {
        for (const entry of incoming) await db.knowledge.put(entryToRow(entry))
      })
    } catch {
      /* come sopra */
    }
    return { added, updated }
  },
}))

/** How many notes already hang from a main point. Drives where the next one lands. */
function indexInHub(entries: readonly KnowledgeEntry[], hubId: KnowledgeId): number {
  return entries.filter((entry) => entry.hubId === hubId).length
}

function trimForTitle(text: string): string {
  const clean = text.trim().replace(/\s+/g, ' ')
  return clean.length > 40 ? `${clean.slice(0, 39)}…` : clean
}

/**
 * The archive, for the run path.
 *
 * Un selettore con una funzione che **filtra** restituirebbe un array nuovo a ogni lettura,
 * e `selectorStability.test.ts` spiega perche' questo fa esplodere l'app all'avvio. Per
 * questo qui si restituisce l'array stesso che c'e' nello store, e chi lo usa deve sapere
 * che e' quello.
 */
export function knowledgeEntries(): readonly KnowledgeEntry[] {
  return useKnowledgeStore.getState().entries
}

/** The main points, by the same rule as `knowledgeEntries`: the store's own array. */
export function knowledgeHubs(): readonly KnowledgeHub[] {
  return useKnowledgeStore.getState().hubs
}

/** Loads the archive once. Safe to call from anywhere; it does nothing after the first. */
export function ensureKnowledgeLoaded(): Promise<void> {
  return useKnowledgeStore.getState().load()
}