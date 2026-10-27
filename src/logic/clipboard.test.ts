import { describe, expect, it } from 'vitest'
import { document, edge, prompt, response } from '../test/factories'
import { buildClipboardPayload, externalTextToPrompt, materializePaste, parseClipboardText } from './clipboard'

describe('node clipboard', () => {
  it('copies a response with its parent prompt and internal edges only', () => {
    const p1 = prompt('Question')
    const r1 = response(p1.id, 'Answer')
    const other = prompt('Other')
    const doc = document([p1, r1, other], [edge(p1, r1, 'run')])
    const payload = buildClipboardPayload(doc, [r1.id])
    expect(payload.nodes.map((node) => node.id)).toEqual([p1.id, r1.id])
    expect(payload.edges).toHaveLength(1)
    expect(parseClipboardText(JSON.stringify(payload))?.type).toBe('nchat/clipboard')
  })

  it('remaps ids, interrupts active responses, and preserves run edges', () => {
    const p1 = prompt('Question')
    const r1 = response(p1.id, 'Answer', { status: 'streaming' })
    const doc = document([p1, r1], [edge(p1, r1, 'run')])
    const payload = buildClipboardPayload(doc, [r1.id])
    const target = document([], [])
    let counter = 0
    const result = materializePaste(payload, target, { x: 100, y: 200 }, () => `new-${++counter}`)
    expect(result.nodes).toHaveLength(2)
    expect(result.nodes[0]?.position.x).toBe(100)
    expect(result.nodes.find((node) => node.type === 'response')?.data.kind === 'response' && result.nodes.find((node) => node.type === 'response')?.data.status).toBe('interrupted')
    expect(result.edges[0]?.source).not.toBe(p1.id)
    expect(result.edges[0]?.target).toBe(result.nodes[1]?.id)
  })

  it('converts external text into a prompt node', () => {
    const node = externalTextToPrompt('hello', { x: 4, y: 5 })
    expect(node.type).toBe('prompt')
    expect(node.data.kind === 'prompt' && node.data.text).toBe('hello')
  })
})
