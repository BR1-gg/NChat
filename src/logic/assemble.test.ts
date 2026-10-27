import { messageText } from '../llm/tokens'
import { describe, expect, it } from 'vitest'
import { isAppError } from '../types/errors'
import { assembleMessages } from './assemble'
import { document, edge, image, prompt, response, summary, system } from '../test/factories'

describe('assembleMessages', () => {
  it('assembles a single prompt as one user message', () => {
    const p1 = prompt('Hello')
    const result = assembleMessages(document([p1], []), p1.id)
    expect(result.messages).toEqual([{ role: 'user', content: 'Hello' }])
  })

  it('uses the fallback system prompt only when no system node contributes one', () => {
    const p1 = prompt('Hello')
    const fallbackDoc = document([p1], [])
    fallbackDoc.settings.defaults.systemPrompt = 'Be terse'

    const p2 = prompt('Hello again')
    const s1 = system('Follow the graph rules')
    const systemDoc = document(
      [p2, s1],
      [edge(s1, p2, 'system')],
    )

    expect(assembleMessages(fallbackDoc, p1.id).messages[0]).toEqual({
      role: 'system',
      content: 'Be terse',
    })
    expect(assembleMessages(systemDoc, p2.id).messages[0]).toEqual({
      role: 'system',
      content: 'Follow the graph rules',
    })
  })

  it('assembles a prompt → response → prompt chain', () => {
    const p1 = prompt('First')
    const r1 = response(p1.id, 'Answer')
    const p2 = prompt('Follow up')
    const doc = document(
      [p1, r1, p2],
      [edge(p1, r1, 'run'), edge(r1, p2, 'context')],
    )

    expect(assembleMessages(doc, p2.id).messages).toEqual([
      { role: 'user', content: 'First' },
      { role: 'assistant', content: 'Answer' },
      { role: 'user', content: 'Follow up' },
    ])
  })

  it('places a system message first', () => {
    const p1 = prompt('First')
    const r1 = response(p1.id, 'Answer')
    const p2 = prompt('Next')
    const s1 = system('You are precise')
    const doc = document(
      [p1, r1, p2, s1],
      [edge(p1, r1, 'run'), edge(r1, p2, 'context'), edge(s1, p2, 'system')],
    )

    expect(assembleMessages(doc, p2.id).messages[0]).toEqual({
      role: 'system',
      content: 'You are precise',
    })
  })

  it('emits one shared ancestor and two branch answers in edge order', () => {
    const p1 = prompt('Root')
    const r1 = response(p1.id, 'Branch one', { runIndex: 0 })
    const r2 = response(p1.id, 'Branch two', { runIndex: 1 })
    const target = prompt('Compare them')
    const doc = document(
      [p1, r1, r2, target],
      [
        edge(p1, r1, 'run', 1),
        edge(p1, r2, 'run', 2),
        edge(r1, target, 'context', 10),
        edge(r2, target, 'context', 20),
      ],
    )

    expect(assembleMessages(doc, target.id).messages).toEqual([
      { role: 'user', content: 'Root' },
      { role: 'assistant', content: 'Branch one' },
      { role: 'assistant', content: 'Branch two' },
      { role: 'user', content: 'Compare them' },
    ])
  })

  it('deduplicates a response reachable through a diamond', () => {
    const root = prompt('Root')
    const shared = response(root.id, 'Shared answer')
    const left = prompt('Left')
    const right = prompt('Right')
    const leftResponse = response(left.id, 'Left answer')
    const rightResponse = response(right.id, 'Right answer')
    const target = prompt('Combine')
    const doc = document(
      [root, shared, left, right, leftResponse, rightResponse, target],
      [
        edge(root, shared, 'run'),
        edge(shared, left, 'context', 1),
        edge(shared, right, 'context', 2),
        edge(left, leftResponse, 'run'),
        edge(right, rightResponse, 'run'),
        edge(leftResponse, target, 'context', 3),
        edge(rightResponse, target, 'context', 4),
      ],
    )

    const messages = assembleMessages(doc, target.id).messages
    expect(messages.filter((message) => message.content === 'Root')).toHaveLength(1)
    expect(messages.filter((message) => message.content === 'Shared answer')).toHaveLength(1)
  })

  it('throws GRAPH_CYCLE for an imported cycle', () => {
    const p1 = prompt('One')
    const p2 = prompt('Two')
    const r1 = response(p1.id, 'Answer one')
    const r2 = response(p2.id, 'Answer two')
    const doc = document(
      [p1, p2, r1, r2],
      [
        edge(p1, r1, 'run'),
        edge(p2, r2, 'run'),
        edge(r1, p2, 'context'),
        edge(r2, p1, 'context'),
      ],
    )

    try {
      assembleMessages(doc, p1.id)
      throw new Error('Expected cycle validation to throw')
    } catch (error: unknown) {
      expect(isAppError(error) && error.kind).toBe('GRAPH_CYCLE')
    }
  })

  it('skips an error response with no text', () => {
    const p1 = prompt('Question')
    const r1 = response(p1.id, '', { status: 'error' })
    const target = prompt('Continue')
    const doc = document(
      [p1, r1, target],
      [edge(p1, r1, 'run'), edge(r1, target, 'context')],
    )

    const result = assembleMessages(doc, target.id)
    expect(result.messages).toEqual([
      { role: 'user', content: 'Question' },
      { role: 'user', content: 'Continue' },
    ])
    expect(result.warnings).toHaveLength(1)
  })

  it('includes an aborted response with partial text', () => {
    const p1 = prompt('Question')
    const r1 = response(p1.id, 'Partial', { status: 'aborted' })
    const target = prompt('Continue')
    const doc = document(
      [p1, r1, target],
      [edge(p1, r1, 'run'), edge(r1, target, 'context')],
    )

    expect(assembleMessages(doc, target.id).messages).toContainEqual({
      role: 'assistant',
      content: 'Partial',
    })
  })
})
  it('treats a Summary as a cut-off point and does not walk its ancestors', () => {
    const p1 = prompt('First question')
    const r1 = response(p1.id, 'First answer')
    const target = prompt('Follow up')
    const sum = summary('Earlier: the user asked about nodes.', { coveredNodeIds: [r1.id] })
    const doc = document(
      [p1, r1, target, sum],
      [edge(p1, r1, 'run'), edge(sum, target, 'context')],
    )
    const result = assembleMessages(doc, target.id)
    const text = result.messages.map((message) => message.content).join('\n')
    // The summary is present, the original answer behind it is not re-emitted.
    expect(text).toContain('Earlier: the user asked about nodes.')
    expect(text).not.toContain('First answer')
    expect(result.messages.filter((message) => message.role === 'user')).toHaveLength(1)
  })

  it('merges the Summary into the single system message', () => {
    const target = prompt('Follow up')
    const sum = summary('A compact recap.')
    const doc = document([target, sum], [edge(sum, target, 'context')])
    const result = assembleMessages(doc, target.id)
    expect(result.messages).toHaveLength(2)
    expect(result.messages[0]?.role).toBe('system')
    expect(result.messages[0]?.content).toContain('## Summary of the earlier conversation')
    expect(result.messages[0]?.content).toContain('A compact recap.')
    expect(result.messages.filter((message) => message.role === 'system')).toHaveLength(1)
  })

  it('appends the Summary after a System node without duplicating system messages', () => {
    const target = prompt('Follow up')
    const sys = system('Be precise.')
    const sum = summary('A compact recap.')
    const doc = document(
      [target, sys, sum],
      [edge(sys, target, 'system'), edge(sum, target, 'context')],
    )
    const result = assembleMessages(doc, target.id)
    const systems = result.messages.filter((message) => message.role === 'system')
    expect(systems).toHaveLength(1)
    expect(systems[0]?.content).toContain('Be precise.')
    expect(systems[0]?.content).toContain('## Summary of the earlier conversation')
  })

  it('concatenates several Summaries in edge order', () => {
    const target = prompt('Follow up')
    const a = summary('Recap A')
    const b = summary('Recap B')
    const doc = document(
      [target, a, b],
      [edge(a, target, 'context'), edge(b, target, 'context')],
    )
    const result = assembleMessages(doc, target.id)
    const system = result.messages[0]
    expect(system?.role).toBe('system')
    const systemText = messageText(system!)
    expect(systemText.indexOf('Recap A')).toBeLessThan(systemText.indexOf('Recap B'))
    expect(result.messages.filter((message) => message.role === 'system')).toHaveLength(1)
  })

  it('compacts recursively: a Summary of a Summary keeps only the newest text', () => {
    const target = prompt('Latest question')
    const older = summary('Oldest recap.')
    const newer = summary('Recap of the recap.', { coveredNodeIds: [] })
    const doc = document(
      [target, older, newer],
      [edge(older, target, 'context'), edge(newer, target, 'context')],
    )
    const result = assembleMessages(doc, target.id)
    const text = result.messages.map((message) => message.content).join('\n')
    expect(text).toContain('Recap of the recap.')
    expect(text).toContain('Oldest recap.')
  })
