import Dexie, { type Table } from 'dexie'
import type { WorkspaceDocument } from '../types/document'

export interface WorkspaceMeta {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  lastOpenedAt: number
  nodeCount: number
  edgeCount: number
  sizeBytes: number
  docVersion: number
  revision: number
  thumbnail?: string
}

export interface DocumentRow {
  id: string
  document: WorkspaceDocument
}

export interface AppStateRow {
  key: string
  value: unknown
}

export type SnapshotReason = 'import-replace' | 'delete' | 'manual'

export interface SnapshotRow {
  id: string
  workspaceId: string
  createdAt: number
  reason: SnapshotReason
  document: WorkspaceDocument
}

/**
 * A directory the user granted, kept **outside** the document.
 *
 * A `FileSystemDirectoryHandle` is a live capability, not data: `JSON.stringify`
 * turns it into `{}`, so putting it in the document would break export on the
 * first try and, worse, export a node that looks authorised and is not. It lives
 * here instead, keyed by the node that owns it, and the document only ever holds
 * the path as text.
 */
export interface DirectoryHandleRow {
  /** The node that owns this grant. */
  nodeId: string
  handle: FileSystemDirectoryHandle
  /** The path as text, for display and for the export. */
  path: string
  grantedAt: number
}

/**
 * One saved passage, stored **outside** every workspace.
 *
 * E' una tabella a se stante e non un campo dentro il documento, perche' la conoscenza non
 * appartiene a un workspace: e' quello che l'utente ha deciso di tenere. Metterla dentro un
 * progetto significherebbe che cancellare il progetto la porta via — e che, per trovarla,
 * si debba aprire il progetto giusto, quando il punto e' che vale per tutti.
 *
 * I campi di provenienza sono **testi** (`workspaceName`, `nodeTitle`) e non solo id: il
 * workspace e il nodo possono essere cancellati, e un riferimento vivo diventerebbe un id
 * che non porta piu' da nessuna parte. Il nome resta vero anche quando il nodo non c'e' piu'.
 *
 * `createdAt` e' indicizzata perche' il recupero e' una domanda sul quando, e il tavolo si
 * legge tutto. Su qualche migliaia di voci e' trascurabile; quando diventassero centinaia di
 * migliaia, e' l'indice su cui si costruirebbe quello sul testo.
 */
export interface KnowledgeRow {
  id: string
  title: string
  text: string
  workspaceId: string | null
  workspaceName: string | null
  nodeTitle: string | null
  nodeId: string | null
  positionX: number
  positionY: number
  positionZ: number
  createdAt: number
  updatedAt: number
  placedBecause: string
  /**
   * The main point this note hangs from, and `null` when it floats.
   *
   * Indicizzato perche' la domanda piu' frequente sulla tabella non e' «tutte le note»
   * ma «le note di **questo** punto di contesto», e senza indice quella domanda
   * diventa un scansione di tutta la tabella ogni volta che si sceglie un centro nella
   * mappa.
   */
  hubId?: string | null
  /** Notes this one is tied to. See `KnowledgeEntry.links` for why it is one-way. */
  links?: string[]
  /**
   * The colour the user chose, or `'default'`.
   *
   * Testo e non un numero: la palette e' un elenco **chiuso** di nomi, e un numero in un
   * file salvato finirebbe in uno stile senza che nessuno lo controlli. Il `default` e' un
   * valore valido, non un'assenza — «il colore del tema» e' una scelta, e senza questa
   * colonna le note gia' salvate aprirebbero senza colore e non si saprebbe se sia un
   * errore o una scelta.
   */
  color?: string
}

/**
 * A main point of context: a centre the user made, with the notes hung on it.
 *
 * Tabella a se stante e non un campo dentro le note, per la stessa ragione per cui la
 * conoscenza sta fuori dai workspace: un punto di contesto esiste **prima** delle note
 * che vi appenderemo e sopravvive a tutte. Se fosse una riga nelle note, cancellare
 * l'ultima nota che vi era agganciata cancellerebbe anche il centro — cioe' il
 * raggruppamento verrebbe perso proprio nel momento in cui si svuota, che e' l'unico
 * momento in cui si vorrebbe sapere che quel centro esisteva.
 */
export interface KnowledgeHubRow {
  id: string
  title: string
  positionX: number
  positionY: number
  positionZ: number
  createdAt: number
  updatedAt: number
}

/**
 * The folder the archive is also written to, as files.
 *
 * Una riga sola, `id: 'root'`, perche' il deposito e' uno solo. `handle` e' la capacita' viva
 * data dal browser e `path` il percorso come testo: il testo e' quello che si puo' mostrare,
 * copiare e riconoscere, e resta vero anche se la capacita' sparisce — cosa che succede, e
 * non e' un errore da nascondere ma uno stato da dire.
 */
