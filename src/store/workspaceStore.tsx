import type {
  Connection,
  EdgeChange,
  NodeChange,
  XYPosition,
} from '@xyflow/react'
import { expandGroupMove, frameMatches, groupMemberIds } from '../logic/groups'
import { History } from '../logic/history'
import { nanoid } from 'nanoid'
import { createContext, useContext, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { connectionKind, isAppEdge, nextRunIndex, siblingsOf } from '../logic/graph'
import { placeResponseNode } from '../logic/layout'
import type {
  AddableNodeType,
  AppEdge,
  AppNode,
  BrainNodeData,
  AppNodeData,
  OutputNodeData,
  RequestSnapshot,
  ResponseNodeData,
  SetNodeData,
  SummaryNodeData,
  WorkspaceDocument,
  WorkspaceViewport,
} from '../types/document'
import {
  createDefaultRequestSnapshot,
  createEmptyDocument,
  type NodeId,
  type NodePosition,
} from '../types/document'
import type { AppError } from '../types/errors'
import {
  cloneAppSettings,
  cloneSettings,
  mergeSettings,
  splitSettings,
  type AppSettings,
  type Settings,
  type WorkspaceSettings,
} from '../types/settings'

export type WorkspaceStoreApi = StoreApi<WorkspaceState>

/**
 * What `addNode` will build.
 *
 * Sono i tipi **del catalogo** piu' il gruppo, che non e' nel catalogo e nasce solo
 * raccogliendo nodi gia' presenti.
 *
 * La distinzione e' voluta e sta qui, non dentro `createNode`: `AddableNodeType` vuol
 * dire «quello che trovi nel catalogo», e il gruppo non e' una cosa che si sceglie dal
 * catalogo — e' un gesto che si fa su quello che c'e' gia'. Percio' il catalogo resta
 * chiuso (e `registry.test.ts` lo verifica) mentre la fabbrica accetta anche il gruppo.
 * Senza questa separazione, o il gruppo comparirebbe nel catalogo — dove non ha senso —
 * o non si potrebbe creare: il tipo direbbe la cosa sbagliata perche' sta rispondendo a
 * due domande diverse.
 */
export type CreatableNodeType = AddableNodeType | 'group'

export interface SettingsPatch extends Partial<Omit<Settings, 'defaults'>> {
  defaults?: Partial<Settings['defaults']>
}

export interface WorkspaceState {
  workspaceId: string
  revision: number
  docVersion: number
  name: string
  nodes: AppNode[]
  edges: AppEdge[]
  /** Merged live view; v2 persistence splits these values. */
  settings: Settings
  appSettings: AppSettings
  workspaceSettings: WorkspaceSettings
  viewport: WorkspaceViewport
  dirty: boolean

  /**
   * Undo and redo for the document, not for a text field. Inside a textarea
   * Ctrl+Z is the browser's own text undo; this covers moving, creating,
   * deleting, connecting, resizing and grouping. The depths are 0 or 1 and live
   * in the state only so the toolbar re-renders when the buttons become usable.
   */
  undoDepth: number
  redoDepth: number
  commit: (
    label: string,
    key: string,
    mutate: (state: WorkspaceState) => void,
    options?: { record?: boolean; before?: { nodes: AppNode[]; edges: AppEdge[] } },
  ) => void
  /** Returns the label of the step it undid, or null when there was nothing. */
  undo: () => string | null
  redo: () => string | null
  undoLabel: () => string | null

  addNode: (
    type: CreatableNodeType,
    position: XYPosition,
    seed?: Record<string, unknown>,
  ) => NodeId
  addNodes: (nodes: AppNode[], edges: AppEdge[]) => void
  updateNodeData: (id: NodeId, patch: Partial<AppNodeData>) => void
  removeNodes: (ids: NodeId[]) => void
  applyNodeChanges: (changes: NodeChange<AppNode>[]) => void
  applyEdgeChanges: (changes: EdgeChange<AppEdge>[]) => void
  setNodePositions: (positions: Map<NodeId, XYPosition>) => void
  setNodeSize: (id: NodeId, width: number | undefined, height: number | undefined) => void
  setNodeSelected: (id: NodeId, selected: boolean) => void
  selectOnlyNode: (id: NodeId | null) => void
  /**
   * Leaves exactly these nodes selected, and nothing else.
   *
   * Serve alla paste. Con `setNodeSelected(id, true)` su quello appena incollato, la
   * selezione **cresce**: dopo un copia-incolla resterebbero selezionati sia
   * l'originale sia la copia, e al primo trascinamento si muoverebbero **entrambi** —
   * quello che l'utente voleva spostare e quello che aveva lasciato dove stava. La
   * copia sembrerebbe essersi mossa da sola, e in un grafo la cosa peggiore che possa
   * succedere e' che i nodi si spostino senza che nessuno li abbia spostati.
   */
  selectOnlyNodes: (ids: NodeId[]) => void
  addConnection: (connection: Connection) => AppEdge | AppError
  removeEdge: (id: string) => void
  createResponseNode: (promptId: NodeId, snapshot?: RequestSnapshot) => NodeId
  patchResponse: (id: NodeId, patch: Partial<ResponseNodeData>) => void
  patchSummary: (id: NodeId, patch: Partial<SummaryNodeData>) => void
  createSummaryNode: (position: XYPosition, data: SummaryNodeData) => NodeId
  patchSet: (id: NodeId, patch: Partial<SetNodeData>) => void
  patchOutput: (id: NodeId, patch: Partial<OutputNodeData>) => void
  /** Writes a Brain's own state. Kept out of `updateNodeData` so a node field and
   *  a run result can never be confused for one another. */
  patchBrain: (id: NodeId, patch: Partial<BrainNodeData>) => void
  /**
   * Moves a group's frame onto the answers it encloses. Called by the canvas
   * after React Flow has measured the nodes; the guard inside keeps it from
   * writing when nothing moved, which is what would otherwise cause a save loop.
   */
  setGroupFrame: (id: NodeId, frame: { x: number; y: number; width: number; height: number }) => void
  duplicateNode: (id: NodeId, atPosition?: NodePosition) => NodeId | null
  setSettings: (patch: SettingsPatch) => void
  hydrateAppSettings: (settings: AppSettings) => void
  setName: (name: string) => void
  setViewport: (viewport: WorkspaceViewport) => void
  replaceDocument: (document: WorkspaceDocument) => void
  resetDocument: (document?: WorkspaceDocument) => void
  setRevision: (revision: number) => void
  markSaved: (revision?: number) => void
}

let activeStoreGetter: (() => WorkspaceStoreApi) | null = null
let fallbackStore: WorkspaceStoreApi | null = null

export function setActiveWorkspaceStoreGetter(getter: () => WorkspaceStoreApi): void {
  activeStoreGetter = getter
}

export function getActiveWorkspaceStore(): WorkspaceStoreApi {
  if (activeStoreGetter) return activeStoreGetter()
  if (fallbackStore) return fallbackStore
  throw new Error('Workspace registry has not been initialized')
}

function freshDocument(): WorkspaceDocument {
  return createEmptyDocument()
}

/**
 * Builds one new node of a type, empty.
 *
 * Esportata perche' e' **l'unico** posto in cui si decide che aspetto ha un nodo appena
 * creato, e un secondo posto che fa la stessa cosa e' un posto che puo' dimenticarsi un
 * tipo. `nodeTypesRoundtrip.test.ts` la chiama per ogni tipo del catalogo: se questa funzione
 * sbaglia un tipo — o se un tipo nuovo viene aggiunto al registro e non qui — il test lo vede
 * subito, invece di lasciare che il nodo finisca con l'aspetto di un altro.
 */
export function createNode(
  type: CreatableNodeType,
  position: XYPosition,
  seed: Record<string, unknown> | undefined,
): AppNode {
  const id = nanoid(12)
  const shared = { id, position: { ...position } }
  if (type === 'prompt') {
    return {
      ...shared,
      type: 'prompt',
      data: {
        kind: 'prompt',
        text: '',
        params: { temperature: null, topP: null, maxTokens: null, stop: null },
        runCount: 0,
        ...seed,
      },
    }
  }
  if (type === 'system') {
    return { ...shared, type: 'system', data: { kind: 'system', text: '', ...seed } }
  }
  if (type === 'output') {
    return {
      ...shared,
      type: 'output',
      data: { kind: 'output', text: '', ...seed },
    }
  }
  if (type === 'group') {
    /*
     * Il nome e il colore hanno un valore qui e non sono obbligatori in alto: una
     * cornice senza nome mostra quanti nodi contiene, che e' una descrizione
     * sufficiente, e un colore non scelto segue il tema attivo invece di fissare un
     * colore a caso.
     */
    return {
      ...shared,
      type: 'group',
      data: { kind: 'group', title: '', color: 'default', members: [], ...seed },
    }
  }
  if (type === 'image') {
    // Nodo vuoto: un'immagine si crea dropping un file, non dalla palette. La
    // palette lo offre comunque, e il nodo risultate dice cosa manca, invece di
    // fingere di avere un'immagine.
    return {
      ...shared,
      type: 'image',
      data: {
        kind: 'image',
        name: '',
        mediaType: '',
        isVideo: false,
        src: '',
        width: 0,
        height: 0,
        sizeBytes: 0,
        ...seed,
      },
    }
  }
  if (type === 'file') {
    // Nodo vuoto come l'immagine: il file si sceglie dal nodo, non dalla palette.
    return {
      ...shared,
      type: 'file',
      data: {
        kind: 'file',
        name: '',
        format: 'text',
        sizeBytes: 0,
        text: '',
        truncated: false,
        ...seed,
      },
    }
  }
  if (type === 'folder') {
    return {
      ...shared,
      type: 'folder',
      data: {
        kind: 'folder',
        name: '',
        fileCount: 0,
        totalBytes: 0,
        text: '',
        truncated: false,
        refused: [],
        ...seed,
      },
    }
  }
  if (type === 'brain') {
    return {
      ...shared,
      type: 'brain',
      data: {
        kind: 'brain',
        instruction: '',
        model: '',
        onExisting: 'rename',
        run: { status: 'idle', total: 0, done: 0, log: [], undo: [] },
        ...seed,
      },
    }
  }
  if (type === 'knowledge') {
    /*
     * Il ramo va qui, e non in fondo alla catena.
     *
     * La catena di `if` finisce con un ripiego che crea una **nota**, e quel ripiego e' la
     * trappola di questo file: un tipo nuovo che non ha un ramo suo qui non fallisce, non
     * da' un errore e non si vede in console — crea semplicemente un nodo di un altro tipo.
     * Il sintomo e' che il pulsante della palette funziona, il nodo compare, e non e' quello
     * che e' stato premuto. Per un tipo che punta all'archivio vuol dire un nodo che non
     * sceglie niente e non manda niente, con la stessa aria di un nodo funzionante.
     *
     * I valori di partenza sono quelli del tipo **gia' salvato**, non quelli minimi: cosi' un
     * nodo creato e subito salvato riapre identico a come e' stato lasciato.
     */
    return {
      ...shared,
      type: 'knowledge',
      data: {
        kind: 'knowledge',
        auto: false,
        hubId: null,
        includeNotes: false,
        entryIds: [],
        includeLinked: false,
        ...seed,
      },
    }
  }
  return {
    ...shared,
    type: 'note',
    data: { kind: 'note', text: '', color: 'default', ...seed },
  }
}

export function workspaceDocumentFromState(state: WorkspaceState): WorkspaceDocument {
  return {
    docVersion: state.docVersion,
    savedAt: 0,
    name: state.name,
    nodes: state.nodes,
    edges: state.edges,
    settings: state.settings,
    viewport: state.viewport,
  }
}

export function createWorkspaceStore(
  workspaceId: string,
  document: WorkspaceDocument,
  appSettings = splitSettings(document.settings).app,
  revision = 0,
): WorkspaceStoreApi {
  const split = splitSettings(document.settings)
  let store!: WorkspaceStoreApi
  const history = new History<AppNode[], AppEdge[]>()
  /**
   * Where the current drag or resize started.
   *
   * A gesture reports one change per mousemove and only the last one says it is
   * over. Recording that last one would make undo rewind a single frame of the
   * drag instead of the whole movement, so the state from before the first
   * mousemove is kept here until the gesture ends.
   *
   * The node id is part of the record for a reason that cost a test to find: a
   * drag can end without ever saying so, because the pointer was released outside
   * the window. Without the id, the stale snapshot would still be there when the
   * *next* drag started, and one undo would jump to a state from before both.
   */
  let gestureStart: { nodes: AppNode[]; edges: AppEdge[]; id: NodeId | null } | null = null

  store = createStore<WorkspaceState>()(
    immer((set, get) => ({
      /**
       * Runs a mutation and, unless it is one of the operations that must not be
       * undoable, remembers the state it started from.
       *
       * The "did it change?" test is an identity comparison on the two arrays:
       * Immer hands back the same array when a producer touched nothing, so
       * recording unconditionally would fill the history with steps that undo
       * seems to swallow.
       */
      commit(
        label: string,
        key: string,
        mutate: (state: WorkspaceState) => void,
        options?: { record?: boolean; before?: { nodes: AppNode[]; edges: AppEdge[] } },
      ) {
        const before = options?.before ?? { nodes: get().nodes, edges: get().edges }
        const record = options?.record ?? true
        const undoDepth = get().undoDepth
        const redoDepth = get().redoDepth
        set(mutate)
        if (!record) return
        // Any recorded step ends the current gesture, so an abandoned drag can
        // never leave a snapshot behind for the next one to pick up.
        gestureStart = null
        history.record(before, { nodes: get().nodes, edges: get().edges }, label, key)
        const nextUndo = history.canUndo ? 1 : 0
        const nextRedo = history.canRedo ? 1 : 0
        if (nextUndo !== undoDepth || nextRedo !== redoDepth) {
          set((state) => {
            state.undoDepth = nextUndo
            state.redoDepth = nextRedo
          })
        }
      },

      undo() {
        const current = { nodes: get().nodes, edges: get().edges }
        const entry = history.undo(current)
        if (!entry) return null
        set((state) => {
          state.nodes = entry.nodes
          state.edges = entry.edges
          state.dirty = true
          state.undoDepth = history.canUndo ? 1 : 0
          state.redoDepth = history.canRedo ? 1 : 0
        })
        return entry.label
      },

      redo() {
        const current = { nodes: get().nodes, edges: get().edges }
        const entry = history.redo(current)
        if (!entry) return null
        set((state) => {
          state.nodes = entry.nodes
          state.edges = entry.edges
          state.dirty = true
          state.undoDepth = history.canUndo ? 1 : 0
          state.redoDepth = history.canRedo ? 1 : 0
        })
        return entry.label
      },

      undoLabel() {
        return history.nextUndoLabel
      },

      undoDepth: 0,
      redoDepth: 0,
      workspaceId,
      revision,
      docVersion: document.docVersion,
      name: document.name,
      nodes: document.nodes,
      edges: document.edges,
      settings: mergeSettings(appSettings, split.workspace),
      appSettings: cloneAppSettings(appSettings),
      workspaceSettings: cloneSettings(document.settings).defaults
        ? {
            defaults: { ...split.workspace.defaults },
            contextTokenWarning: split.workspace.contextTokenWarning,
          }
        : split.workspace,
      viewport: { ...document.viewport },
      dirty: false,

      addNode(type, position, seed) {
        const node = createNode(type, position, seed)
        get().commit(`Added ${type}`, `add:${node.id}`, (state) => {
          state.nodes.push(node)
          for (const existing of state.nodes) existing.selected = false
          node.selected = true
          state.dirty = true
        })
        return node.id
      },

      addNodes(nodes, edges) {
        // One step for a whole paste: undoing it item by item would be absurd.
        get().commit(
          nodes.length > 1 ? `Pasted ${nodes.length} nodes` : 'Pasted a node',
          'paste',
          (state) => {
            const existingIds = new Set(state.nodes.map((node) => node.id))
            const existingEdgeIds = new Set(state.edges.map((edge) => edge.id))
            state.nodes.push(...nodes.filter((node) => !existingIds.has(node.id)))
            state.edges.push(...edges.filter((edge) => !existingEdgeIds.has(edge.id)))
            state.dirty = true
          },
        )
      },

      updateNodeData(id, patch) {
        // Streaming appends to the same text field hundreds of times. Without
        // the time window that would be hundreds of undo steps for one answer.
        get().commit('Edited text', `data:${id}`, (state) => {
          const node = state.nodes.find((candidate) => candidate.id === id)
          if (!node) return
          Object.assign(node.data, patch)
          state.dirty = true
        })
      },

      removeNodes(ids) {
        if (ids.length === 0) return
        const removed = new Set(ids)
        get().commit(
          ids.length > 1 ? `Deleted ${ids.length} nodes` : 'Deleted a node',
          `remove:${[...removed].sort().join(',')}`,
          (state) => {
            state.nodes = state.nodes.filter((node) => !removed.has(node.id))
            state.edges = state.edges.filter(
              (edge) => !removed.has(edge.source) && !removed.has(edge.target),
            )
            for (const node of state.nodes) {
              if (node.data.kind === 'set') {
                node.data.memberIds = node.data.memberIds.filter((id) => !removed.has(id))
              } else if (node.data.kind === 'output' && node.data.sourceNodeIds) {
                node.data.sourceNodeIds = node.data.sourceNodeIds.filter((id) => !removed.has(id))
              } else if (node.data.kind === 'group' && node.data.members) {
                /*
                 * Cancellare un nodo che sta dentro un gruppo **scioglie** quel membro,
                 * non lo lascia li'. La cornice si riadatta da sola al resto: e' quello
                 * che succede con `computeGroupFrame`, che va avanti anche con un solo
                 * membro e non esiste piu' quando non ne restano.
                 *
                 * Senza questo, il gruppo terrebbe un id che non esiste piu' e ogni
                 * operazione che conta i suoi membri — il nome sulla cornice, lo
                 * spostamento, il salvataggio — conterrebbe un nodo fantasma.
                 */
                node.data.members = node.data.members.filter((id) => !removed.has(id))
              }
            }
            state.dirty = true
          },
        )
      },

      applyNodeChanges(changes) {
        const removeIds = new Set<NodeId>()
        let structuralChange = false
        // A drag fires a change per mousemove. Recording each one would fill the
        // history with noise, and recording only the last would make undo rewind
        // a single frame of the drag. So the state from before the first mousemove
        // is held in `gestureStart` and written once, when the gesture ends.
        const endsGesture = changes.some(
          (change) =>
            (change.type === 'position' && change.dragging === false) ||
            (change.type === 'dimensions' && change.resizing === false),
        )
        const midDrag = changes.some(
          (change) =>
            (change.type === 'position' && change.dragging === true) ||
            (change.type === 'dimensions' && change.resizing === true),
        )
        const record =
          endsGesture ||
          changes.some(
            (change) => change.type === 'add' || change.type === 'remove' || change.type === 'replace',
          )
        const draggingId = changes.find(
          (change) => change.type === 'position' || change.type === 'dimensions',
        )?.id
        // A different node means the previous gesture never reported its end.
        if (gestureStart && gestureStart.id !== draggingId) gestureStart = null
        if (!gestureStart) {
          gestureStart = { nodes: get().nodes, edges: get().edges, id: draggingId ?? null }
        }

        get().commit(
          'Moved or resized',
          'drag',
          (state) => {
            for (const change of changes) {
              if (change.type === 'add') {
                state.nodes.splice(change.index ?? state.nodes.length, 0, change.item as AppNode)
                structuralChange = true
                continue
              }
              const index = state.nodes.findIndex((node) => node.id === change.id)
              if (index < 0) continue
              const node = state.nodes[index]
              if (!node) continue
              if (change.type === 'position') {
                const next = change.positionAbsolute ?? change.position
                if (next) {
                  // Dragging a group moves the answers inside it, never the frame.
                  const groupMoves = expandGroupMove(state.nodes, change.id, next)
                  if (groupMoves) {
                    for (const [memberId, position] of groupMoves) {
                      const member = state.nodes.find((candidate) => candidate.id === memberId)
                      if (member) member.position = position
                    }
                  }
                  // The frame follows the pointer for the whole drag. Without
                  // this the delta is measured against a frame that has not moved
                  // yet, so every mousemove re-applies the entire offset and the
                  // group flies away. The canvas snaps it back onto the answers
                  // as soon as the drag ends.
                  node.position = { ...next }
                  structuralChange = true
                }
              } else if (change.type === 'dimensions') {
                if (change.dimensions) node.measured = { ...change.dimensions }
                if (change.setAttributes) {
                  if (change.setAttributes === true || change.setAttributes === 'width') {
                    if (change.dimensions?.width) node.width = change.dimensions.width
                  }
                  if (change.setAttributes === true || change.setAttributes === 'height') {
                    if (change.dimensions?.height) node.height = change.dimensions.height
                  }
                }
                if (change.resizing === false) structuralChange = true
              } else if (change.type === 'select') {
                node.selected = change.selected
              } else if (change.type === 'remove') {
                removeIds.add(change.id)
              } else if (change.type === 'replace') {
                state.nodes[index] = change.item as AppNode
                structuralChange = true
              }
            }
            if (removeIds.size > 0) {
              state.nodes = state.nodes.filter((node) => !removeIds.has(node.id))
              state.edges = state.edges.filter(
                (edge) => !removeIds.has(edge.source) && !removeIds.has(edge.target),
              )
              structuralChange = true
            }
            if (structuralChange) state.dirty = true
          },
          {
            record,
            before: gestureStart
              ? { nodes: gestureStart.nodes, edges: gestureStart.edges }
              : undefined,
          },
        )
        // The gesture is over, or there was never one: the next change starts a
        // fresh snapshot.
        if (record || !midDrag) gestureStart = null
      },

      applyEdgeChanges(changes) {
        let structuralChange = false
        get().commit('Changed a connection', 'edges', (state) => {
          for (const change of changes) {
            if (change.type === 'add') {
              state.edges.push(change.item as AppEdge)
              structuralChange = true
            } else if (change.type === 'remove') {
              const index = state.edges.findIndex((edge) => edge.id === change.id)
              if (index >= 0) {
                state.edges.splice(index, 1)
                structuralChange = true
              }
            } else if (change.type === 'replace') {
              const index = state.edges.findIndex((edge) => edge.id === change.id)
              if (index >= 0) {
                state.edges[index] = change.item as AppEdge
                structuralChange = true
              }
            } else {
              const edge = state.edges.find((candidate) => candidate.id === change.id)
              if (edge) edge.selected = change.selected
            }
          }
          if (structuralChange) state.dirty = true
        })
      },

      setNodePositions(positions) {
        if (positions.size === 0) return
        // Arrow-key nudges arrive one per keypress, so the shared 'drag' key
        // folds a held arrow key into a single step.
        get().commit('Moved a node', 'drag', (state) => {
          for (const [id, position] of positions) {
            const node = state.nodes.find((candidate) => candidate.id === id)
            if (!node) continue
            // The arrow-key nudge goes through here too, so a group moves as a
            // whole when it is selected rather than only on a mouse drag.
            const groupMoves = expandGroupMove(state.nodes, id, position)
            if (groupMoves) {
              for (const [memberId, memberPosition] of groupMoves) {
                const member = state.nodes.find((candidate) => candidate.id === memberId)
                if (member) member.position = memberPosition
              }
              continue
            }
            node.position = { ...position }
          }
          state.dirty = true
        })
      },

      setNodeSize(id, width, height) {
        get().commit('Resized a node', `size:${id}`, (state) => {
          const node = state.nodes.find((candidate) => candidate.id === id)
          if (!node) return
          if (width === undefined) delete node.width
          else node.width = width
          if (height === undefined) delete node.height
          else node.height = height
          state.dirty = true
        })
      },

      setNodeSelected(id, selected) {
        set((state) => {
          const node = state.nodes.find((candidate) => candidate.id === id)
          if (node) node.selected = selected
        })
      },

      selectOnlyNode(id) {
        set((state) => {
          for (const node of state.nodes) node.selected = node.id === id
        })
      },

      selectOnlyNodes(ids) {
        // Un Set, non un `includes` per nodo: con molte decine di nodi e un paio di
        // file incollati la differenza non si sente, ma `selectOnlyNodes` viene anche
        // da un incolla di un'intera selezione e li' il confronto lineare si sente.
        const wanted = new Set(ids)
        set((state) => {
          for (const node of state.nodes) node.selected = wanted.has(node.id)
        })
      },

      addConnection(connection) {
        if (!connection.source || !connection.target) {
          return { kind: 'INVALID_CONNECTION', message: 'Choose two nodes to connect.' }
        }
        const document = workspaceDocumentFromState(store.getState())
        const kind = connectionKind(document, {
          sourceId: connection.source,
          sourceHandle: connection.sourceHandle ?? null,
          targetId: connection.target,
          targetHandle: connection.targetHandle ?? null,
        })
        if (!isAppEdge(kind)) return kind
        const duplicate = document.edges.find(
          (edge) =>
            edge.kind === kind &&
            edge.source === connection.source &&
            edge.target === connection.target,
        )
        if (duplicate) return duplicate
        const edge: AppEdge = {
          id: nanoid(12),
          source: connection.source,
          target: connection.target,
          sourceHandle: connection.sourceHandle,
          targetHandle: connection.targetHandle,
          kind,
          createdAt: Date.now(),
        }
        get().commit('Connected two nodes', `connect:${edge.id}`, (state) => {
          if (kind === 'system' || kind === 'display') {
            state.edges = state.edges.filter(
              (candidate) =>
                !(
                  candidate.kind === kind &&
                  candidate.target === edge.target &&
                  candidate.targetHandle === edge.targetHandle
                ),
            )
          }
          state.edges.push(edge)
          state.dirty = true
        })
        return edge
      },

      removeEdge(id) {
        get().commit('Removed a connection', `disconnect:${id}`, (state) => {
          const index = state.edges.findIndex((edge) => edge.id === id)
          if (index >= 0) {
            state.edges.splice(index, 1)
            state.dirty = true
          }
        })
      },

      createResponseNode(promptId, snapshot = createDefaultRequestSnapshot()) {
        const document = workspaceDocumentFromState(store.getState())
        const prompt = document.nodes.find(
          (node) => node.id === promptId && node.data.kind === 'prompt',
        )
        if (!prompt) return ''
        // Title the answer after the question that produced it, so a graph of
        // many responses is readable: a response shows the answer, not the
        // question, so the title is the only place the question survives.
        const promptText =
          prompt.data.kind === 'prompt' && typeof prompt.data.text === 'string'
            ? prompt.data.text
            : ''
        const derivedTitle = (promptText.trim().split('\n')[0] ?? '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 70)
          .trim()
        const runIndex = nextRunIndex(document, promptId)
        const position = placeResponseNode(document, promptId)
        const id = nanoid(12)
        const now = Date.now()
        const response: AppNode = {
          id,
          type: 'response',
          position,
          selected: false,
          data: {
            kind: 'response',
            status: 'queued',
            text: '',
            parentPromptId: promptId,
            runIndex,
            promptSnapshot: typeof prompt.data.text === 'string' ? prompt.data.text : '',
            requestSnapshot: { ...snapshot },
            ...(derivedTitle ? { title: derivedTitle } : {}),
            stats: { startedAt: now },
          },
        }
        const runEdge: AppEdge = {
          id: nanoid(12),
          source: promptId,
          target: id,
          sourceHandle: 'out',
          targetHandle: 'in',
          kind: 'run',
          createdAt: now,
          label: `run #${runIndex + 1}`,
        }
        get().commit(`Ran a prompt (run #${runIndex + 1})`, `run:${id}`, (state) => {
          state.nodes.push(response)
          state.edges.push(runEdge)
          const mutablePrompt = state.nodes.find((node) => node.id === promptId)
          if (mutablePrompt?.data.kind === 'prompt') {
            mutablePrompt.data.runCount = Math.max(mutablePrompt.data.runCount, runIndex + 1)
            mutablePrompt.data.lastRunAt = now
          }
          state.dirty = true
        })
        return id
      },

      // Not undoable on its own. Streaming calls this once per token, and a
      // history with a step per token would be unusable; the step that matters is
      // the one that created the answer, which undoes the whole run.
      patchResponse(id, patch) {
        set((state) => {
          const node = state.nodes.find((candidate) => candidate.id === id)
          if (!node || node.data.kind !== 'response') return
          Object.assign(node.data, patch)
          state.dirty = true
        })
      },

      patchSummary(id, patch) {
        set((state) => {
          const node = state.nodes.find((candidate) => candidate.id === id)
          if (!node || node.data.kind !== 'summary') return
          Object.assign(node.data, patch)
          state.dirty = true
        })
      },

      createSummaryNode(position, data) {
        const id = nanoid(12)
        get().commit('Added a summary', `summary:${id}`, (state) => {
          state.nodes.push({ id, type: 'summary', position, data: { ...data } })
          state.dirty = true
        })
        return id
      },

      patchSet(id, patch) {
        set((state) => {
          const node = state.nodes.find((candidate) => candidate.id === id)
          if (!node || node.data.kind !== 'set') return
          Object.assign(node.data, patch)
          state.dirty = true
        })
      },

      patchOutput(id, patch) {
        set((state) => {
          const node = state.nodes.find((candidate) => candidate.id === id)
          if (!node || node.data.kind !== 'output') return
          Object.assign(node.data, patch)
          state.dirty = true
        })
      },

      // Not undoable: a run reports what it did, it is not an edit to undo. The
      // files it wrote are put back by `revertBrainRun`, which is the only way
      // that makes sense for something on disk.
      patchBrain(id, patch) {
        set((state) => {
          const node = state.nodes.find((candidate) => candidate.id === id)
          if (!node || node.data.kind !== 'brain') return
          Object.assign(node.data, patch)
          state.dirty = true
        })
      },

      setGroupFrame(id, frame) {
        set((state) => {
          const node = state.nodes.find((candidate) => candidate.id === id)
          // Entrambe le cornici si dimensionano da sole; `groupMemberIds` e' la regola
          // unica su quali nodi sono cornici, cosi' i due tipi non possono divergere.
          if (!node || !groupMemberIds(node)) return
          if (frameMatches(node, frame)) return
          node.position = { x: frame.x, y: frame.y }
          node.width = frame.width
          node.height = frame.height
          state.dirty = true
        })
      },

      duplicateNode(id, atPosition) {
        const source = store.getState().nodes.find((node) => node.id === id)
        if (!source || source.type === 'response' || source.type === 'summary') return null
        // Con una posizione esplicita la copia nasce sotto il puntatore; senza,
        // resta il vecchio scarto fisso di 40 px dall'originale.
        const position = atPosition ?? { x: source.position.x + 40, y: source.position.y + 40 }
        const copy = {
          ...structuredClone(source),
          id: nanoid(12),
          position: { ...position },
          selected: true,
        } as AppNode
        // A copy of a group does not own the same answers: that would draw a
        // second frame around them. The copy starts empty.
        if (copy.data.kind === 'set') copy.data.memberIds = []
        if (copy.data.kind === 'output' && copy.data.sourceNodeIds) {
          copy.data.sourceNodeIds = []
          copy.data.text = ''
        }
        /*
         * Vale per il gruppo solo visivo, e per lo stesso motivo. Il nome e il colore
         * invece restano: sono la parte che si voleva copiare. Copiare una cornice e
         * sperare che si riempia da sola non accaderebbe mai, perche' i membri si
         * scelgono a mano — quindi la copia parte vuota e pronta da riempirire.
         */
        if (copy.data.kind === 'group') copy.data.members = []
        get().commit('Duplicated a node', `duplicate:${copy.id}`, (state) => {
          for (const node of state.nodes) node.selected = false
          state.nodes.push(copy)
          state.dirty = true
        })
        return copy.id
      },


      setSettings(patch) {
        set((state) => {
          const next = cloneSettings(state.settings)
          const merged: Settings = {
            ...next,
            ...patch,
            defaults: {
              ...next.defaults,
              ...(patch.defaults ?? {}),
            },
          }
          const split = splitSettings(merged)
          state.settings = merged
          state.appSettings = split.app
          state.workspaceSettings = split.workspace
          state.dirty = true
        })
      },

      hydrateAppSettings(settings) {
        set((state) => {
          state.appSettings = cloneAppSettings(settings)
          state.settings = mergeSettings(settings, state.workspaceSettings)
        })
      },

      setName(name) {
        set((state) => {
          state.name = name
          state.dirty = true
        })
      },

      setViewport(viewport) {
        set((state) => {
          state.viewport = { ...viewport }
          state.dirty = true
        })
      },

      replaceDocument(document) {
        // Undo must not reach across a document swap: after an import or a
        // reopen, Ctrl+Z would otherwise walk back into the previous document
        // and mix the two.
        history.clear()
        set((state) => {
          state.docVersion = document.docVersion
          state.name = document.name
          state.nodes = document.nodes.map((node) => ({ ...node, selected: false }))
          state.edges = document.edges.map((edge) => ({ ...edge, selected: false }))
          const split = splitSettings(document.settings)
          state.workspaceSettings = {
            defaults: { ...split.workspace.defaults },
            contextTokenWarning: split.workspace.contextTokenWarning,
          }
          state.settings = mergeSettings(state.appSettings, state.workspaceSettings)
          state.viewport = { ...document.viewport }
          state.undoDepth = 0
          state.redoDepth = 0
          state.dirty = true
        })
      },

      resetDocument(document = freshDocument()) {
        store.getState().replaceDocument(document)
      },

      setRevision(revision) {
        set((state) => {
          state.revision = revision
        })
      },

      markSaved(revision) {
        set((state) => {
          state.dirty = false
          if (revision !== undefined) state.revision = revision
        })
      },
    })),
  )
  return store
}

/** Every store has its own history, so a per-workspace close forgets it. */

if (import.meta.env.DEV) {
  // Debug handle: lets the browser console inspect the live workspace state.
  ;(globalThis as unknown as { __nchatGetStore?: () => WorkspaceStoreApi }).__nchatGetStore =
    getActiveWorkspaceStore
}

fallbackStore = createWorkspaceStore('__default__', createEmptyDocument())

const WorkspaceStoreContext = createContext<WorkspaceStoreApi | null>(null)

export function WorkspaceStoreProvider({
  store,
  children,
}: {
  store: WorkspaceStoreApi
  children: ReactNode
}) {
  return (
    <WorkspaceStoreContext.Provider value={store}>{children}</WorkspaceStoreContext.Provider>
  )
}

export function useWorkspaceStoreApi(): WorkspaceStoreApi {
  const contextStore = useContext(WorkspaceStoreContext)
  return contextStore ?? getActiveWorkspaceStore()
}

export function useWorkspace<T>(selector: (state: WorkspaceState) => T): T {
  const contextStore = useContext(WorkspaceStoreContext)
  const store = contextStore ?? getActiveWorkspaceStore()
  return useStore(store, selector)
}

type WorkspaceStoreHook = (<T>(selector: (state: WorkspaceState) => T) => T) & {
  getState: () => WorkspaceState
  setState: WorkspaceStoreApi['setState']
  subscribe: WorkspaceStoreApi['subscribe']
  getInitialState: WorkspaceStoreApi['getInitialState']
}

/** @deprecated Compatibility facade; new code should use useWorkspace/getActiveWorkspaceStore. */
export const useWorkspaceStore = ((selector: (state: WorkspaceState) => unknown) =>
  useWorkspace(selector)) as WorkspaceStoreHook
useWorkspaceStore.getState = () => getActiveWorkspaceStore().getState()
useWorkspaceStore.setState = (partial, replace) => {
  const store = getActiveWorkspaceStore()
  if (replace === true) store.setState(partial as WorkspaceState, true)
  else store.setState(partial)
}
useWorkspaceStore.subscribe = (listener) => getActiveWorkspaceStore().subscribe(listener)
useWorkspaceStore.getInitialState = () => getActiveWorkspaceStore().getInitialState()

export function responseChildren(promptId: NodeId): AppNode[] {
  return siblingsOf(workspaceDocumentFromState(getActiveWorkspaceStore().getState()), promptId)
}