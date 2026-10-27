import type { Edge, Node, XYPosition } from '@xyflow/react'
import type { AppError } from './errors'
import type { KnowledgeTrail } from './knowledge'
import { DEFAULT_SETTINGS, type Settings } from './settings'

export type NodeId = string
export type EdgeId = string
export type ISOTime = number
export type NodeType =
  | 'prompt'
  | 'response'
  | 'system'
  | 'note'
  | 'set'
  | 'output'
  | 'summary'
  | 'image'
  | 'file'
  | 'folder'
  | 'brain'
  | 'knowledge'
  | 'group'
/**
 * `set` is legacy: grouping now produces an `output` node. `group` is not addable
 * either — it only ever comes into being by gathering nodes that are already there.
 */
export type AddableNodeType = Exclude<NodeType, 'response' | 'summary' | 'set' | 'group'>
export type HandleId = string
export type NodePosition = XYPosition

export const HANDLES = {
  prompt: { out: 'out', in: 'context', system: 'system' },
  response: { out: 'context', in: 'in' },
  system: { out: 'out' },
  note: {},
  set: { out: 'out' },
  output: { in: 'in' },
  summary: { out: 'context' },
  image: { out: 'out' },
  file: { out: 'out' },
  // A folder can be read from and written into, so it has both directions. The
  // handle it shows depends on what it is connected to, and the node says which.
  folder: { out: 'out', in: 'in' },
  // The Brain reads with `in` and writes with `out`. It deliberately has no
  // context handle: it is not a source of text for a prompt.
  brain: { out: 'out', in: 'in' },
  /*
   * Un gruppo **non ha maniglie**, e non per dimenticanza.
   *
   * E' il modo che ha di garantire «solo visivo»: una linea si puo' tracciare solo
   * partendo da una maniglia, quindi un nodo senza maniglie non puo' entrare in nessuna
   * relazione — non come contesto, non come risposta, non come aggregazione. Non e'
   * che il collegamento venga rifiutato dopo: non esiste proprio il modo di formularlo.
   *
   * Il contrario sarebbe una lista di regole da ricordare ovunque (`graph.ts`,
   * `assemble.ts`, la ricerca, i connettori): ognuna un posto in cui dimenticarsi il
   * gruppo e accorgersi solo quando il gruppo finisce dentro una richiesta.
   */
  group: {},
} as const

export interface GenerationParams {
  temperature: number | null
  topP: number | null
  maxTokens: number | null
  stop: string[] | null
}

export const DEFAULT_PARAMS: GenerationParams = {
  temperature: null,
  topP: null,
  maxTokens: null,
  stop: null,
}

/**
 * Shared by every node kind. Not an interface extension on its own: it documents
 * the fields NodeShell relies on, and gives them a real type instead of the
 * `unknown` that the `Record<string, unknown>` base would produce.
 */
export interface CollapsibleNodeData {
  /**
   * When true the node renders as its header only, so it takes a fraction of the
   * canvas. The state is per node and persisted, like the size.
   */
  collapsed?: boolean
}

export interface PromptNodeData extends Record<string, unknown>, CollapsibleNodeData {
  kind: 'prompt'
  text: string
  params: GenerationParams
  title?: string
  runCount: number
  lastRunAt?: ISOTime
  /**
   * Reasoning models think before answering. When false the run sends
   * `reasoning_effort: 'none'`, which LM Studio honours by skipping the
   * thinking phase. Defaults to true (thinking on).
   */
  thinking?: boolean
  /**
   * Asks for a short answer to spend fewer tokens. It sends a brevity
   * instruction and lowers the output ceiling for this prompt only; the global
   * defaults are untouched. Defaults to false.
   */
  concise?: boolean
}

export type PromptNode = Node<PromptNodeData, 'prompt'>

export type ResponseStatus =
  | 'queued'
  | 'streaming'
  | 'done'
  | 'error'
  | 'aborted'
  | 'interrupted'

export type FinishReason = 'stop' | 'length' | 'content_filter' | 'unknown'

export interface ResponseStats {
  startedAt: ISOTime
  finishedAt?: ISOTime
  firstTokenMs?: number
  durationMs?: number
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  finishReason?: FinishReason
}

export interface ResolvedGenerationParams {
  temperature: number
  topP: number
  maxTokens: number | null
  stop: string[] | null
}

export interface RequestSnapshot {
  model: string
  params: ResolvedGenerationParams
  systemPrompt: string
  messageCount: number
  estPromptTokens: number
}

