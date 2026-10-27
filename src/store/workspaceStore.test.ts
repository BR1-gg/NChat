import { beforeEach, describe, expect, it } from 'vitest'
import { isAppError } from '../types/errors'
import { useWorkspaceStore } from './workspaceStore'

describe('workspace store', () => {
  beforeEach(() => {
    useWorkspaceStore.getState().resetDocument()
  })

  it('adds, moves, and removes nodes with attached edges', () => {
    const store = useWorkspaceStore.getState()
    const promptId = store.addNode('prompt', { x: 10, y: 20 })
    const systemId = store.addNode('system', { x: 200, y: 20 })
    const connection = store.addConnection({
      source: systemId,
      sourceHandle: 'out',
      target: promptId,
      targetHandle: 'system',
    })
    expect(isAppError(connection)).toBe(false)
    expect(useWorkspaceStore.getState().edges).toHaveLength(1)

    useWorkspaceStore.getState().setNodePositions(new Map([[promptId, { x: 50, y: 60 }]]))
    expect(useWorkspaceStore.getState().nodes.find((node) => node.id === promptId)?.position).toEqual({ x: 50, y: 60 })

    useWorkspaceStore.getState().removeNodes([promptId])
    expect(useWorkspaceStore.getState().nodes.some((node) => node.id === promptId)).toBe(false)
    expect(useWorkspaceStore.getState().edges).toHaveLength(0)
  })

  it('rejects a context edge that would close a graph loop', () => {
    const store = useWorkspaceStore.getState()
    const promptId = store.addNode('prompt', { x: 0, y: 0 })
    const followUpId = store.addNode('prompt', { x: 500, y: 0 })
    const first = useWorkspaceStore.getState().createResponseNode(promptId)
    const second = useWorkspaceStore.getState().createResponseNode(followUpId)
    useWorkspaceStore.getState().addConnection({
      source: first,
      sourceHandle: 'context',
      target: followUpId,
      targetHandle: 'context',
    })
    expect(second).not.toBe('')
    const cycle = useWorkspaceStore.getState().addConnection({
      source: second,
      sourceHandle: 'context',
      target: promptId,
      targetHandle: 'context',
    })
    expect(isAppError(cycle) && cycle.message).toBe('This would create a loop.')
  })

  it('creates a new sibling response without mutating an earlier response', () => {
    const store = useWorkspaceStore.getState()
    const promptId = store.addNode('prompt', { x: 0, y: 0 })
    const first = useWorkspaceStore.getState().createResponseNode(promptId)
    useWorkspaceStore.getState().patchResponse(first, { text: 'first answer' })
    const second = useWorkspaceStore.getState().createResponseNode(promptId)

    const responses = useWorkspaceStore.getState().nodes.filter(
      (node) => node.data.kind === 'response',
    )
    expect(responses).toHaveLength(2)
    expect(responses[1]?.id).toBe(second)
    expect(responses.map((node) => node.data.kind === 'response' && node.data.runIndex)).toEqual([0, 1])
    expect(responses[0]?.data.kind === 'response' && responses[0].data.text).toBe('first answer')
    expect(responses[1]?.data.kind === 'response' && responses[1].data.text).toBe('')
  })

  it('titles a new response after the question that produced it', () => {
    const store = useWorkspaceStore.getState()
    const promptId = store.addNode('prompt', { x: 0, y: 0 })
    useWorkspaceStore.getState().updateNodeData(promptId, {
      text: 'Spiega cos e un nodo\nin una riga sola',
    })
    const responseId = useWorkspaceStore.getState().createResponseNode(promptId)

    const created = useWorkspaceStore.getState().nodes.find((node) => node.id === responseId)
    expect(created?.data.kind === 'response' && created.data.title).toBe('Spiega cos e un nodo')
    // The prompt keeps its own title: the node already shows that text.
    const owner = useWorkspaceStore.getState().nodes.find((node) => node.id === promptId)
    expect(owner?.data.kind === 'prompt' && owner.data.title).toBeUndefined()
  })

  it('derives a single-line title from a multi-line question', () => {
    const store = useWorkspaceStore.getState()
    const promptId = store.addNode('prompt', { x: 0, y: 0 })
    useWorkspaceStore.getState().updateNodeData(promptId, {
      text: '  Confronta   i tre risultati  \nIgnora la seconda riga',
    })
    const responseId = useWorkspaceStore.getState().createResponseNode(promptId)
    const created = useWorkspaceStore.getState().nodes.find((node) => node.id === responseId)
    expect(created?.data.kind === 'response' && created.data.title).toBe(
      'Confronta i tre risultati',
    )
  })

  it('detaches a deleted answer from the group that owned it', () => {
    const store = useWorkspaceStore.getState()
    const promptId = store.addNode('prompt', { x: 0, y: 0 })
    const responseId = useWorkspaceStore.getState().createResponseNode(promptId)
    const outputId = store.addNode('output', { x: 400, y: 0 }, {
      sourceNodeIds: [responseId],
    })
    expect(
      useWorkspaceStore.getState().nodes.find((node) => node.id === outputId)?.data.kind === 'output' &&
        useWorkspaceStore.getState().nodes.find((node) => node.id === outputId)?.data.sourceNodeIds,
    ).toEqual([responseId])

    useWorkspaceStore.getState().removeNodes([responseId])
    const remaining = useWorkspaceStore.getState().nodes.find((node) => node.id === outputId)
    expect(remaining?.data.kind === 'output' && remaining.data.sourceNodeIds).toEqual([])
  })
})