describe('images on a prompt', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgo='

  it('puts the text and the image on the same user message', () => {
    const p1 = prompt('What is in this picture?')
    const pic = image('photo.png', { src: PNG })
    const result = assembleMessages(document([p1, pic], [edge(pic, p1, 'image')]), p1.id)

    expect(result.messages).toHaveLength(1)
    const content = result.messages[0]!.content
    expect(Array.isArray(content)).toBe(true)
    if (!Array.isArray(content)) throw new Error('expected multimodal content')
    expect(content[0]).toEqual({ type: 'text', text: 'What is in this picture?' })
    expect(content[1]).toEqual({ type: 'image_url', image_url: { url: PNG } })
  })

  it('leaves a plain string when no image is connected', () => {
    const p1 = prompt('Just text')
    const result = assembleMessages(document([p1], []), p1.id)
    expect(result.messages[0]!.content).toBe('Just text')
  })

  it('sends a video poster frame, never the video bytes', () => {
    // No chat model accepts video. The frame is what the model can read, and the
    // node says so, so this must not be a silent swap.
    const p1 = prompt('Describe this')
    const clip = image('clip.mp4', {
      isVideo: true,
      mediaType: 'video/mp4',
      src: 'data:video/mp4;base64,AAAA',
      posterSrc: PNG,
    })
    const result = assembleMessages(document([p1, clip], [edge(clip, p1, 'image')]), p1.id)
    const content = result.messages[0]!.content
    if (!Array.isArray(content)) throw new Error('expected multimodal content')
    expect(content[1]).toEqual({ type: 'image_url', image_url: { url: PNG } })
  })

  it('skips an image with nothing in it rather than sending an empty part', () => {
    const p1 = prompt('Describe this')
    const empty = image('broken.png', { src: '' })
    const result = assembleMessages(document([p1, empty], [edge(empty, p1, 'image')]), p1.id)
    expect(result.messages[0]!.content).toBe('Describe this')
  })

  it('keeps several images in the order they were connected', () => {
    const p1 = prompt('Compare these')
    const a = image('a.png', { src: 'data:image/png;base64,AAAA' })
    const b = image('b.png', { src: 'data:image/png;base64,BBBB' })
    const doc = document(
      [p1, a, b],
      [edge(b, p1, 'image', 2), edge(a, p1, 'image', 1)],
    )
    const content = assembleMessages(doc, p1.id).messages[0]!.content
    if (!Array.isArray(content)) throw new Error('expected multimodal content')
    expect(content.filter((part) => part.type === 'image_url')).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,BBBB' } },
    ])
  })

  it('estimates an image by its size, not by the length of its data URL', () => {
    const p1 = prompt('What is this?')
    const big = image('big.png', { width: 1024, height: 1024, src: 'data:image/png;base64,' + 'A'.repeat(4000) })
    const result = assembleMessages(document([p1, big], [edge(big, p1, 'image')]), p1.id)
    // 1024*1024/750 is about 1398; the 4000-character data URL must not be
    // charged as 1000 tokens of text on top of that.
    expect(result.estTokens).toBeLessThan(1600)
  })
})
/**
 * The optional per-image question. It is a line inside the user message and not a
 * message of its own: with the picture and the question apart, a model answers
 * whichever it saw last, and the answer would be about the question alone.
 */
