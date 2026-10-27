import { messageText } from '../../llm/tokens'
import { describe, expect, it } from 'vitest'
import { document, edge, image, output, prompt, response, system } from '../../test/factories'
import { collectAggregate, aggregateDependencies, aggregateReadiness } from './registry'
import { formatAggregate } from './strategies'
import { assembleMessages } from '../assemble'

function setNode(id: string, memberIds: string[]) {
  return {
    id,
    type: 'set' as const,
    position: { x: 900, y: 0 },
    data: {
      kind: 'set' as const,
      title: 'Set',
      memberIds,
      pick: 'latest-done' as const,
      format: 'sections' as const,
      includePromptText: true,
      color: '#8b5cf6',
    },
  }
}

describe('aggregation registry and strategies', () => {
  it('collects the latest done response for a prompt and formats sections', () => {
    const p1 = prompt('Question')
    const r1 = response(p1.id, 'First', { runIndex: 0 })
    const r2 = response(p1.id, 'Latest', { runIndex: 1 })
    const target = prompt('Compare')
    const doc = document(
      [p1, r1, r2, target],
      [edge(p1, r1, 'run'), edge(p1, r2, 'run'), edge(r1, target, 'context'), edge(r2, target, 'context')],
    )
    const items = collectAggregate(doc, p1)
    expect(items.map((item) => item.text)).toEqual(['Latest'])
    expect(formatAggregate('sections', items)).toContain('### Response #2')
    expect(aggregateReadiness(doc, p1)).toBe('ready')
  })

  it('flattens nested sets and reports dependencies', () => {
    const p1 = prompt('One')
    const r1 = response(p1.id, 'Answer one')
    const inner = setNode('inner', [p1.id])
    const outer = setNode('outer', [inner.id])
    const doc = document([p1, r1, inner, outer], [edge(p1, r1, 'run')])
    expect(collectAggregate(doc, outer).map((item) => item.text)).toEqual(['Answer one'])
    expect(aggregateDependencies(doc, outer)).toEqual([r1.id])
  })

  it('detects a Set cycle', () => {
    const first = setNode('first', ['second'])
    const second = setNode('second', ['first'])
    const doc = document([first, second], [])
    expect(() => collectAggregate(doc, first)).toThrow()
  })

  it('merges Set context into one user message before the prompt', () => {
    const p1 = prompt('Original question')
    const r1 = response(p1.id, 'Original answer')
    const target = prompt('Compare these')
    const set = setNode('set', [p1.id])
    const doc = document(
      [p1, r1, target, set],
      [edge(p1, r1, 'run'), edge(set, target, 'context')],
    )
    const result = assembleMessages(doc, target.id)
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]?.role).toBe('user')
    const content = messageText(result.messages[0]!)
    expect(content).toContain('Original answer')
    expect(content.endsWith('Compare these')).toBe(true)
  })

  it('reports missing members instead of producing empty output', () => {
    const set = setNode('set', ['missing'])
    expect(aggregateReadiness(document([set], []), set)).toBe('missing')
  })

  it('keeps a System node separate from a Set message', () => {
    const p1 = prompt('Question')
    const r1 = response(p1.id, 'Answer')
    const target = prompt('Follow up')
    const s1 = system('Be precise')
    const set = setNode('set', [p1.id])
    const doc = document(
      [p1, r1, target, s1, set],
      [edge(p1, r1, 'run'), edge(set, target, 'context'), edge(s1, target, 'system')],
    )
    const result = assembleMessages(doc, target.id)
    expect(result.messages.filter((message) => message.role === 'system')).toHaveLength(1)
    expect(result.messages.filter((message) => message.role === 'user')).toHaveLength(1)
  })
})

/**
 * A group used to be rendered as a list of titled sections. When the answers came
 * from the same question, every section repeated the same `###` heading, which
 * cost tokens and told the model nothing.
 */
describe('plain format', () => {
  const items = [
    { sourceNodeId: 'a', label: 'Same question', text: 'First answer' },
    { sourceNodeId: 'b', label: 'Same question', text: 'Second answer' },
  ]

  it('joins the texts with no titles at all', () => {
    expect(formatAggregate('plain', items)).toBe('First answer\n\nSecond answer')
  })

  it('drops an empty answer instead of leaving a gap', () => {
    const withEmpty = [...items, { sourceNodeId: 'c', label: 'Same question', text: '   ' }]
    expect(formatAggregate('plain', withEmpty)).toBe('First answer\n\nSecond answer')
  })
})

/** A photo can be put in a group, and the model has to actually receive it. */
describe('image members', () => {  it('contributes a marker, not a wall of base64', () => {
    const img = image('photo.png')
    const items = collectAggregate(document([img], []), img)
    expect(items).toHaveLength(1)
    expect(items[0]?.text).toBe('[image: photo.png]')
    expect(items[0]?.text).not.toContain('base64')
  })

  it('says video for a video, since only the poster frame is sent', () => {
    const vid = image('clip.mp4', { isVideo: true, mediaType: 'video/mp4' })
    expect(collectAggregate(document([vid], []), vid)[0]?.text).toBe('[video: clip.mp4]')
  })

  it('is missing until it has a source', () => {
    const img = image('photo.png', { src: '' })
    expect(aggregateReadiness(document([img], []), img)).toBe('missing')
    expect(aggregateReadiness(document([image('ok.png')], []), image('ok.png'))).toBe('ready')
  })

  it('reaches the prompt as a real image part, not only as text', () => {
    const p1 = prompt('What is in these?')
    const r1 = response(p1.id, 'The answer')
    const img = image('photo.png')
    const group = output([r1.id, img.id], { text: 'The answer\n\n[image: photo.png]' })
    const target = prompt('Compare')
    const doc = document(
      [p1, r1, img, group, target],
      [edge(p1, r1, 'run'), edge(group, target, 'context')],
    )
    const result = assembleMessages(doc, target.id)
    const content = result.messages.at(-1)?.content
    expect(Array.isArray(content)).toBe(true)
    if (!Array.isArray(content)) return
    const imageParts = content.filter((part) => part.type === 'image_url')
    expect(imageParts).toHaveLength(1)
    expect(imageParts[0]?.type).toBe('image_url')
    // Text and picture on the same message, or the model answers only the picture.
    expect(content.some((part) => part.type === 'text')).toBe(true)
  })

  it('uses the poster frame of a grouped video, not the clip', () => {
    const vid = image('clip.mp4', {
      isVideo: true,
      mediaType: 'video/mp4',
      src: 'data:video/mp4;base64,AAAA',
      posterSrc: 'data:image/png;base64,POSTER',
    })
    const group = output([vid.id], { text: '[video: clip.mp4]' })
    const target = prompt('Describe it')
    const doc = document([vid, group, target], [edge(group, target, 'context')])
    const content = assembleMessages(doc, target.id).messages.at(-1)?.content
    expect(JSON.stringify(content)).toContain('POSTER')
    expect(JSON.stringify(content)).not.toContain('AAAA')
  })
})
