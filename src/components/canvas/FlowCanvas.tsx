import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  useNodes,
  useReactFlow,
  useViewport,
  type Connection,
  type IsValidConnection,
  type OnConnectEnd,
  type ReactFlowInstance,
} from '@xyflow/react'
import {
  Focus,
  LayoutDashboard,
  Maximize,
  Minus,
  Plus,
  Sparkles,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
} from 'react'
import { applyAutoLayout, readImportFile } from '../../actions/workspaceIO'
import { connectNodes } from '../../actions/connectNodes'
import { createImageNodeFromFile } from '../../actions/imageActions'
import {
  createFolderNodeFromFiles,
  createFileNodeFromFile,
  droppedEntryOf,
  isAppExport,
  readDroppedDirectory,
} from '../../actions/fileActions'
import { computeGroupFrame, groupMemberIds } from '../../logic/groups'
import { setLastPointerPosition } from '../../logic/placement'
import { FAR_ZOOM } from '../../logic/zoomSummary'
import { refreshOutputs } from '../../actions/setActions'
import { SetOutlines } from './SetOutlines'
import { canScrollFurther, findScrollableAncestor } from './wheelRouting'
import { connectionKind, isAppEdge } from '../../logic/graph'
import { useUiStore } from '../../store/uiStore'
import {
  useWorkspaceStore,
  workspaceDocumentFromState,
} from '../../store/workspaceStore'
import type { AppEdge, AppNode } from '../../types/document'
import { IconButton } from '../common/Button'
import { ContextMenu } from './ContextMenu'
import { NODE_REGISTRY, nodeTypes } from '../../nodes/registry'
import { Onboarding } from './Onboarding'

