import { describe, expect, it } from 'vitest'
import { document, edge, prompt, response } from '../test/factories'
import { topologicalOrder } from './runSelection'
import { readingOrder } from '../logic/setOrder'

describe('multi-selection run order', () => {
  it('runs a prompt after the answer it depends on', () => {
    const p1 = prompt('First')
    const r1 = response(p1.id, 'Answer one')
    const p2 = prompt('Second')
    const doc = document([p2, r1, p1], [edge(p1, r1, 'run'), edge(r1, p2, 'context')])

    // The selection is in visual order (p2 before p1); the queue must not be.
    const ordered = topologicalOrder(doc, [p2.id, p1.id])
    expect(ordered).toEqual([p1.id, p2.id])
  })

  it('keeps independent prompts in the order they were selected', () => {
    const p1 = prompt('A')
    const p2 = prompt('B')
    const p3 = prompt('C')
    const doc = document([p1, p2, p3], [])
    expect(topologicalOrder(doc, [p3.id, p1.id, p2.id])).toEqual([p3.id, p1.id, p2.id])
  })

  it('follows a chain of three prompts', () => {
    const p1 = prompt('One')
    const r1 = response(p1.id, 'A1')
    const p2 = prompt('Two')
    const r2 = response(p2.id, 'A2')
    const p3 = prompt('Three')
    const doc = document(
      [p3, r2, p2, r1, p1],
      [edge(p1, r1, 'run'), edge(r1, p2, 'context'), edge(p2, r2, 'run'), edge(r2, p3, 'context')],
    )
    expect(topologicalOrder(doc, [p3.id, p2.id, p1.id])).toEqual([p1.id, p2.id, p3.id])
  })

  it('ignores ids that are not prompts in the selection', () => {
    const p1 = prompt('A')
    const r1 = response(p1.id, 'Answer')
    const doc = document([p1, r1], [edge(p1, r1, 'run')])
    expect(topologicalOrder(doc, [p1.id, r1.id])).toEqual([p1.id])
  })
})

describe('Set member ordering', () => {
  it('sorts members by y then x', () => {
    const doc = document([prompt('A'), prompt('B'), prompt('C')], [])
    const [a, b, c] = doc.nodes
    if (!a || !b || !c) throw new Error('expected three prompts')
    a.position = { x: 100, y: 50 }
    b.position = { x: 20, y: 10 }
    c.position = { x: 20, y: 10 }
    // b and c share y and x, so the sort must be stable between them.
    expect(readingOrder(doc, [a.id, b.id, c.id])).toEqual([b.id, c.id, a.id])
  })
})