export interface VaultRow {
  id: string
  handle: FileSystemDirectoryHandle
  path: string
  /** When the folder was chosen, and when it was last written to. */
  chosenAt: number
  writtenAt: number | null
  /** How many notes the last write put on disk. */
  noteCount: number
}

export class NCHATDatabase extends Dexie {
  workspaces!: Table<WorkspaceMeta, string>
  documents!: Table<DocumentRow, string>
  directories!: Table<DirectoryHandleRow, string>
  appState!: Table<AppStateRow, string>
  snapshots!: Table<SnapshotRow, string>
  knowledge!: Table<KnowledgeRow, string>
  knowledgeHubs!: Table<KnowledgeHubRow, string>
  knowledgeVault!: Table<VaultRow, string>

  constructor(name = 'nchat') {
    super(name)
    this.version(1).stores({
      workspaces: 'id, updatedAt, lastOpenedAt, name',
      documents: 'id',
      appState: 'key',
      snapshots: 'id, workspaceId, createdAt',
    })
    // A second version rather than an edit to the first: Dexie upgrades an
    // existing database in place, and changing version 1 would leave the stores
    // of every already-created database untouched.
    this.version(2).stores({ directories: 'nodeId' })
    // Same rule for the third: this table is new, and an existing database has to be
    // upgraded to have it. Writing it into version 1 would create the table only for
    // databases created from now on, which is how a feature ends up working for the
    // developer and not for anyone else.
    this.version(3).stores({ knowledge: 'id, createdAt' })
    /*
     * La quarta versione aggiunge i **punti di contesto** e due campi alle note.
     *
     * La tabella e' nuova e quindi va dichiarata in una versione nuova: dichiararla
     * nella prima creerebbe la tabella solo per i database creati da adesso, ed e'
     * esattamente il difetto che il commento sulla terza versione descrive — la
     * funziona per chi l'ha scritta e non per chi l'ha installata.
     *
     * `hubId` entra anche nell'indice delle note. La domanda che si fa piu' spesso
     * non e' «tutte le note» ma «le note di questo centro», e senza indice quella
     * domanda scansiona tutta la tabella a ogni clic.
     *
     * I campi nuovi sulle note sono **facoltativi** (`hubId?`, `links?`) e non
     * obbligatori: un archivio gia' salvato non ha nessuno dei due, e senza il
     * facoltativo Dexie si fermerebbe a meta' scrivendo righe che il codice non
     * riesce a rileggere — il difetto peggiore, perche' si vede solo al riavvio e
     * su un archivio che sembrava pieno. Le righe senza quei campi si aprono come
     * «nessun centro» e «nessun collegamento», che e' esattamente quello che sono.
     */
    this.version(4).stores({
      knowledge: 'id, createdAt, hubId',
      knowledgeHubs: 'id, createdAt',
    })
    /*
     * La quinta versione aggiunge il **colore** alle note, e per lo stesso motivo della
     * terza e della quarta: la tabella esiste gia' in chi ha aperto questa versione, e
     * aggiungere una colonna dentro la versione 4 non la aggiungerebbe li'. Dexie non
     * ricontrolla una versione gia' applicata, quindi il campo ci sarebbe solo per chi
     * installa da adesso — che e' come una funziona per chi l'ha scritta e non per chi
     * l'installa.
     *
     * Facoltativo anche questo, per la ragione detta sopra: le note gia' salvate aprono
     * senza colore, che e' «il colore del tema», e non come una perdita.
     */
    this.version(5).stores({
      knowledge: 'id, createdAt, hubId',
      knowledgeHubs: 'id, createdAt',
    })
    /*
     * La sesta versione aggiunge il **deposito**: la cartella del computer in cui l'archivio
     * viene scritto come file.
     *
     * Una tabella sola, con una riga sola, perche' l'archivio e' uno solo per applicazione e
     * il deposito e' uno solo per archivio. Non e' una scorciatoia: due depositi significherebbero
     * due cartelle in cui finisce la stessa nota, e non si saprebbe quale e' quella vera —
     * l'ambiguit' su un archivio e' il difetto peggiore, perche' ogni scrittura andrebbe a
     * una delle due e il risultato dipenderebbe da quale e' stata aperta per prima.
     *
     * `handle` e' una **capacita' viva**, non dati: `JSON.stringify` la riduce a `{}`. Quindi
     * sta qui e non dentro l'archivio, come vale per le cartelle dei nodi file, e l'archivio
     * porta solo il percorso come testo — che e' la cosa che si puo' leggere e capire anche
     * su un'altra macchina.
     */
    this.version(6).stores({ knowledgeVault: 'id' })
  }
}

export const db = new NCHATDatabase()
