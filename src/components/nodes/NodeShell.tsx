import { NodeResizer } from '@xyflow/react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { NODE_SIZE_LIMITS } from '../../nodes/specs'
import { getActiveWorkspaceStore } from '../../store/workspaceStore'
import type { NodeType, ResponseStatus } from '../../types/document'
import { StatusDot } from './StatusDot'

export function NodeShell({
  id,
  icon,
  title,
  subtitle,
  nodeKind,
  explicitSize = false,
  status = 'idle',
  selected = false,
  error = false,
  collapsed = false,
  className = '',
  actions,
  children,
  footer,
  collapsedPreview,
  zoomSummary,
  summaryIsTitle = false,
}: {
  id: string
  icon: ReactNode
  title: string
  subtitle?: string
  nodeKind: NodeType
  /**
   * The node kind, put in the class list as `<kind>-node`.
   *
   * Lo mette `NodeShell` e non il chiamante perche gia lo sa, e perche la classe
   * mancava a nove tipi su undici: una regola che vuole dire «solo i nodi
   * risposta» non poteva scriversi, quindi non poteva neanche esistere. `note-node`
   * e `summary-node` arrivavano per caso dal proprio componente.
   */
  /** True when the node has a persisted width/height, so it must fill it. */
  explicitSize?: boolean
  status?: ResponseStatus | 'idle'
  selected?: boolean
  error?: boolean
  /** Blender-style: show the header only, to give the canvas back its space. */
  collapsed?: boolean
  className?: string
  actions?: ReactNode
  children: ReactNode
  footer?: ReactNode
  /** One line of context shown while collapsed, when the title is not enough. */
  collapsedPreview?: string
  /**
   * The line that comes forward when the canvas is zoomed far out.
   *
   * Omit it and the node is left sharp: a picture has no line that stands in for
   * it, and blurring one would lose the only thing it has to show.
   */
  zoomSummary?: string | null
  /**
   * The summary is a title, not a line of body text.
   *
   * A title is set larger and marked, because a title that looks like the rest is
   * not a title. It is a separate prop rather than something `NodeShell` guesses
   * from the node kind: the rule for *what* the summary says lives in
   * `logic/zoomSummary.ts`, and this is the other half of the same decision —
   * together in one place, so the two cannot disagree.
   */
  summaryIsTitle?: boolean
}) {
  const limits = NODE_SIZE_LIMITS[nodeKind]
  const toggleCollapsed = (): void => {
    getActiveWorkspaceStore().getState().updateNodeData(id, { collapsed: !collapsed })
  }
  const preview =
    collapsedPreview && collapsedPreview.trim() ? collapsedPreview.trim().split('\n')[0] : ''
  const summary = zoomSummary?.trim() ?? ''

  return (
    <section
      data-node-id={id}
      className={`node-shell ${nodeKind}-node status-${status} ${selected ? 'is-selected' : ''} ${error ? 'has-error' : ''} ${explicitSize ? 'has-explicit-size' : ''} ${collapsed ? 'is-collapsed' : ''} ${summary ? 'has-zoom-summary' : ''} ${className}`.trim()}
      aria-label={title}
      data-collapsed={collapsed ? 'true' : undefined}
    >
      <NodeResizer
        isVisible={Boolean(selected) && !collapsed}
        minWidth={limits.minWidth}
        minHeight={limits.minHeight}
        maxWidth={limits.maxWidth}
        maxHeight={limits.maxHeight}
        lineClassName="node-resize-line"
        handleClassName="node-resize-handle"
      />
      <header className="node-header drag-handle">
        <button
          type="button"
          className="node-collapse nodrag"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
          title={collapsed ? 'Expand' : 'Collapse to the header only'}
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        </button>
        <span className="node-type-icon">{icon}</span>
        <StatusDot status={status} />
        <span className="node-title">{title}</span>
        {subtitle ? <span className="node-subtitle">{subtitle}</span> : null}
        {actions ? <span className="node-header-actions nodrag">{actions}</span> : null}
      </header>
      {/*
        Body and footer stay mounted and are hidden with CSS. Unmounting them
        would take the connection handles with them, since the handles are
        children of this node, and a collapsed node you cannot re-connect is
        useless. It would also reset scroll position on a streaming response.

        `nodrag` su tutto il corpo e' la correzione a un difetto che durava da
        principio: **`drag-handle` non faceva niente.** Non esiste in React Flow —
        la classe che il browser riconosce per non trascinare e' `nodrag`, e questa
        esisteva solo sui pulsanti. Il risultato e' che il nodo intero era una
        superficie di trascinamento, e trascinare significa chiamare
        `preventDefault()` su `mousedown`, che e' esattamente l'evento che mette il
        cursore in una casella di testo.

        Quindi si cliccava dentro un nodo, il nodo restava li', e **non si poteva
        scrivere**: niente caret, niente testo selezionato, niente scrittura. Il
        modo per ottenere il cursore era creare il nodo, che usa `focus()`
        programmatico e aggira l'evento — e percio' il difetto non si vedeva subito,
        perche' sui nodi appena creati funzionava.

        Con `nodrag` sul corpo l'unica superficie di trascinamento e' l'intestazione,
        che e' gia' marcata `drag-handle` e che adesso significa qualcosa. E' il
        comportamento di un editor a nodi: si afferra un nodo per la barra del titolo,
        e dentro si scrive.
      */}
      <div className="node-body nodrag">{children}</div>
      {footer ? <footer className="node-footer nodrag">{footer}</footer> : null}
      {collapsed && preview ? (
        <p className="node-collapsed-preview" title={preview}>
          {preview}
        </p>
      ) : null}
      {/*
        Always in the DOM, revealed by CSS when the canvas is zoomed out. A
        component that mounted on zoom would re-render every node on every wheel
        notch, and a node streaming an answer would lose its scroll position.
      */}
      {summary ? (
        <div
          className={`node-zoom-summary ${summaryIsTitle ? 'is-title' : ''}`.trim()}
          aria-hidden={!summary}
        >
          <p>{summary}</p>
        </div>
      ) : null}
    </section>
  )
}
