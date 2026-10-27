import { Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { XYPosition } from '@xyflow/react'
import { connectNodes } from '../../actions/connectNodes'
import { compatibleTypes, targetHandleFor } from '../../logic/connections'
import { creationPosition } from '../../logic/placement'
import { NODE_REGISTRY, addableNodeTypes } from '../../nodes/registry'
import { useUiStore } from '../../store/uiStore'
import { useWorkspaceStore, workspaceDocumentFromState } from '../../store/workspaceStore'
import type { AddableNodeType } from '../../types/document'
import { TextInput } from '../common/FormControls'

const items = addableNodeTypes.map((type) => ({ type, spec: NODE_REGISTRY[type] }))

function freePosition(position: XYPosition): XYPosition {
  const nodes = useWorkspaceStore.getState().nodes
  let candidate = { ...position }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const occupied = nodes.some(
      (node) => Math.abs(node.position.x - candidate.x) < 40 && Math.abs(node.position.y - candidate.y) < 40,
    )
    if (!occupied) return candidate
    candidate = { x: candidate.x + 40, y: candidate.y + 40 }
  }
  return candidate
}

export function NodePalette() {
  const open = useUiStore((state) => state.paletteOpen)
  const screenPosition = useUiStore((state) => state.palettePosition)
  const filter = useUiStore((state) => state.paletteFilter)
  const connect = useUiStore((state) => state.paletteConnect)
  const pendingResponseId = useUiStore((state) => state.pendingResponseId)
  const insertionPosition = useUiStore((state) => state.insertionPosition)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  /**
   * When the palette was opened by releasing a dragged handle, it offers only the
   * node types that would actually connect to it.
   *
   * The previous attempt listed the **existing** nodes, which was the wrong
   * question: the useful gesture is "drag, and get the next node", not "drag, and
   * hunt through the graph for a target". Offering every type and refusing after
   * the fact is worse, because by then a node exists that has to be deleted.
   */
  const connectable = useMemo(() => {
    if (!connect) return null
    return new Set(
      compatibleTypes(
        workspaceDocumentFromState(useWorkspaceStore.getState()),
        connect.sourceId,
        connect.sourceHandle,
      ),
    )
  }, [connect])

  const filtered = useMemo(() => {
    let available = items
    if (filter) available = available.filter((item) => item.type === filter)
    if (connectable) available = available.filter((item) => connectable.has(item.type))
    const needle = query.trim().toLowerCase()
    return needle
      ? available.filter((item) =>
          `${item.spec.label} ${item.spec.description}`.toLowerCase().includes(needle),
        )
      : available
  }, [filter, connectable, query])

  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [])

  if (!open) return null

  const insert = (type: AddableNodeType): void => {
    const ui = useUiStore.getState()
    // Sotto il cursore; se il puntatore non e mai passato sul canvas si cade al
    // centro della vista, non all'origine del mondo.
    const anchor = creationPosition(screenPosition ? insertionPosition : null, insertionPosition)
    const id = useWorkspaceStore
      .getState()
      .addNode(type, freePosition(anchor), type === 'note' ? { color: 'default' } : undefined)
    if (connect) {
      // The whole point of this mode: created and wired in one action, and the
      // handle it connects to is worked out rather than guessed.
      const target = targetHandleFor(
        workspaceDocumentFromState(useWorkspaceStore.getState()),
        connect.sourceId,
        connect.sourceHandle,
        type,
      )
      if (target) {
        connectNodes({
          source: connect.sourceId,
          sourceHandle: connect.sourceHandle,
          target: id,
          targetHandle: target,
        })
      }
    } else if (pendingResponseId && type === 'prompt') {
      connectNodes({
        source: pendingResponseId,
        sourceHandle: 'context',
        target: id,
        targetHandle: 'context',
      })
    }
    ui.setSelectedNode(id)
    ui.setFocusNode(id)
    ui.closePalette()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => Math.min(filtered.length - 1, index + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => Math.max(0, index - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const item = filtered[activeIndex]
      if (item) insert(item.type)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      useUiStore.getState().closePalette()
    }
  }

  const left = screenPosition
    ? Math.max(12, Math.min(window.innerWidth - 432, screenPosition.x - 210))
    : undefined
  const top = screenPosition
    ? Math.max(12, Math.min(window.innerHeight - 430, screenPosition.y - 80))
    : undefined

  return (
    <div
      className="palette-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) useUiStore.getState().closePalette()
      }}
    >
      <div
        className="node-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Add node"
        onKeyDown={onKeyDown}
        style={left !== undefined && top !== undefined ? { position: 'fixed', left, top } : undefined}
      >
        <div className="palette-search-wrap">
          <Search size={14} />
          <TextInput
            ref={inputRef}
            className="palette-search"
            value={query}
            placeholder={connect ? 'What does it connect to?' : 'Search node types…'}
            aria-label="Search node types"
            onChange={(event) => {
              setQuery(event.currentTarget.value)
              setActiveIndex(0)
            }}
          />
        </div>
        {connect ? (
          <p className="palette-connect-note">
            {filtered.length === 0
              ? 'Nothing you can add here takes that connection.'
              : 'Only what this handle can connect to. Pick one and it is created and wired.'}
          </p>
        ) : null}
        <div className="palette-list" role="listbox" aria-label="Node types">
          {filtered.map((item, index) => {
            const Icon = item.spec.icon
            return (
              <button
                key={item.type}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={`palette-item ${index === activeIndex ? 'active' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => insert(item.type)}
              >
                <span className="palette-item-icon">
                  <Icon size={15} />
                </span>
                <span className="palette-item-copy">
                  <strong>{item.spec.label}</strong>
                  <span>{item.spec.description}</span>
                </span>
                <span className="kbd">{item.spec.shortcut ?? '·'}</span>
              </button>
            )
          })}
          {filtered.length === 0 ? <div className="palette-empty">No matching node types.</div> : null}
        </div>
      </div>
    </div>
  )
}
