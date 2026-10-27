import { messageText } from '../llm/tokens'
import { describe, expect, it } from 'vitest'
import { document, edge, groupedOutput, prompt, response, set } from '../test/factories'
import { collectAggregate, aggregateReadiness } from '../logic/aggregation/registry'
import { formatAggregate } from '../logic/aggregation/strategies'
import { assembleMessages } from './assemble'

/**
 * A Set groups generated text. Members are answer nodes; prompts may be members
 * only through the explicit "answers of these prompts" path.
 */
describe('Set over answers', () => {
  it('collects the text of the selected response nodes', () => {
    const p1 = prompt('Q1')
    const p2 = prompt('Q2')
    const r1 = response(p1.id, 'Answer one', { status: 'done' })
    const r2 = response(p2.id, 'Answer two', { status: 'done' })
    const doc = document(
      [p1, p2, r1, r2],
      [edge(p1, r1, 'run'), edge(p2, r2, 'run')],
    )
    const grouped = set('Set 1', [r1.id, r2.id])
    const items = collectAggregate(doc, grouped)
    expect(items.map((item) => item.text)).toEqual(['Answer one', 'Answer two'])
    const text = formatAggregate('sections', items, false)
    expect(text).toContain('Answer one')
    expect(text).toContain('Answer two')
    // Each section is titled by the question that produced the answer, so two
    // "Response #1" from different prompts stay distinguishable.
    expect(text).toContain('### Q1')
    expect(text).toContain('### Q2')
    // The question is not repeated as a quoted block unless includePromptText.
    expect(text).not.toContain('> Q1')
    const quoted = formatAggregate('sections', items, true)
    // includePromptText repeats nothing when the label already is the question.
    expect(quoted).not.toContain('> Q1')
  })

  it('reports readiness from the member answers', () => {
    const p1 = prompt('Q1')
    const r1 = response(p1.id, 'Answer one', { status: 'done' })
    const pending = response(p1.id, 'Answer two', { status: 'streaming' })
    const doc = document([p1, r1, pending], [])

    const readySet = set('ready', [r1.id])
    expect(aggregateReadiness(doc, readySet)).toBe('ready')

    const pendingSet = set('pending', [pending.id])
    expect(aggregateReadiness(doc, pendingSet)).toBe('pending')
  })

  it('follows prompts when that path is chosen explicitly, taking latest answer', () => {
    const p1 = prompt('Q1')
    const older = response(p1.id, 'Older answer', { status: 'done', runIndex: 0 })
    const newer = response(p1.id, 'Newer answer', { status: 'done', runIndex: 1 })
    const doc = document(
      [p1, older, newer],
      [edge(p1, older, 'run'), edge(p1, newer, 'run')],
    )
    const grouped = set('from prompts', [p1.id], { pick: 'latest-done' })
    expect(collectAggregate(doc, grouped).map((item) => item.text)).toEqual(['Newer answer'])

    const all = set('from prompts all', [p1.id], { pick: 'all-done' })
    expect(collectAggregate(doc, all).map((item) => item.text)).toEqual([
      'Older answer',
      'Newer answer',
    ])
  })

  it('feeds an aggregated answer block into a single user message downstream', () => {
    const p1 = prompt('Q1')
    const p2 = prompt('Q2')
    const r1 = response(p1.id, 'First result', { status: 'done' })
    const r2 = response(p2.id, 'Second result', { status: 'done' })
    const compare = prompt('Compare these results')
    const grouped = set('Set 1', [r1.id, r2.id], { includePromptText: false })
    const doc = document(
      [p1, p2, r1, r2, compare, grouped],
      [edge(p1, r1, 'run'), edge(p2, r2, 'run'), edge(grouped, compare, 'context')],
    )
    const result = assembleMessages(doc, compare.id)
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]?.role).toBe('user')
    expect(result.messages[0]?.content).toContain('First result')
    const content = messageText(result.messages[0]!)
    expect(content).toContain('Second result')
    expect(content.trimEnd().endsWith('Compare these results')).toBe(true)
  })
})

/**
 * Grouping a selection produces ONE output node that owns the answers. There is
 * no intermediate Set node: the group is the frame around the members plus this
 * single result, which is the only thing to plug into the next node.
 */
describe('grouping a selection of answers', () => {
  const setup = () => {
    const p1 = prompt('Q1')
    const p2 = prompt('Q2')
    const r1 = response(p1.id, 'Answer one', { status: 'done' })
    const r2 = response(p2.id, 'Answer two', { status: 'done' })
    return { p1, p2, r1, r2 }
  }

  it('collects the answers through the output that owns them', () => {
    const { p1, p2, r1, r2 } = setup()
    const group = groupedOutput('Output of 2 answers', [r1.id, r2.id])
    const doc = document(
      [p1, p2, r1, r2, group],
      [edge(p1, r1, 'run'), edge(p2, r2, 'run')],
    )
    expect(collectAggregate(doc, group).map((item) => item.text)).toEqual([
      'Answer one',
      'Answer two',
    ])
    expect(aggregateReadiness(doc, group)).toBe('ready')
  })

  it('reports readiness from the answers, not from the stored text', () => {
    const { p1, p2, r1 } = setup()
    const streaming = response(p2.id, '', { status: 'streaming' })
    const doc = document([p1, p2, r1, streaming], [edge(p1, r1, 'run')])
    const group = groupedOutput('Output', [r1.id, streaming.id])
    expect(aggregateReadiness(doc, group)).toBe('pending')
  })

  it('feeds the grouped text into the next prompt as one block', () => {
    const { p1, p2, r1, r2 } = setup()
    const next = prompt('Compare these results')
    const group = groupedOutput('Output of 2 answers', [r1.id, r2.id], {
      text: 'Answer one\n\n---\n\nAnswer two',
    })
    const doc = document(
      [p1, p2, r1, r2, group, next],
      [edge(p1, r1, 'run'), edge(p2, r2, 'run'), edge(group, next, 'context')],
    )
    const result = assembleMessages(doc, next.id)
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]?.content).toContain('Answer one')
    const content = messageText(result.messages[0]!)
    expect(content).toContain('Answer two')
    expect(content.trimEnd().endsWith('Compare these results')).toBe(true)
  })

  it('flattens a nested group instead of repeating its text', () => {
    const { p1, p2, r1, r2 } = setup()
    const inner = groupedOutput('Inner', [r1.id])
    const outer = groupedOutput('Outer', [inner.id, r2.id])
    const doc = document(
      [p1, p2, r1, r2, inner, outer],
      [edge(p1, r1, 'run'), edge(p2, r2, 'run')],
    )
    expect(collectAggregate(doc, outer).map((item) => item.text)).toEqual([
      'Answer one',
      'Answer two',
    ])
  })

  it('treats a plain output without sources as a single block of text', () => {
    const plain = groupedOutput('Manual', [], { text: 'Hand written result' })
    const doc = document([plain], [])
    expect(collectAggregate(doc, plain).map((item) => item.text)).toEqual(['Hand written result'])
  })
})