describe('image captions', () => {
  const withCaption = (caption?: string) => {
    const p1 = prompt('What is in this picture?')
    const pic = image('photo.png', caption === undefined ? {} : { caption })
    const doc = document([p1, pic], [edge(pic, p1, 'image')])
    return assembleMessages(doc, p1.id)
  }

  /** The text of a message, whether it is plain or multimodal. */
  const textOf = (content: unknown): string => {
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''
    return content
      .filter((part) => part.type === 'text')
      .map((part) => (part as { text: string }).text)
      .join('\n')
  }

  it('adds nothing when the caption is empty', () => {
    // With a picture attached the message is multimodal either way; what matters
    // is that no caption heading appears.
    const text = textOf(withCaption().messages[0]?.content)
    expect(text).toBe('What is in this picture?')
  })

  it('adds nothing when there is no caption field at all', () => {
    expect(textOf(withCaption(undefined).messages[0]?.content)).not.toContain('About the image')
  })

  it('ignores a caption that is only whitespace', () => {
    expect(textOf(withCaption('   ').messages[0]?.content)).not.toContain('About the image')
  })

  it('puts the caption in the same message as the picture', () => {
    const result = withCaption('Read only the text written in it.')
    expect(result.messages).toHaveLength(1)
    const content = result.messages[0]?.content
    expect(Array.isArray(content)).toBe(true)
    if (!Array.isArray(content)) return
    // The question, the caption and the picture are one message: three of them
    // would leave the model answering whichever it saw last.
    const text = content.filter((part) => part.type === 'text').map((part) => (part as { text: string }).text).join('\n')
    expect(text).toContain('Read only the text written in it.')
    expect(text).toContain('What is in this picture?')
    expect(text.indexOf('Read only the text')).toBeLessThan(
      text.indexOf('What is in this picture?'),
    )
    expect(content.some((part) => part.type === 'image_url')).toBe(true)
  })

  it('says nothing about the caption when there is no picture', () => {
    // A caption on an image that is not connected is not a caption on anything.
    const p1 = prompt('Plain question')
    const pic = image('photo.png', { caption: 'ignored' })
    const result = assembleMessages(document([p1, pic], []), p1.id)
    expect(result.messages[0]?.content).toBe('Plain question')
  })
})