/**
 * Ctrl+Z used to do nothing outside a text field, because the only undo was the
 * browser's own inside the textarea. These are the operations that have to work.
 */
describe('undo and redo', () => {
  beforeEach(() => {
    useWorkspaceStore.getState().resetDocument()
  })

  const position = (id: string) =>
    useWorkspaceStore.getState().nodes.find((node) => node.id === id)?.position

  it('brings back a deleted node and takes it away again on redo', () => {
    const id = useWorkspaceStore.getState().addNode('prompt', { x: 10, y: 10 })
    useWorkspaceStore.getState().removeNodes([id])
    expect(useWorkspaceStore.getState().nodes).toHaveLength(0)

    expect(useWorkspaceStore.getState().undo()).toBe('Deleted a node')
    expect(useWorkspaceStore.getState().nodes).toHaveLength(1)
    expect(position(id)).toEqual({ x: 10, y: 10 })

    expect(useWorkspaceStore.getState().redo()).toBe('Deleted a node')
    expect(useWorkspaceStore.getState().nodes).toHaveLength(0)
  })

  it('undoes a move, which is the thing that used to be impossible', () => {
    const id = useWorkspaceStore.getState().addNode('prompt', { x: 0, y: 0 })
    useWorkspaceStore.getState().setNodePositions(new Map([[id, { x: 400, y: 250 }]]))
    expect(position(id)).toEqual({ x: 400, y: 250 })

    useWorkspaceStore.getState().undo()
    expect(position(id)).toEqual({ x: 0, y: 0 })
  })

  it('undoes a connection and restores both nodes', () => {
    const store = useWorkspaceStore.getState()
    const sourcePromptId = store.addNode('prompt', { x: 0, y: 0 })
    const targetPromptId = store.addNode('prompt', { x: 600, y: 0 })
    const answerId = useWorkspaceStore.getState().createResponseNode(sourcePromptId)
    useWorkspaceStore.getState().addConnection({
      source: answerId,
      sourceHandle: 'context',
      target: targetPromptId,
      targetHandle: 'context',
    })
    // Two edges: the run edge that made the answer, and the context edge just added.
    expect(useWorkspaceStore.getState().edges).toHaveLength(2)

    useWorkspaceStore.getState().undo()
    // Only the context edge is gone; the run edge that produced the answer stays.
    expect(useWorkspaceStore.getState().edges).toHaveLength(1)
    expect(useWorkspaceStore.getState().edges[0]?.kind).toBe('run')
    // The answer and both prompts are all still there.
    expect(useWorkspaceStore.getState().nodes.some((node) => node.id === answerId)).toBe(true)
    expect(useWorkspaceStore.getState().nodes.some((node) => node.id === targetPromptId)).toBe(true)
  })

  it('undoes a resize', () => {
    const id = useWorkspaceStore.getState().addNode('prompt', { x: 0, y: 0 })
    useWorkspaceStore.getState().setNodeSize(id, 640, 480)
    expect(useWorkspaceStore.getState().nodes.find((node) => node.id === id)?.width).toBe(640)

    useWorkspaceStore.getState().undo()
    expect(useWorkspaceStore.getState().nodes.find((node) => node.id === id)?.width).toBeUndefined()
  })

  it('moves a whole group by exactly the drag distance, not more', () => {
    // The regression this guards: React Flow reports a position change per
    // mousemove, and the group's frame is recomputed from its answers only after
    // the render. If the delta is measured against a frame that has not moved
    // yet, every step re-applies the whole offset and the group runs away.
    const store = useWorkspaceStore.getState()
    const promptId = store.addNode('prompt', { x: 400, y: 0 })
    const a = useWorkspaceStore.getState().createResponseNode(promptId)
    const b = useWorkspaceStore.getState().createResponseNode(promptId)
    useWorkspaceStore.getState().setNodePositions(new Map([[a, { x: 400, y: 0 }], [b, { x: 400, y: 300 }]]))
    const groupId = useWorkspaceStore.getState().addNode('output', { x: 400, y: 0 }, {
      sourceNodeIds: [a, b],
    })
    const at = (id: string) => {
      const node = useWorkspaceStore.getState().nodes.find((candidate) => candidate.id === id)
      return node ? { x: node.position.x, y: node.position.y } : null
    }

    // Five steps of 20px, the way a drag arrives.
    for (let step = 1; step <= 5; step += 1) {
      useWorkspaceStore.getState().applyNodeChanges([
        { id: groupId, type: 'position', position: { x: 400 + step * 20, y: step * 10 }, dragging: true },
      ])
    }
    // 100px right and 50px down, not 500px.
    expect(at(a)).toEqual({ x: 500, y: 50 })
    expect(at(b)).toEqual({ x: 500, y: 350 })
  })

  it('undoes a group drag in one step, not one per mousemove', () => {
    const store = useWorkspaceStore.getState()
    const promptId = store.addNode('prompt', { x: 0, y: 0 })
    const a = useWorkspaceStore.getState().createResponseNode(promptId)
    useWorkspaceStore.getState().setNodePositions(new Map([[a, { x: 0, y: 0 }]]))
    const groupId = useWorkspaceStore.getState().addNode('output', { x: 0, y: 0 }, {
      sourceNodeIds: [a],
    })
    for (let step = 1; step <= 5; step += 1) {
      useWorkspaceStore.getState().applyNodeChanges([
        { id: groupId, type: 'position', position: { x: step * 20, y: 0 }, dragging: step < 5 },
      ])
    }
    const node = () => useWorkspaceStore.getState().nodes.find((candidate) => candidate.id === a)
    expect(node()?.position).toEqual({ x: 100, y: 0 })

    useWorkspaceStore.getState().undo()
    expect(node()?.position).toEqual({ x: 0, y: 0 })
  })

  it('does not let an abandoned drag poison the next one', () => {
    // A drag can end without ever reporting the end, when the pointer is
    // released outside the window. The half-finished snapshot must not survive
    // into the next gesture, or one undo jumps to a state from before both.
    const store = useWorkspaceStore.getState()
    const promptId = store.addNode('prompt', { x: 0, y: 0 })
    const first = useWorkspaceStore.getState().createResponseNode(promptId)
    const firstGroup = useWorkspaceStore.getState().addNode('output', { x: 0, y: 0 }, {
      sourceNodeIds: [first],
    })
    // A drag that never says it is over.
    useWorkspaceStore.getState().applyNodeChanges([
      { id: firstGroup, type: 'position', position: { x: 200, y: 0 }, dragging: true },
    ])

    // A different node, and a gesture that does finish.
    const second = useWorkspaceStore.getState().createResponseNode(promptId)
    const secondGroup = useWorkspaceStore.getState().addNode('output', { x: 0, y: 400 }, {
      sourceNodeIds: [second],
    })
    useWorkspaceStore.getState().applyNodeChanges([
      { id: secondGroup, type: 'position', position: { x: 200, y: 400 }, dragging: true },
    ])
    useWorkspaceStore.getState().applyNodeChanges([
      { id: secondGroup, type: 'position', position: { x: 300, y: 400 }, dragging: false },
    ])

    useWorkspaceStore.getState().undo()
    // The second group went back to where it was, and nothing else vanished.
    const after = useWorkspaceStore.getState()
    const node = (id: string) => after.nodes.find((candidate) => candidate.id === id)
    expect(node(secondGroup)?.position.x).toBe(0)
    expect(node(firstGroup)).toBeDefined()
    expect(node(first)).toBeDefined()
  })

  it('undoes a whole run, not each streamed token', () => {
    const promptId = useWorkspaceStore.getState().addNode('prompt', { x: 0, y: 0 })
    const responseId = useWorkspaceStore.getState().createResponseNode(promptId)
    // Simulates a stream: many patches on the same answer.
    for (const text of ['H', 'He', 'Hel', 'Hell', 'Hello']) {
      useWorkspaceStore.getState().patchResponse(responseId, { text })
    }
    useWorkspaceStore.getState().undo()
    // The step recorded is the creation of the answer, so undo removes it whole
    // rather than rewinding the text one token at a time. Five patches to the
    // text left exactly one step behind, not five.
    expect(useWorkspaceStore.getState().nodes.some((node) => node.id === responseId)).toBe(false)
    expect(useWorkspaceStore.getState().undo()).toBe('Added prompt')
    expect(useWorkspaceStore.getState().undo()).toBeNull()
  })

  it('walks back several steps one at a time', () => {
    const a = useWorkspaceStore.getState().addNode('prompt', { x: 0, y: 0 })
    useWorkspaceStore.getState().addNode('prompt', { x: 200, y: 0 })
    useWorkspaceStore.getState().removeNodes([a])

    expect(useWorkspaceStore.getState().nodes).toHaveLength(1)
    useWorkspaceStore.getState().undo()
    expect(useWorkspaceStore.getState().nodes).toHaveLength(2)
    useWorkspaceStore.getState().undo()
    expect(useWorkspaceStore.getState().nodes).toHaveLength(1)
    useWorkspaceStore.getState().undo()
    expect(useWorkspaceStore.getState().nodes).toHaveLength(0)
  })

  it('forgets the redo branch as soon as something new happens', () => {
    const id = useWorkspaceStore.getState().addNode('prompt', { x: 0, y: 0 })
    useWorkspaceStore.getState().removeNodes([id])
    useWorkspaceStore.getState().undo()
    useWorkspaceStore.getState().addNode('prompt', { x: 0, y: 0 })
    expect(useWorkspaceStore.getState().redoDepth).toBe(0)
    expect(useWorkspaceStore.getState().redo()).toBeNull()
  })

  it('reports when there is nothing to undo instead of pretending', () => {
    expect(useWorkspaceStore.getState().undoDepth).toBe(0)
    expect(useWorkspaceStore.getState().undo()).toBeNull()
  })

  it('does not push a step for a change that changed nothing', () => {
    useWorkspaceStore.getState().addNode('prompt', { x: 0, y: 0 })
    useWorkspaceStore.getState().undo()
    // Selecting is not a document change and must not become a step.
    const id = useWorkspaceStore.getState().nodes[0]?.id ?? ''
    useWorkspaceStore.getState().setNodeSelected(id, true)
    useWorkspaceStore.getState().setViewport({ x: 10, y: 10, zoom: 1 })
    expect(useWorkspaceStore.getState().undo()).toBeNull()
  })

  it('does not undo across a document swap', () => {
    useWorkspaceStore.getState().addNode('prompt', { x: 0, y: 0 })
    useWorkspaceStore.getState().resetDocument()
    // The import brought its own document: walking back into the old one would
    // mix the two.
    expect(useWorkspaceStore.getState().undo()).toBeNull()
  })

  it('marks the workspace dirty, so an undo is saved', () => {
    const id = useWorkspaceStore.getState().addNode('prompt', { x: 0, y: 0 })
    useWorkspaceStore.getState().markSaved()
    useWorkspaceStore.getState().removeNodes([id])
    useWorkspaceStore.getState().undo()
    expect(useWorkspaceStore.getState().dirty).toBe(true)
  })

  it('flips the depths so the toolbar buttons enable', () => {
    expect(useWorkspaceStore.getState().undoDepth).toBe(0)
    useWorkspaceStore.getState().addNode('prompt', { x: 0, y: 0 })
    expect(useWorkspaceStore.getState().undoDepth).toBe(1)
    useWorkspaceStore.getState().undo()
    expect(useWorkspaceStore.getState().undoDepth).toBe(0)
    expect(useWorkspaceStore.getState().redoDepth).toBe(1)
  })
})
