import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { setLastPointerPosition } from '../../logic/placement'
import { useUiStore } from '../../store/uiStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { NodePalette } from './NodePalette'

/**
 * New nodes used to appear in the middle of the visible canvas. The palette now
 * inserts under the pointer. The pure placement tests cover the decision; this
 * one covers the wiring, using the real stores so nothing is mocked away.
 */
function openPaletteAt(position: { x: number; y: number } | null): void {
  useUiStore.getState().setInsertionPosition({ x: 1000, y: 800 })
  useUiStore.getState().openPalette(position)
  render(<NodePalette />)
}

function insertPrompt(): { x: number; y: number } {
  const item = screen.getByText('Prompt').closest('button')
  if (!item) throw new Error('prompt item not found')
  // act: il click aggiorna lo store, che il componente deve ri-renderizzare.
  act(() => item.click())
  const nodes = useWorkspaceStore.getState().nodes
  const created = nodes[nodes.length - 1]
  if (!created) throw new Error('no node was created')
  return created.position
}

describe('NodePalette placement', () => {
  beforeEach(() => {
    useWorkspaceStore.getState().resetDocument()
    useUiStore.getState().closePalette()
    setLastPointerPosition(null)
  })

  it('inserts under the pointer when the palette was opened from the toolbar', () => {
    setLastPointerPosition({ x: 42, y: 77 })
    openPaletteAt(null)
    expect(insertPrompt()).toEqual({ x: 42, y: 77 })
  })

  it('inserts at the view centre when the pointer was never on the canvas', () => {
    openPaletteAt(null)
    expect(insertPrompt()).toEqual({ x: 1000, y: 800 })
  })

  it('nudges a candidate that would land on an existing node', () => {
    useWorkspaceStore.getState().addNode('prompt', { x: 42, y: 77 })
    setLastPointerPosition({ x: 42, y: 77 })
    openPaletteAt(null)
    // freePosition steps aside instead of stacking on top of the other node.
    expect(insertPrompt()).toEqual({ x: 82, y: 117 })
  })

  it('uses the pointed place when the palette was opened on the canvas', () => {
    // Right-clicking or double-clicking the canvas sets the insertion point on
    // purpose, so it must win over wherever the pointer happens to be.
    useUiStore.getState().setInsertionPosition({ x: 1234, y: 567 })
    setLastPointerPosition({ x: 42, y: 77 })
    useUiStore.getState().openPalette({ x: 300, y: 300 })
    render(<NodePalette />)
    expect(insertPrompt()).toEqual({ x: 1234, y: 567 })
  })
})

/**
 * The palette opened by releasing a dragged handle on empty canvas.
 *
 * The gesture means "give me the next node", so the list holds only the types
 * that would connect from where the drag started, and picking one both creates it
 * and wires it. A list of existing targets was the wrong reading of the gesture,
 * and offering every type and refusing afterwards is worse still, because a node
 * then exists that has to be deleted.
 */
describe('NodePalette after a drag', () => {
  beforeEach(() => {
    useWorkspaceStore.getState().resetDocument()
    useUiStore.getState().closePalette()
    setLastPointerPosition(null)
  })

  const openAfterDrag = (
    sourceId: string,
    sourceHandle: string | null,
    at = { x: 300, y: 300 },
  ): void => {
    // The canvas sets the insertion point to where the drag was released, so that
    // is the point the new node lands on.
    useUiStore.getState().setInsertionPosition(at)
    useUiStore.getState().openPalette({ x: 400, y: 400 }, null, { sourceId, sourceHandle })
    render(<NodePalette />)
  }

  it('offers only what the dragged handle can connect to', () => {
    const p1 = useWorkspaceStore.getState().addNode('prompt', { x: 0, y: 0 })
    const r1 = useWorkspaceStore.getState().createResponseNode(p1)
    openAfterDrag(r1, 'context')
    const labels = screen.getAllByRole('option').map((option) => option.textContent ?? '')
    // A prompt takes context, a group takes answers, an image does not.
    expect(labels.some((label) => label.includes('Prompt'))).toBe(true)
    expect(labels.some((label) => label.includes('Image'))).toBe(false)
    expect(labels.some((label) => label.includes('Note'))).toBe(false)
  })

  it('says why the list is short', () => {
    const p1 = useWorkspaceStore.getState().addNode('prompt', { x: 0, y: 0 })
    const r1 = useWorkspaceStore.getState().createResponseNode(p1)
    openAfterDrag(r1, 'context')
    expect(screen.getByText(/only what this handle can connect to/i)).toBeInTheDocument()
  })

  it('creates the node and wires it in one action', () => {
    const p1 = useWorkspaceStore.getState().addNode('prompt', { x: 0, y: 0 })
    const r1 = useWorkspaceStore.getState().createResponseNode(p1)
    openAfterDrag(r1, 'context')

    const item = screen.getByText('Prompt').closest('button')
    if (!item) throw new Error('prompt item not found')
    act(() => item.click())

    const { nodes, edges } = useWorkspaceStore.getState()
    const created = nodes[nodes.length - 1]
    expect(created?.type).toBe('prompt')
    const made = edges.find((edge) => edge.source === r1 && edge.target === created?.id)
    expect(made?.kind).toBe('context')
    expect(made?.targetHandle).toBe('context')
  })

  it('lands the new node where the drag was released', () => {
    const p1 = useWorkspaceStore.getState().addNode('prompt', { x: 0, y: 0 })
    const r1 = useWorkspaceStore.getState().createResponseNode(p1)
    openAfterDrag(r1, 'context', { x: 640, y: 480 })
    const item = screen.getByText('Prompt').closest('button')
    if (!item) throw new Error('prompt item not found')
    act(() => item.click())
    const nodes = useWorkspaceStore.getState().nodes
    expect(nodes[nodes.length - 1]?.position).toEqual({ x: 640, y: 480 })
  })

  it('offers a picture only a prompt, through its image input', () => {
    const pic = useWorkspaceStore.getState().addNode('image', { x: 0, y: 0 })
    openAfterDrag(pic, 'out')
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0]?.textContent).toContain('Prompt')
  })

  it('says so when the handle reaches nothing that can be added', () => {
    const p1 = useWorkspaceStore.getState().addNode('prompt', { x: 0, y: 0 })
    // A prompt's output is a run, not a wire.
    openAfterDrag(p1, 'out')
    expect(screen.getByText(/nothing you can add here takes that connection/i)).toBeInTheDocument()
  })

  it('offers every type when the palette was not opened by a drag', () => {
    const p1 = useWorkspaceStore.getState().addNode('prompt', { x: 0, y: 0 })
    useWorkspaceStore.getState().createResponseNode(p1)
    useUiStore.getState().setInsertionPosition({ x: 0, y: 0 })
    useUiStore.getState().openPalette(null)
    render(<NodePalette />)
    expect(screen.getAllByRole('option').length).toBeGreaterThan(3)
    expect(p1).toBeTruthy()
  })
})