/**
 * A request message as stored on the response node. Content can be multimodal
 * for the same reason `ChatMessage` can: a run with an image has to stay
 * reproducible from the snapshot, or "Retry same request" would drop the picture.
 */
export interface MessageSnapshot {
  role: 'system' | 'user' | 'assistant'
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string } }
      >
}

export interface ResponseNodeData extends Record<string, unknown>, CollapsibleNodeData {
  kind: 'response'
  text: string
  /** Chain-of-thought emitted by reasoning models; never sent back as context. */
  reasoning?: string
  status: ResponseStatus
  parentPromptId: NodeId
  runIndex: number
  promptSnapshot: string
  requestSnapshot: RequestSnapshot
  messagesSnapshot?: MessageSnapshot[]
  /**
   * Quali note dell'archivio sono arrivate al modello in questa risposta.
   *
   * Facoltativa perche' le risposte vecchie non ce l'hanno, e non perche' sia una
   * informazione facoltativa: una risposta senza note e' una risposta vera, e si distingue
   * da «non lo so» perche' l'assenza del campo vuol dire che la corsa e' avvenuta prima
   * che la traccia esistesse, mentre `{ entries: [] }` vuol dire che le note non c'erano.
   * E' la differenza che rende il campo utile invece che decorativo.
   */
  knowledgeUsed?: KnowledgeTrail
  stats: ResponseStats
  error?: AppError
  title?: string
}

export type ResponseNode = Node<ResponseNodeData, 'response'>

export interface SystemNodeData extends Record<string, unknown>, CollapsibleNodeData {
  kind: 'system'
  text: string
  title?: string
}

export type SystemNode = Node<SystemNodeData, 'system'>

export type NoteColor = 'default' | 'amber' | 'sky' | 'rose'

export interface NoteNodeData extends Record<string, unknown>, CollapsibleNodeData {
  kind: 'note'
  text: string
  color?: NoteColor
}

export type NoteNode = Node<NoteNodeData, 'note'>

export type SetPickStrategy = 'latest-done' | 'all-done'
export type SetFormatStrategy = 'plain' | 'sections' | 'numbered' | 'json' | 'llm-synthesis'

export interface SetNodeData extends Record<string, unknown>, CollapsibleNodeData {
  kind: 'set'
  title: string
  memberIds: NodeId[]
  pick: SetPickStrategy
  format: SetFormatStrategy
  includePromptText: boolean
  synthesis?: {
    text: string
    status: ResponseStatus
    stats?: ResponseStats
    error?: AppError
  }
  color: string
}

export type SetNode = Node<SetNodeData, 'set'>

export interface OutputNodeData extends Record<string, unknown>, CollapsibleNodeData {
  kind: 'output'
  text: string
  title?: string
  /**
   * Answers aggregated into this output. The node is the single visible
   * result of grouping several responses: the group is drawn as a frame
   * around these members, and the aggregated text is its `text`.
   */
  sourceNodeIds?: NodeId[]
  format?: SetFormatStrategy
  includePromptText?: boolean
  synthesis?: {
    text: string
    status: ResponseStatus
    stats?: ResponseStats
    error?: AppError
  }
}

export type OutputNode = Node<OutputNodeData, 'output'>

export interface SummaryNodeData extends Record<string, unknown>, CollapsibleNodeData {
  kind: 'summary'
  text: string
  status: ResponseStatus
  instructions?: string
  coveredNodeIds: NodeId[]
  coveredMessageCount: number
  tokensBefore: number
  tokensAfter: number
  coverageHash: string
  requestSnapshot: RequestSnapshot
  messagesSnapshot?: MessageSnapshot[]
  stats: ResponseStats
  error?: AppError
  title?: string
}

export type SummaryNode = Node<SummaryNodeData, 'summary'>

/**
 * An image or a video dropped on the canvas.
 *
 * The bytes live in the document as a data URL. That is a deliberate trade: it
 * keeps the node inside the same JSON shape as everything else, so export,
 * import, copy, paste, undo and the repository all work with no extra code. The
 * price is document size, which is why `logic/media.ts` caps and downsizes on
 * the way in instead of storing whatever the user dropped.
 *
 * A video keeps both the file (so the node can play it) and a `posterSrc`
 * data URL, because no chat model accepts a video: the frame is what actually
 * gets sent, and the node says so rather than implying the model saw the clip.
 */
