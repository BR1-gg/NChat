import type {
  AppEdge,
  FileNode,
  FileNodeData,
  ImageNode,
  ImageNodeData,
  AppNode,
  EdgeKind,
  NoteNode,
  NoteNodeData,
  OutputNode,
  GroupNode,
  GroupNodeData,
  OutputNodeData,
  PromptNode,
  PromptNodeData,
  ResponseNode,
  ResponseNodeData,
  SystemNode,
  SetNode,
  SetNodeData,
  SummaryNode,
  SummaryNodeData,
  SystemNodeData,
  AddableNodeType,
  WorkspaceDocument,
} from '../types/document'
import { createDefaultRequestSnapshot, DOC_VERSION } from '../types/document'
import { cloneSettings, DEFAULT_SETTINGS } from '../types/settings'
import { createNode } from '../store/workspaceStore'

let sequence = 0
const nextId = (prefix: string): string => `${prefix}${(sequence += 1).toString().padStart(3, '0')}`

export function prompt(
  text: string,
  id = nextId('p'),
  position = { x: 0, y: 0 },
): PromptNode {
  const data: PromptNodeData = {
    kind: 'prompt',
    text,
    params: { temperature: null, topP: null, maxTokens: null, stop: null },
    runCount: 0,
  }
  return { id, type: 'prompt', position, data }
}

export function response(
  parentPromptId: string,
  text: string,
  options: Partial<ResponseNodeData> = {},
  id = nextId('r'),
): ResponseNode {
  const data: ResponseNodeData = {
    kind: 'response',
    status: 'done',
    text,
    parentPromptId,
    runIndex: 0,
    promptSnapshot: 'snapshot',
    requestSnapshot: createDefaultRequestSnapshot('test-model'),
    stats: { startedAt: 1, finishedAt: 2, durationMs: 1 },
    ...options,
  }
  return { id, type: 'response', position: { x: 500, y: 0 }, data }
}

export function summary(
  text: string,
  overrides: Partial<SummaryNodeData> = {},
  id = nextId('sum'),
): SummaryNode {
  const data: SummaryNodeData = {
    kind: 'summary',
    text,
    status: 'done',
    coveredNodeIds: [],
    coveredMessageCount: 0,
    tokensBefore: 0,
    tokensAfter: 0,
    coverageHash: 'test',
    requestSnapshot: createDefaultRequestSnapshot('test-model'),
    stats: { startedAt: 1, finishedAt: 2, durationMs: 1 },
    ...overrides,
  }
  return { id, type: 'summary', position: { x: 0, y: 0 }, data }
}

export function system(
  text: string,
  id = nextId('s'),
  position = { x: 0, y: 0 },
): SystemNode {
  const data: SystemNodeData = { kind: 'system', text }
  return { id, type: 'system', position, data }
}

/**
 * Il tipo di ritorno e' dichiarato, come in tutte le altre fabbriche: senza di esso
 * `type` si allarga a `string` e il nodo non e' piu' un `AppNode`, quindi ogni
 * funzione che accetta nodi — `handlesOf`, `connectionKind` — rifiuta il valore in
 * TypeScript anche se a runtime e' corretto.
 */
export function note(text: string, id = nextId('n'), position = { x: 0, y: 0 }): NoteNode {
  const data: NoteNodeData = { kind: 'note', text }
  return { id, type: 'note', position, data }
}

export function edge(
  source: AppNode,
  target: AppNode,
  kind: EdgeKind,
  createdAt = 1,
  id = nextId('e'),
): AppEdge {
  const handles = {
    run: { sourceHandle: 'out', targetHandle: 'in' },
    context: { sourceHandle: 'context', targetHandle: 'context' },
    system: { sourceHandle: 'out', targetHandle: 'system' },
    display: { sourceHandle: 'out', targetHandle: 'in' },
    image: { sourceHandle: 'out', targetHandle: 'image' },
    flow: { sourceHandle: 'out', targetHandle: 'in' },
  } as const
  return {
    id,
    source: source.id,
    target: target.id,
    kind,
    createdAt,
    ...handles[kind],
  }
}

/**
 * Un nodo vuoto di un tipo qualsiasi, costruito dalla **stessa** funzione che usa la palette.
 *
 * Esiste perche' un tipo di nodo nuovo deve poter essere provato senza una fabbrica per ogni
 * tipo. Il test che verifica che ogni tipo sopravviva a un salvataggio ha bisogno di un nodo
 * di ogni tipo, e con una fabbrica per tipo il test diventerebbe un elenco di nomi da tenere
 * allineati a mano — che e' esattamente la duplicazione che faceva sparire i tipi nuovi.
 *
 * Il vantaggio di chiamare `createNode` non e' la comodita': e' che questo test **non puo'
 * passare** mentre la creazione di un nodo e' rotta. Se `createNode` sbaglia il tipo, o se un
 * tipo nuovo arriva al registro e non a `createNode`, il test lo vede subito. Una fabbrica
 * propria passerebbe, e difenderebbe un comportamento che l'utente non ha.
 */
