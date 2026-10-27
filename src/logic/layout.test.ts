import { describe, expect, it } from 'vitest'
import { document, edge, prompt, response } from '../test/factories'
import { placeResponseNode } from './layout'

describe('placeResponseNode', () => {
  it('aligns the first response with its prompt', () => {
    const p1 = prompt('Question', 'p1', { x: 10, y: 20 })
    expect(placeResponseNode(document([p1], []), p1.id)).toEqual({ x: 420, y: 20 })
  })

  it('places a second response below the previous branch subtree', () => {
    const p1 = prompt('Question', 'p1', { x: 0, y: 0 })
    const r1 = response(p1.id, 'Answer', {}, 'r1')
    r1.position = { x: 420, y: 0 }
    const followUp = prompt('Follow up', 'p2', { x: 840, y: 0 })
    const doc = document(
      [p1, r1, followUp],
      [edge(p1, r1, 'run'), edge(r1, followUp, 'context')],
    )

    expect(placeResponseNode(doc, p1.id).y).toBeGreaterThan(0)
  })
})