export interface ImageNodeData extends Record<string, unknown>, CollapsibleNodeData {
  kind: 'image'
  /** Original file name, shown in the header and used as the default title. */
  name: string
  /** MIME type as reported by the file, used to pick the viewer. */
  mediaType: string
  /** True for a video, whose poster frame is what reaches the model. */
  isVideo: boolean
  /** Data URL of the image, or of the video file itself. */
  src: string
  /** Data URL of the representative frame, for videos. */
  posterSrc?: string
  /** Intrinsic size of the image, or of the poster frame for a video. */
  width: number
  height: number
  sizeBytes: number
  /**
   * A question written on the image node itself, from before the prompt button.
   *
   * **Deprecato, ma ancora letto.** La domanda ora si scrive in un nodo Prompt
   * collegato all'immagine — il bottone «Ask» lo crea e lo collega — e non in un
   * campo sul nodo immagine. Il campo resta perche' un documento gia' salvato puo
   * avere una domanda scritta qui, e buttarla via silenziosamente cambierebbe
   * quello che il modello riceve senza dire niente: la risposta a una domanda che
   * l'utente aveva scritto e che ora non c'e' piu' da nessuna parte.
   *
   * Quindi la lettura resta in `logic/assemble.ts` e il campo resta visibile nel
   * nodo **solo se esiste gia'**, perche' una domanda che non si vede e non si puo'
   * cancellare e' peggio di una che non c'e'. Non se ne propongono di nuove.
   */
  caption?: string
  title?: string
}

export type ImageNode = Node<ImageNodeData, 'image'>

/**
 * A text file the model can read.
 *
 * The text is copied into the document, for the same reason images are: one JSON
 * shape means export, import, copy, paste, undo and the repository all work with
 * no extra machinery. `truncated` is stored rather than recomputed so the node can
 * keep telling the truth after a reload, instead of quietly sending half a file.
 */
export interface FileNodeData extends Record<string, unknown>, CollapsibleNodeData {
  kind: 'file'
  /** File name including the extension, shown in the header. */
  name: string
  /** What sort of text it is, only used for the label: text, code, data, HTML. */
  format: string
  sizeBytes: number
  /** The text that will be sent, already capped by `MAX_TEXT_CHARS`. */
  text: string
  truncated: boolean
  /** Set when the file could not be read; the node then explains why. */
  error?: string
  title?: string
}

export type FileNode = Node<FileNodeData, 'file'>

/**
 * A folder of text files, read through the directory picker or a drop.
 *
 * A browser cannot be given a path, so this is a **copy** taken at one moment, not
 * a live link: editing the folder on disk does not change the node. The node says
 * so, because a node that looked live and was not would be worse than one that
 * never could.
 *
 * `refused` lists the files that were skipped and why. A silently smaller context
 * would leave the user believing the model had read everything.
 */
export interface FolderNodeData extends Record<string, unknown>, CollapsibleNodeData {
  kind: 'folder'
  /** Folder name, taken from the picker. */
  name: string
  fileCount: number
  totalBytes: number
  /** The text that will be sent, already capped. */
  text: string
  /** True when files were left out for size or count. */
  truncated: boolean
  refused: Array<{ name: string; reason: string }>
  error?: string
  title?: string
}

export type FolderNode = Node<FolderNodeData, 'folder'>

/**
 * What to do when the output file already exists.
 *
 * This is the user's decision, made in the node, because it is the only thing
 * between a second run and a folder full of overwritten work.
 */
export type BrainOverwrite = 'rename' | 'overwrite' | 'skip'

export interface BrainFileLog {
  path: string
  status: 'pending' | 'written' | 'renamed' | 'skipped' | 'failed' | 'refused'
  writtenAs?: string
  bytes?: number
  tokens?: number
  reason?: string
  durationMs?: number
}

export interface BrainRunState {
  status: 'idle' | 'running' | 'done' | 'stopped' | 'failed'
  total: number
  done: number
  log: BrainFileLog[]
  startedAt?: number
  finishedAt?: number
  /**
   * What each written file replaced, so a run can be taken back. The document's
   * undo restores nodes and cannot restore a file on disk; this is the copy that
   * makes that possible.
   */
  undo: Array<{ path: string; existed: boolean; previousText: string | null; previousSize: number | null }>
  message?: string
}

/**
 * A node that works through the files of one folder and writes the results into
 * another.
 *
 * It is not an agent and does not pretend to be one. The model is called once per
 * file with the instruction and that file, and answers with the new contents; it
 * never chooses a tool, never sees the folder, and never decides what happens
 * next. That is a contract a local model can keep, and it means a bad answer can
 * only ever cost one file.
 *
 * Two folders are connected to it, and **only those two can ever be touched**. A
 * `FileSystemDirectoryHandle` cannot reach outside the directory the user picked,
 * and that is the wall this feature stands behind.
 */
