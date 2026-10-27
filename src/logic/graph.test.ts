import { describe, expect, it } from 'vitest'
import { document, edge, image, prompt, response } from '../test/factories'
import { EDGE_STYLES, type EdgeKind } from '../types/document'
import { connectionKind, isAppEdge, nextRunIndex, siblingsOf, wouldCreateCycle } from './graph'

describe('graph helpers', () => {
  it('rejects direct, transitive, and self connections', () => {
    const p1 = prompt('One')
    const r1 = response(p1.id, 'Answer')
    const p2 = prompt('Two')
    const independent = prompt('Independent')
    const doc = document(
      [p1, r1, p2, independent],
      [edge(p1, r1, 'run'), edge(r1, p2, 'context')],
    )

    expect(wouldCreateCycle(doc, p2.id, p1.id)).toBe(true)
    expect(wouldCreateCycle(doc, p1.id, p1.id)).toBe(true)
    expect(wouldCreateCycle(doc, independent.id, r1.id)).toBe(false)
  })

  it('sorts siblings and never reuses the previous run index', () => {
    const p1 = prompt('Question')
    const r1 = response(p1.id, 'One', { runIndex: 1 })
    const r2 = response(p1.id, 'Two', { runIndex: 0 })
    p1.data.runCount = 2
    const doc = document(
      [p1, r1, r2],
      [edge(p1, r2, 'run', 2), edge(p1, r1, 'run', 1)],
    )

    expect(siblingsOf(doc, p1.id).map((node) => node.id)).toEqual([r2.id, r1.id])
    expect(nextRunIndex(doc, p1.id)).toBe(2)
  })
})
describe('edge kinds stay in sync', () => {
  /**
   * `addConnection` returns whatever `connectionKind` produced, and treats a
   * non-kind value as an error. A kind missing from `isAppEdge` therefore fails
   * silently: the connection is refused and the reason looks like a plain
   * string. These cases keep the three lists from drifting apart.
   */
  const kinds: EdgeKind[] = ['run', 'context', 'system', 'display', 'image', 'flow']

  it('recognises every kind the type declares', () => {
    for (const kind of kinds) expect(isAppEdge(kind)).toBe(true)
  })

  it('has a style for every kind, or edges render unstyled', () => {
    for (const kind of kinds) expect(EDGE_STYLES[kind]).toBeDefined()
  })

  it('refuses a value that is not a kind', () => {
    expect(isAppEdge({ kind: 'INVALID_CONNECTION', message: 'no' } as never)).toBe(false)
  })
})

/**
 * The two edges that move files rather than text. Getting these wrong is quiet:
 * `addConnection` treats a non-kind as an error, so a rule that forgets to return
 * a kind refuses the connection with a message that looks like any other.
 */
describe('folder and Brain edges', () => {
  const brainNode = (id: string) => ({
    id,
    type: 'brain' as const,
    position: { x: 0, y: 0 },
    data: {
      kind: 'brain' as const,
      instruction: 'traduci',
      model: '',
      onExisting: 'rename' as const,
      run: { status: 'idle' as const, total: 0, done: 0, log: [], undo: [] },
    },
  })

  const folderNode = (id: string, name: string) => ({
    id,
    type: 'folder' as const,
    position: { x: 0, y: 0 },
    data: {
      kind: 'folder' as const,
      name,
      fileCount: 0,
      totalBytes: 0,
      text: '',
      truncated: false,
      refused: [],
    },
  })

  it('connects a folder to a Brain to read from it', () => {
    const folder = folderNode('f1', 'ingresso')
    const brain = brainNode('b1')
    const doc = document([folder, brain], [])
    expect(
      connectionKind(doc, {
        sourceId: folder.id,
        sourceHandle: 'out',
        targetId: brain.id,
        targetHandle: 'in',
      }),
    ).toBe('flow')
  })

  it('connects a Brain to a folder to write into it', () => {
    const brain = brainNode('b1')
    const folder = folderNode('f1', 'uscita')
    const doc = document([brain, folder], [])
    expect(
      connectionKind(doc, {
        sourceId: brain.id,
        sourceHandle: 'out',
        targetId: folder.id,
        targetHandle: 'in',
      }),
    ).toBe('flow')
  })

  it('refuses a prompt wired to a folder writing handle', () => {
    // This is the edge that would let a prompt reach the disk. It must not exist.
    const target = prompt('Leggi tutto')
    const folder = folderNode('f1', 'uscita')
    const doc = document([target, folder], [])
    const kind = connectionKind(doc, {
      sourceId: target.id,
      sourceHandle: 'out',
      targetId: folder.id,
      targetHandle: 'in',
    })
    expect(isAppEdge(kind)).toBe(false)
  })

  it('refuses a Brain wired to a prompt', () => {
    // A Brain is not a source of context text. It has no context handle at all.
    const brain = brainNode('b1')
    const target = prompt('Riassumi')
    const doc = document([brain, target], [])
    const kind = connectionKind(doc, {
      sourceId: brain.id,
      sourceHandle: 'out',
      targetId: target.id,
      targetHandle: 'context',
    })
    expect(isAppEdge(kind)).toBe(false)
  })

  it('still lets a folder feed a prompt as text', () => {
    const folder = folderNode('f1', 'documenti')
    const target = prompt('Riassumi')
    const doc = document([folder, target], [])
    expect(
      connectionKind(doc, {
        sourceId: folder.id,
        sourceHandle: 'out',
        targetId: target.id,
        targetHandle: 'context',
      }),
    ).toBe('context')
  })
})

describe('image edges', () => {
  it('connects an image to the image input of a prompt', () => {
    const p1 = prompt('What is this?')
    const pic = image('photo.png')
    const doc = document([p1, pic], [])
    expect(
      connectionKind(doc, {
        sourceId: pic.id,
        sourceHandle: 'out',
        targetId: p1.id,
        targetHandle: 'image',
      }),
    ).toBe('image')
  })

  it('refuses an image on the text context input', () => {
    // Context is text. An image there would end up inside the message as a
    // string, which is worse than a clear refusal.
    const p1 = prompt('What is this?')
    const pic = image('photo.png')
    const doc = document([p1, pic], [])
    const result = connectionKind(doc, {
      sourceId: pic.id,
      sourceHandle: 'out',
      targetId: p1.id,
      targetHandle: 'context',
    })
    expect(isAppEdge(result as never)).toBe(false)
  })

  it('refuses an image feeding anything but a prompt', () => {
    const pic = image('photo.png')
    const other = image('other.png')
    const doc = document([pic, other], [])
    const result = connectionKind(doc, {
      sourceId: pic.id,
      sourceHandle: 'out',
      targetId: other.id,
      targetHandle: 'image',
    })
    expect(isAppEdge(result as never)).toBe(false)
  })
})