export function FlowCanvas({ onTestConnection }: { onTestConnection: () => void }) {
  const nodes = useWorkspaceStore((state) => state.nodes)
  const edges = useWorkspaceStore((state) => state.edges)
  const minimapOpen = useUiStore((state) => state.preferences.minimapOpen)
  const edgeStyle = useUiStore((state) => state.preferences.edgeStyle)
  const theme = useWorkspaceStore((state) => state.settings.theme)
  const [dropActive, setDropActive] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const flowRef = useRef<ReactFlowInstance<AppNode, AppEdge> | null>(null)
  const { screenToFlowPosition, fitView, zoomIn, zoomOut, setViewport, setCenter } = useReactFlow<AppNode, AppEdge>()
  const viewport = useViewport()

  const renderedEdges = useMemo(
    () =>
      edges.map((edge) => ({
        ...edge,
        type: edgeStyle,
        animated: edge.kind === 'context',
        style: {
          stroke:
            edge.kind === 'run'
              ? 'var(--edge-run)'
              : edge.kind === 'system'
                ? 'var(--edge-system)'
                : 'var(--edge-context)',
          strokeWidth: 2,
        },
        labelStyle: { fill: 'var(--text-faint)' },
        labelBgStyle: { fill: 'var(--surface)' },
      })),
    [edgeStyle, edges],
  )

  const measuredNodes = useNodes<AppNode>()

  /**
   * A group is its own frame: the node has to sit exactly around the answers it
   * encloses, and follow them when they are dragged. This runs after React Flow
   * has measured the nodes, because the bounding box needs their real size.
   * `setGroupFrame` writes only on a real change, so the loop settles after one
   * pass instead of oscillating.
   */
  useEffect(() => {
    const members = measuredNodes.map((node) => ({
      id: node.id,
      position: node.position,
      width: node.width,
      height: node.height,
      measured: node.measured,
    }))
    for (const node of measuredNodes) {
      /*
       * La regola su chi e' una cornice e' in `groupMemberIds`, non qui. Repeaterla qui
       * accanto a `kind !== 'output'` era il modo di dimenticarsi il gruppo nel primo
       * posto venuto: la cornice del gruppo visivo non si sarebbe mai ridimensionata e
       * sarebbe restata ferma mentre i suoi nodi si spostavano.
       */
      const memberIds = groupMemberIds(node)
      if (!memberIds || memberIds.length === 0) continue
      const frame = computeGroupFrame(node.id, memberIds, members)
      if (frame) useWorkspaceStore.getState().setGroupFrame(node.id, frame)
    }
  }, [measuredNodes])

  /*
   * La rotella, e chi se la tiene. La regola e in `wheelRouting.ts`, che la spiega
   * con i suoi due casi limite; qui c'e solo il collegamento all'evento.
   *
   * React Flow ascolta la rotella sul pannello e la usa per lo zoom, quindi la
   * rotella su un testo che scorre non faceva niente: non zoomava e non scorreva.
   */
  useEffect(() => {
    const wrap = wrapperRef.current
    if (!wrap) return
    const onWheel = (event: WheelEvent): void => {
      if (event.deltaY === 0) return
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      const scroller = findScrollableAncestor(target, wrap)
      if (!scroller) return
      // Ferma l'evento **solo** se il testo puo ancora scorrere in quella direzione.
      if (canScrollFurther(scroller, event.deltaY)) event.stopPropagation()
    }
    // `capture: true` e tutto il punto: senza, React Flow ha gia consumato l'evento
    // e non c'e piu niente da fermare.
    wrap.addEventListener('wheel', onWheel, { capture: true, passive: true })
    return () => wrap.removeEventListener('wheel', onWheel, { capture: true })
  }, [])

  const updateInsertionPoint = useCallback(() => {
    const rect = wrapperRef.current?.getBoundingClientRect()
    if (!rect) return
    useUiStore.getState().setInsertionPosition(
      screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }),
    )
  }, [screenToFlowPosition])

  const fit = useCallback(() => {
    void fitView({ padding: 0.18, duration: 350 })
  }, [fitView])

  useEffect(() => {
    const onFit = (): void => fit()
    const onLayout = (): void => {
      applyAutoLayout()
      window.setTimeout(fit, 50)
    }
    const onLayoutComplete = (): void => {
      window.setTimeout(fit, 50)
    }
    const onResetZoom = (): void => {
      const current = flowRef.current?.getViewport()
      if (current) void setViewport({ ...current, zoom: 1 }, { duration: 200 })
    }
    /*
     * Porta un nodo al centro della vista.
     *
     * `fitView` non va bene perche' mostra **tutto**, e su un grafo di trecento nodi
     * cioe' significa zoom out fino a far diventare il nodo cercato un quadratino di
     * tre pixel. Un risultato di ricerca che ti porta a una macchia non ti porta da
     * nessuna parte, quindi si centra il nodo e basta, a una zoom leggibile.
     */
    const onFocusNode = (event: Event): void => {
      const id = (event as CustomEvent<string>).detail
      const node = useWorkspaceStore.getState().nodes.find((candidate) => candidate.id === id)
      if (!node) return
      const width = node.measured?.width ?? node.width ?? 280
      const height = node.measured?.height ?? node.height ?? 180
      void setCenter(node.position.x + width / 2, node.position.y + height / 2, {
        zoom: 1,
        duration: 300,
      })
    }
    window.addEventListener('nchat:fit-view', onFit)
    window.addEventListener('nchat:layout', onLayout)
    window.addEventListener('nchat:layout-complete', onLayoutComplete)
    window.addEventListener('nchat:zoom-reset', onResetZoom)
    window.addEventListener('nchat:focus-node', onFocusNode)
    return () => {
      window.removeEventListener('nchat:fit-view', onFit)
      window.removeEventListener('nchat:layout', onLayout)
      window.removeEventListener('nchat:layout-complete', onLayoutComplete)
      window.removeEventListener('nchat:zoom-reset', onResetZoom)
      window.removeEventListener('nchat:focus-node', onFocusNode)
    }
  }, [fit, setViewport, setCenter])

  const isValidConnection: IsValidConnection<AppEdge> = (connection) => {
    if (!connection.source || !connection.target) return false
    const kind = connectionKind(workspaceDocumentFromState(useWorkspaceStore.getState()), {
      sourceId: connection.source,
      sourceHandle: connection.sourceHandle ?? null,
      targetId: connection.target,
      targetHandle: connection.targetHandle ?? null,
    })
    return isAppEdge(kind)
  }

  const onConnectEnd: OnConnectEnd = (event, state): void => {
    const sourceId = state.fromNode?.id
    const sourceHandle = state.fromHandle?.id
    if (!sourceId || !sourceHandle) return
    if (state.toNode) {
      if (state.isValid === false) {
        connectNodes({
          source: sourceId,
          sourceHandle,
          target: state.toNode.id,
          targetHandle: state.toHandle?.id ?? null,
        })
      }
      return
    }
    // Released on empty canvas: the gesture means "I want the next node", so the
    // palette opens offering only the types that would connect here. Offering
    // everything and refusing afterwards leaves a node the user has to delete.
    const mouse = 'clientX' in event ? event : null
    if (!mouse) return
    const at = screenToFlowPosition({ x: mouse.clientX, y: mouse.clientY })
    useUiStore.getState().setInsertionPosition(at)
    useUiStore
      .getState()
      .openPalette({ x: mouse.clientX, y: mouse.clientY }, null, { sourceId, sourceHandle })
  }

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setDropActive(false)
    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    const dropAt = { x: position.x - 150, y: position.y - 60 }

    // Una cartella rilasciata non arriva in dataTransfer.files: serve
    // l'API non standard, e va letta prima di tutto il resto.
    const entry = droppedEntryOf(event.dataTransfer.items)
    if (entry?.isDirectory) {
      const directory = entry as FileSystemDirectoryEntry
      void readDroppedDirectory(directory).then((files) => {
        if (files.length === 0) {
          useUiStore.getState().addToast({ tone: 'warning', title: `${directory.name} is empty.` })
          return
        }
        return createFolderNodeFromFiles(files, directory.name, dropAt)
      })
      return
    }

    const file = event.dataTransfer.files[0]
    if (!file) return
    if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
      void createImageNodeFromFile(file, dropAt)
      return
    }
    // Un .json puo essere un export di NCHAT oppure un file da dare al
    // modello. Si guarda dentro: da fuori i due casi sono indistinguibili, e
    // sbagliare significa non poter piu usare un file JSON come contesto.
    if (file.name.toLowerCase().endsWith('.json')) {
      void isAppExport(file).then((isExport) => {
        if (isExport) readImportFile(file)
        else void createFileNodeFromFile(file, dropAt)
      })
      return
    }
    void createFileNodeFromFile(file, dropAt)
  }

  return (
    <div
      ref={wrapperRef}
      className="canvas-wrap"
      /*
        Whether the canvas is zoomed out past reading distance. It is an
        attribute and not a class or a store value because it is a pure
        consequence of the zoom: nothing else reads it, and CSS can act on it
        without a component subscribing to anything. The threshold lives in
        `logic/zoomSummary.ts`, next to the rule that decides what to show.
      */
      data-canvas-zoom={viewport.zoom < FAR_ZOOM ? 'far' : 'near'}
      /*
        The zoom itself, as a number the stylesheet can divide by.

        Il nodo vive dentro `transform: scale(zoom)`, quindi ogni `font-size` in
        pixel del nodo e gia moltiplicato per lo zoom: a 0.2, undici pixel diventano
        due. Il riepilogo a zoom lontano era esattamente questo — non poco testo,
        ma testo illeggibile, che e la stessa cosa che non averlo.

        Esporre lo zoom come variabile e l'unico modo per annullarlo in CSS senza
        far riscrivere i pixel di ogni nodo a ogni scatto della rotella, che
        costerebbe un render per nodo per ogni notch.
      */
      style={{ '--canvas-zoom': viewport.zoom } as CSSProperties}
      onDragEnter={(event) => {
        if (event.dataTransfer.types.includes('Files')) setDropActive(true)
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDropActive(false)
      }}
      onDrop={onDrop}
    >
      <ReactFlow<AppNode, AppEdge>
        nodes={nodes}
        edges={renderedEdges}
        nodeTypes={nodeTypes}
        onInit={(instance) => {
          flowRef.current = instance
          const viewport = useWorkspaceStore.getState().viewport
          void instance.setViewport(viewport)
          updateInsertionPoint()
        }}
        onNodesChange={useWorkspaceStore.getState().applyNodeChanges}
        onEdgesChange={useWorkspaceStore.getState().applyEdgeChanges}
        onConnect={(connection: Connection) => {
          const error = connectNodes(connection)
          if (!error) refreshOutputs()
        }}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        onNodeClick={(_, node) => useUiStore.getState().setSelectedNode(node.id)}
        onPaneMouseMove={(event) => {
          // Fuori da React e fuori dallo store: si scrive a ogni movimento del
          // mouse e nessun componente deve ri-renderizzarsi per questo.
          setLastPointerPosition(screenToFlowPosition({ x: event.clientX, y: event.clientY }))
        }}
        onPaneClick={() => {
          useUiStore.getState().setSelectedNode(null)
          updateInsertionPoint()
        }}
        onSelectionChange={({ nodes: selected }) =>
          useUiStore
            .getState()
            .setSelectedNode(selected.length === 1 ? selected[0]?.id ?? null : null)
        }
        onNodeContextMenu={(event, node) => {
          event.preventDefault()
          const selected = useWorkspaceStore.getState().nodes.filter((candidate) => candidate.selected)
          useUiStore.getState().setContextMenu({
            x: event.clientX,
            y: event.clientY,
            nodeId: node.id,
            selectedIds: selected.length > 1 ? selected.map((candidate) => candidate.id) : undefined,
          })
        }}
        onSelectionContextMenu={(event, selected) => {
          event.preventDefault()
          useUiStore.getState().setContextMenu({
            x: event.clientX,
            y: event.clientY,
            nodeId: selected[0]?.id ?? null,
            selectedIds: selected.map((candidate) => candidate.id),
          })
        }}
        onPaneContextMenu={(event) => {
          event.preventDefault()
          const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
          useUiStore.getState().setInsertionPosition(position)
          useUiStore.getState().setContextMenu({ x: event.clientX, y: event.clientY, nodeId: null })
        }}
        onDoubleClick={(event) => {
          const target = event.target
          if (!(target instanceof HTMLElement) || !target.classList.contains('react-flow__pane')) return
          const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
          useUiStore.getState().setInsertionPosition(position)
          useUiStore.getState().openPalette({ x: event.clientX, y: event.clientY })
        }}
        onMoveEnd={(_, nextViewport) => {
          useWorkspaceStore.getState().setViewport(nextViewport)
          updateInsertionPoint()
        }}
        minZoom={0.2}
        maxZoom={2.5}
        defaultViewport={useWorkspaceStore.getState().viewport}
        deleteKeyCode={null}
        multiSelectionKeyCode="Shift"
        selectionKeyCode="Shift"
        connectionLineStyle={{ stroke: 'var(--accent)', strokeWidth: 2 }}
        connectionRadius={28}
        colorMode={theme}
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: false }}
      >
        {/*
          The dot colour is a variable, not `--border`, because in the glass look
          the canvas behind the dots is a light wash instead of a dark plane, and
          a border-coloured dot disappears on it. The variables are defined per
          appearance in the stylesheets.
        */}
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--canvas-dot)" />
        <SetOutlines />
        <Controls position="bottom-left" showInteractive={false} />
        <Panel position="top-left" className="canvas-toolbar">
          <IconButton label="Add node" onClick={() => useUiStore.getState().openPalette()}>
            <Plus size={14} />
          </IconButton>
          <IconButton label="Auto-layout (A)" onClick={() => { applyAutoLayout(); window.setTimeout(fit, 50) }}>
            <LayoutDashboard size={14} />
          </IconButton>
          <IconButton label="Fit view (F)" onClick={fit}>
            <Maximize size={14} />
          </IconButton>
          <span className="toolbar-divider" />
          <IconButton label="Zoom out" onClick={() => void zoomOut({ duration: 150 })}>
            <Minus size={13} />
          </IconButton>
          <span className="zoom-readout">{Math.round(viewport.zoom * 100)}%</span>
          <IconButton label="Zoom in" onClick={() => void zoomIn({ duration: 150 })}>
            <Plus size={13} />
          </IconButton>
          <IconButton label="Reset zoom to 100% (1)" onClick={() => {
            const current = flowRef.current?.getViewport()
            if (current) void setViewport({ ...current, zoom: 1 }, { duration: 180 })
          }}>
            <Focus size={13} />
          </IconButton>
        </Panel>
        {minimapOpen ? (
          <MiniMap
            position="bottom-right"
            pannable
            zoomable
            nodeColor={(node) =>
              NODE_REGISTRY[node.type as keyof typeof NODE_REGISTRY]?.minimapColor ??
              'var(--accent)'
            }
            maskColor="var(--overlay)"
          />
        ) : null}
        {nodes.length === 0 ? <Onboarding onTestConnection={onTestConnection} /> : null}
        {dropActive ? (
          <div className="dialog-backdrop" style={{ zIndex: 80 }}>
            <div className="dialog small">
              <div className="dialog-body" style={{ textAlign: 'center' }}>
                <Sparkles size={24} color="var(--accent)" />
                <h2>Drop a NCHAT workspace</h2>
                <p className="inspector-value">The file will be validated before it changes anything.</p>
              </div>
            </div>
          </div>
        ) : null}
      </ReactFlow>
      <ContextMenu />
    </div>
  )
}