export interface BrainNodeData extends Record<string, unknown>, CollapsibleNodeData {
  kind: 'brain'
  /** What to do to each file. This is the instruction, not a title. */
  instruction: string
  /** Empty means the model chosen in the top bar. */
  model: string
  onExisting: BrainOverwrite
  run: BrainRunState
  /** Path of the folder to read from, for display and for the export. */
  inputPath?: string
  /** Path of the folder to write into, for display and for the export. */
  outputPath?: string
  error?: string
  title?: string
}

export type BrainNode = Node<BrainNodeData, 'brain'>

/**
 * Un nodo che prende dall'archivio e da' a un prompt.
 *
 * Esiste perche' il recupero automatico sceglie le note **per somiglianza** con la domanda, e
 * la somiglianza non sa cosa cercare l'utente. «Parlami dei listini» trova le note che
 * parlano di listini; «mandami tutto quello che ho scritto su questo trimestre» non trova
 * niente, perche' la domanda non nomina nessuna parola delle note. Questo nodo e' la risposta
 * a quel caso: si sceglie **un punto di contesto**, si sceglie se prendere anche le note che
 * ci pendono, e il prompt riceve esattamente quello.
 *
 * Non duplica niente e non copia niente dentro l'archivio: tiene **degli id**, non dei testi.
 * E' la differenza che conta, perche' un id continua a valere mentre la nota viene rinominata
 * o riscritta, mentre un testo copiato nel nodo diventa una seconda copia che invecchia da
 * sola e su cui nessuno avvisa quando non somiglia piu' a quella vera.
 */
export interface KnowledgeNodeData extends Record<string, unknown>, CollapsibleNodeData {
  kind: 'knowledge'
  /**
   * Il punto di contesto da cui prendere, o `null` per non prendere niente.
   *
   * `null` e' uno stato **previsto**, non un nodo vuoto: senza un centro scelto il nodo non
   * invia niente e lo dice. Meglio un nodo che dice «scegli un punto di contesto» che uno
   * che finge di funzionare e poi manda un blocco vuoto che costa token senza dire niente.
   */
  hubId: string | null
/**
   * Prendere quello che **somiglia alla domanda**, invece di un centro scelto.
   *
   * La scelta e' di questo nome, e il motivo e' che questa modalita' e' stata fino a poco fa
   * l'unica — e pero' costava senza chiedere: il recupero girava su **ogni** prompt, anche
   * quelli senza nessun nodo Knowledge, e mandava un blocco, istruzioni comprese, a una
   * domanda che non lo aveva chiesto. Una domanda che non sa niente dell'archivio costa
   * esattamente come una che lo sa, e questa asimmetria e' il motivo per cui il numero e'
   * salito senza che nessuno capisse perche'.
   *
   * Quindi il recupero automatico non e' sparito: e' **diventato una scelta**. Un prompt senza
   * questo nodo non manda niente e non costa nulla; un prompt con il nodo in questa modalita'
   * chiede esplicitamente «quello che c'e' che c'entra con la domanda».
   *
   * Vale solo con `hubId: null`, e non si somma a un centro: sono due modi di scegliere le
   * note, non due scelte. Non si sommano anche perche' due blocchi significa due istruzioni —
   * ed e' la ragione per cui la tendina mette «quello che c'entra» al posto del centro e non
   * come voce aggiuntiva.
   */
  auto: boolean
  /** Prendere anche le note appese a quel centro. */
  includeNotes: boolean
  /**
   * Le note da prendere, per id, quando `includeNotes` e' acceso.
   *
   * Vuoto significa **tutte**, e non "nessuna". La ragione e' che la lista si scrive mentre
   * si sceglie il centro, e le note possono arrivare dopo: uno stato in cui un centro con otto
   * note appena scelto manderebbe blocchi vuoti finche' l'utente non spunta niente. E le
   * note che spariscono sono un caso normale, non un errore: restano nella lista e vengono
   * saltate in lettura.
   */
  entryIds: string[]
  /** Prendere anche le note legate a quelle scelte, cioe' quelle che si parlano. */
  includeLinked: boolean
  title?: string
}

export type KnowledgeNode = Node<KnowledgeNodeData, 'knowledge'>