export function nodeOfType(kind: AddableNodeType): AppNode {
  return createNode(kind, { x: 0, y: 0 }, undefined)
}

export function document(nodes: AppNode[], edges: AppEdge[]): WorkspaceDocument {
  return {
    docVersion: DOC_VERSION,
    savedAt: 1,
    name: 'Test workspace',
    nodes,
    edges,
    settings: cloneSettings(DEFAULT_SETTINGS),
    viewport: { x: 0, y: 0, zoom: 1 },
  }
}
/**
 * A file node holding text.
 *
 * Esiste perche' il testo di un file e' una delle cose che si cercano, e senza questa
 * fabbrica i test della ricerca avrebbero dovuto costruire il nodo a mano ogni volta,
 * sbagliando i campi obbligatori. Il tipo e' dichiarato come in `note()`: senza, `type`
 * si allarga a `string` e il nodo smette di essere un `AppNode`.
 */
export function file(
  name: string,
  overrides: Partial<FileNodeData> = {},
  id = nextId('file'),
): FileNode {
  const data: FileNodeData = {
    kind: 'file',
    name,
    format: 'markdown',
    sizeBytes: 128,
    text: '',
    truncated: false,
    ...overrides,
  }
  return { id, type: 'file', position: { x: 0, y: 0 }, data }
}

/** An image node carrying a tiny inline data URL, enough to be a real payload. */
export function image(
  name: string,
  overrides: Partial<ImageNodeData> = {},
  id = nextId('img'),
): ImageNode {
  const data: ImageNodeData = {
    kind: 'image',
    name,
    mediaType: 'image/png',
    isVideo: false,
    src: 'data:image/png;base64,iVBORw0KGgo=',
    width: 640,
    height: 480,
    sizeBytes: 2048,
    ...overrides,
  }
  return { id, type: 'image', position: { x: 0, y: 0 }, data }
}

/**
 * A group: the frame around the members, carrying their aggregated text. A group
 * with no `sourceNodeIds` is an output node with text of its own.
 */
export function output(
  sourceNodeIds: string[],
  overrides: Partial<OutputNodeData> = {},
  id = nextId('out'),
): OutputNode {
  const data: OutputNodeData = {
    kind: 'output',
    text: '',
    title: 'Group',
    sourceNodeIds,
    format: 'plain',
    includePromptText: false,
    ...overrides,
  }
  return { id, type: 'output', position: { x: 0, y: 0 }, data }
}

/** A Set node whose members are, by default, generated answer nodes. */
export function set(
  title: string,
  memberIds: string[],
  overrides: Partial<SetNodeData> = {},
  id = nextId('set'),
): SetNode {
  const data: SetNodeData = {
    kind: 'set',
    title,
    memberIds,
    pick: 'latest-done',
    format: 'sections',
    includePromptText: false,
    color: '#8b5cf6',
    ...overrides,
  }
  return { id, type: 'set', position: { x: 0, y: 0 }, data }
}

/**
 * An output node that owns a group of answers: this is what grouping a
 * selection produces, with no intermediate node in between.
 */
export function groupedOutput(
  title: string,
  sourceNodeIds: string[],
  overrides: Partial<OutputNodeData> = {},
  id = nextId('out'),
): OutputNode {
  const data: OutputNodeData = {
    kind: 'output',
    text: '',
    title,
    sourceNodeIds,
    format: 'sections',
    includePromptText: false,
    ...overrides,
  }
  return { id, type: 'output', position: { x: 0, y: 0 }, data }
}

/**
 * A visual group: a frame that arranges nodes and does nothing else.
 *
 * Built here with members of **any** type, because the whole point is that this group is
 * not tied to one kind of node the way the logical output is. The colour defaults to
 * `default`, which means "whatever the theme says" — not a colour, so a test that forgets
 * to say it does not accidentally pin one.
 */
export function group(
  title: string,
  members: string[],
  overrides: Partial<GroupNodeData> = {},
  id = nextId('grp'),
): GroupNode {
  const data: GroupNodeData = {
    kind: 'group',
    title,
    color: 'default',
    members,
    ...overrides,
  }
  return { id, type: 'group', position: { x: 0, y: 0 }, data }
}