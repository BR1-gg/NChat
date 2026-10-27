import { describe, expect, it } from 'vitest'
import { History } from './history'

/** A tiny immutable-ish stand-in for the node array. */
const snap = (name: string) => ({ name })
const same = { nodes: [], edges: [] }

describe('History', () => {
  it('starts empty and says so', () => {
    const history = new History<unknown, unknown>()
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(false)
    expect(history.nextUndoLabel).toBeNull()
    expect(history.undo(same)).toBeNull()
  })

  it('records nothing when the mutation changed nothing', () => {
    // The store relies on this: a producer that touched no node hands back the
    // very same array, and recording it would fill the history with no-ops.
    const history = new History<unknown, unknown>()
    const state = snap('a')
    history.record({ nodes: state, edges: same }, { nodes: state, edges: same }, 'No change', 'k')
    expect(history.canUndo).toBe(false)
  })

  it('undoes back to the state before the step', () => {
    const history = new History<{ name: string }, unknown>()
    const before = snap('before')
    const after = snap('after')
    history.record({ nodes: before, edges: same }, { nodes: after, edges: same }, 'Moved', 'k')
    expect(history.undo({ nodes: after, edges: same })?.nodes).toBe(before)
    expect(history.canRedo).toBe(true)
  })

  it('redoes to the state it came from', () => {
    const history = new History<{ name: string }, unknown>()
    const before = snap('before')
    const after = snap('after')
    history.record({ nodes: before, edges: same }, { nodes: after, edges: same }, 'Moved', 'k')
    history.undo({ nodes: after, edges: same })
    expect(history.redo({ nodes: before, edges: same })?.nodes).toBe(after)
    expect(history.canRedo).toBe(false)
  })

  it('folds one gesture into one step', () => {
    let clock = 0
    const history = new History<{ name: string }, unknown>({ now: () => clock })
    // A drag reported ten times in half a second must be a single undo.
    for (let step = 0; step < 10; step += 1) {
      const before = snap(`drag-${step}`)
      clock += 50
      history.record({ nodes: before, edges: same }, { nodes: snap('now'), edges: same }, 'Moved a node', 'drag')
    }
    expect(history.undo({ nodes: snap('now'), edges: same })?.nodes).toEqual(snap('drag-0'))
    expect(history.canUndo).toBe(false)
  })

  it('starts a new step once the gesture is over', () => {
    let clock = 0
    const history = new History<{ name: string }, unknown>({ now: () => clock })
    history.record({ nodes: snap('a'), edges: same }, { nodes: snap('b'), edges: same }, 'Moved a node', 'drag')
    clock += 5_000
    history.record({ nodes: snap('b'), edges: same }, { nodes: snap('c'), edges: same }, 'Moved a node', 'drag')
    expect(history.undo({ nodes: snap('c'), edges: same })?.nodes).toEqual(snap('b'))
    expect(history.undo({ nodes: snap('b'), edges: same })?.nodes).toEqual(snap('a'))
  })

  it('never merges two different kinds of step', () => {
    let clock = 0
    const history = new History<{ name: string }, unknown>({ now: () => clock })
    history.record({ nodes: snap('a'), edges: same }, { nodes: snap('b'), edges: same }, 'Moved a node', 'drag')
    clock += 10
    history.record({ nodes: snap('b'), edges: same }, { nodes: snap('c'), edges: same }, 'Added prompt', 'add:1')
    expect(history.undo({ nodes: snap('c'), edges: same })?.label).toBe('Added prompt')
  })

  it('drops the oldest step past the limit', () => {
    const history = new History<{ name: string }, unknown>({ limit: 3 })
    for (let step = 0; step < 5; step += 1) {
      history.record(
        { nodes: snap(`s${step}`), edges: same },
        { nodes: snap(`s${step + 1}`), edges: same },
        `Step ${step}`,
        `k${step}`,
      )
    }
    let current = snap('s5')
    const labels: Array<string | null> = []
    for (let step = 0; step < 3; step += 1) {
      labels.push(history.undo({ nodes: current, edges: same })?.label ?? null)
    }
    expect(labels).toEqual(['Step 4', 'Step 3', 'Step 2'])
    expect(history.canUndo).toBe(false)
  })

  it('throws away the redo branch when a new step arrives', () => {
    const history = new History<{ name: string }, unknown>()
    history.record({ nodes: snap('a'), edges: same }, { nodes: snap('b'), edges: same }, 'Moved', 'k1')
    history.undo({ nodes: snap('b'), edges: same })
    expect(history.canRedo).toBe(true)
    history.record({ nodes: snap('b'), edges: same }, { nodes: snap('c'), edges: same }, 'Added', 'k2')
    expect(history.canRedo).toBe(false)
  })

  it('forgets everything on clear, used when the document is replaced', () => {
    const history = new History<{ name: string }, unknown>()
    history.record({ nodes: snap('a'), edges: same }, { nodes: snap('b'), edges: same }, 'Moved', 'k')
    history.clear()
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(false)
  })

  it('keeps the oldest snapshot of a gesture, not the newest', () => {
    // The point of coalescing: undo has to land where the drag started, not one
    // mousemove before the end.
    let clock = 0
    const history = new History<{ name: string }, unknown>({ now: () => clock })
    history.record({ nodes: snap('start'), edges: same }, { nodes: snap('mid'), edges: same }, 'Moved a node', 'drag')
    clock += 50
    history.record({ nodes: snap('mid'), edges: same }, { nodes: snap('end'), edges: same }, 'Moved a node', 'drag')
    expect(history.undo({ nodes: snap('end'), edges: same })?.nodes).toEqual(snap('start'))
  })
})