/**
 * I colori di un gruppo.
 *
 * Sono un elenco **chiuso**, non una stringa libera, per due motivi. Il primo e' che un
 * colore arriva da un file salvato: una stringa libera sarebbe contenuto che il browser
 * mette in uno stile, e il salvataggio dovrebbe fidarsi di averlo sanificato per bene.
 * Il secondo e' che i colori devono stare bene con i sei aspetti e con il tema chiaro:
 * una lista chiusa permette di dichiararli una volta sola e di verificarli nei test,
 * mentre un colore a caso e' cosi' incrociato con una cornice, un'etichetta e due temi
 * che quasi sempre finisce male.
 *
 * `default` non e' un colore: e' «usa l'accento del tema», cosi un gruppo senza colore
 * scelto segue l'aspetto attivo invece di restare legato a un tema solo.
 */
export type GroupColor = 'default' | 'amber' | 'sky' | 'rose' | 'green' | 'violet'

export interface GroupNodeData extends Record<string, unknown>, CollapsibleNodeData {
  kind: 'group'
  /** The name on the frame. Empty means the frame says only how many nodes it holds. */
  title: string
  color: GroupColor
  /**
   * The nodes inside, by id.
   *
   * La lista vive **sul gruppo** e non sui membri, per la stessa ragione di `sourceNodeIds`
   * sull'output: un nodo puo' stare in un solo gruppo, quindi la relazione che conta e'
   * una sola, e metterla sui membri richiederebbe un campo nuovo su ogni tipo di nodo e
   * una regola di conflitto perche' si sa quale vince.
   */
  members: NodeId[]
}
export type GroupNode = Node<GroupNodeData, 'group'>

export type AppNodeData =
  | PromptNodeData
  | ResponseNodeData
  | SystemNodeData
  | NoteNodeData
  | SetNodeData
  | OutputNodeData
  | SummaryNodeData
  | ImageNodeData
  | FileNodeData
  | FolderNodeData
  | BrainNodeData
  | KnowledgeNodeData
  | GroupNodeData

export type AppNode =
  | PromptNode
  | ResponseNode
  | SystemNode
  | NoteNode
  | SetNode
  | OutputNode
  | SummaryNode
  | ImageNode
  | FileNode
  | FolderNode
  | BrainNode
  | KnowledgeNode
  | GroupNode

export type EdgeKind = 'run' | 'context' | 'system' | 'display' | 'image' | 'flow'

export interface AppEdge extends Edge {
  kind: EdgeKind
  createdAt: ISOTime
}

export const EDGE_STYLES: Record<
  EdgeKind,
  { color: string; animated: boolean; label?: string }
> = {
  run: { color: 'var(--edge-run)', animated: false, label: '' },
  context: { color: 'var(--edge-context)', animated: true, label: '' },
  system: { color: 'var(--edge-system)', animated: false, label: '' },
  display: { color: 'var(--accent-2)', animated: false, label: '' },
  image: { color: 'var(--accent)', animated: false, label: '' },
  /** Folder to Brain and Brain to folder: files moving, not text. */
  flow: { color: 'var(--ok)', animated: false, label: '' },
}

export const CONNECTION_MATRIX = {
  'response.context → prompt.context': true,
  'system.out → prompt.system': true,
  'summary.context → prompt.context': true,
  'set.out → prompt.context': true,
  'image.out → prompt.image': true,
  'file.out → prompt.context': true,
  'folder.out → prompt.context': true,
  'folder.out → brain.in': true,
  'brain.out → folder.in': true,
  'set.out → output.in': 'display',
  'response.context → output.in': 'display',
  'summary.context → output.in': 'display',
  'prompt.out → response.in': 'implicit',
} as const

export const DOC_VERSION = 2

export interface WorkspaceViewport {
  x: number
  y: number
  zoom: number
}

export interface WorkspaceDocument {
  docVersion: number
  savedAt: ISOTime
  name: string
  nodes: AppNode[]
  edges: AppEdge[]
  settings: Settings
  viewport: WorkspaceViewport
}

export function createDefaultRequestSnapshot(model = ''): RequestSnapshot {
  return {
    model,
    params: { temperature: 0.7, topP: 1, maxTokens: 1024, stop: null },
    systemPrompt: '',
    messageCount: 0,
    estPromptTokens: 0,
  }
}

export function createEmptyDocument(): WorkspaceDocument {
  return {
    docVersion: DOC_VERSION,
    savedAt: 0,
    name: 'Untitled workspace',
    nodes: [],
    edges: [],
    settings: { ...DEFAULT_SETTINGS, defaults: { ...DEFAULT_SETTINGS.defaults } },
    viewport: { x: 0, y: 0, zoom: 1 },
  }
}

export const EMPTY_DOCUMENT: WorkspaceDocument = createEmptyDocument()
