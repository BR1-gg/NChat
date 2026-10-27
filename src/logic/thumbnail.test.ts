import { describe, expect, it } from 'vitest'
import { document, edge, prompt, response } from '../test/factories'
import { renderThumbnail, thumbnailIsValid } from './thumbnail'

describe('renderThumbnail', () => {
  it('produces a valid, deterministic SVG', () => {
    const p1 = prompt('A')
    const r1 = response(p1.id, 'Answer')
    const doc = document([p1, r1], [edge(p1, r1, 'context')])
    const first = renderThumbnail(doc)
    expect(thumbnailIsValid(first)).toBe(true)
    expect(renderThumbnail(doc)).toBe(first)
  })

  it('draws one rectangle per node and a line per context edge', () => {
    const p1 = prompt('A')
    const p2 = prompt('B')
    const r1 = response(p1.id, 'Answer')
    const doc = document([p1, p2, r1], [edge(p1, r1, 'context'), edge(r1, p2, 'context')])
    const svg = renderThumbnail(doc)
    expect(svg.match(/<rect /g)).toHaveLength(3)
    expect(svg.match(/<line /g)).toHaveLength(2)
  })

  it('skips run edges, which are implicit', () => {
    const p1 = prompt('A')
    const r1 = response(p1.id, 'Answer')
    const svg = renderThumbnail(document([p1, r1], [edge(p1, r1, 'run')]))
    expect(svg).not.toContain('<line ')
  })

  it('returns a valid empty preview for an empty document', () => {
    const svg = renderThumbnail(document([], []))
    expect(thumbnailIsValid(svg)).toBe(true)
    expect(svg).not.toContain('<rect ')
  })

  it('escapes the workspace name in the title', () => {
    const doc = document([prompt('A')], [])
    doc.name = 'A & B <script>'
    expect(renderThumbnail(doc)).toContain('A &amp; B &lt;script&gt;')
  })
})
