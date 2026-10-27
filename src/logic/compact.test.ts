import { describe, expect, it } from 'vitest'
import { buildSummaryData, chunkTranscript, coverageHash, parseCompactCommand, planSummaryRelink, renderTranscript } from './compact'
import { document, edge, prompt, response, summary } from '../test/factories'

describe('compact logic', () => {
  it('parses only a command at the beginning', () => {
    expect(parseCompactCommand('/compact focus on decisions')).toEqual({ instructions: 'focus on decisions' })
    expect(parseCompactCommand('Tell me about /compact')).toBeNull()
    expect(parseCompactCommand('  /compact')).toEqual({ instructions: '' })
  })

  it('renders a transcript and chunks without splitting normal messages', () => {
    const messages = [
      { role: 'user' as const, content: 'one' },
      { role: 'assistant' as const, content: 'two' },
      { role: 'user' as const, content: 'three' },
    ]
    expect(renderTranscript(messages)).toBe('USER: one\n\nASSISTANT: two\n\nUSER: three')
    expect(chunkTranscript(messages, 1000)).toHaveLength(1)
    expect(chunkTranscript(messages, 1).length).toBeGreaterThan(1)
  })

  it('creates stable coverage hashes and summary metadata', () => {
    const messages = [{ role: 'user' as const, content: 'hello' }]
    const first = buildSummaryData(messages, '', { startedAt: 1 }, 'summary')
    const second = buildSummaryData(messages, '', { startedAt: 1 }, 'summary')
    expect(first.coverageHash).toBe(second.coverageHash)
    expect(coverageHash([...messages, { role: 'assistant', content: 'changed' }])).not.toBe(first.coverageHash)
    expect(first.coveredMessageCount).toBe(1)
  })

  it('plans non-destructive relinking and keeps original edge ids', () => {
    const p1 = prompt('Question')
    const r1 = response(p1.id, 'Answer')
    const target = prompt('Follow up')
    const s = summary('Summary text', { coveredNodeIds: [r1.id] })
    const doc = document([p1, r1, target, s], [edge(p1, r1, 'run'), edge(r1, target, 'context')])
    const plan = planSummaryRelink(doc, target.id, s.id, 42)
    expect(plan.removedContextEdgeIds).toHaveLength(1)
    expect(plan.addedContextEdge).toMatchObject({ source: s.id, target: target.id, kind: 'context', createdAt: 42 })
    expect(doc.edges).toHaveLength(2)
  })
})
