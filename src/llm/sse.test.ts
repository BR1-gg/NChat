import { describe, expect, it, vi } from 'vitest'
import { isAppError } from '../types/errors'
import { consumeSSE, consumeSSEText, type SSEChatEvent } from './sse'

function streamFromChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}

describe('SSE parser', () => {
  it('handles arbitrary UTF-8 byte boundaries, CRLF, null content, usage, and [DONE]', async () => {
    const bytes = new TextEncoder().encode(
      ': keepalive\r\n\r\n' +
        'data: {"choices":[{"delta":{"role":"assistant","content":""},"finish_reason":null}]}\r\n\r\n' +
        'data: {"choices":[{"delta":{"content":"Ciao 🌍"},"finish_reason":null}]}\r\n\r\n' +
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\r\n\r\n' +
        'data: {"choices":[],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6}}\r\n\r\n' +
        'data: [DONE]\r\n\r\n',
    )
    const chunks = [bytes.slice(0, 57), bytes.slice(57, 59), bytes.slice(59)]
    const events: SSEChatEvent[] = []

    await consumeSSE(streamFromChunks(chunks), (event) => events.push(event), new AbortController().signal)

    expect(events.map((event) => event.content).join('')).toBe('Ciao 🌍')
    expect(events.at(-1)?.usage?.totalTokens).toBe(6)
    expect(events.some((event) => event.finishReason === 'stop')).toBe(true)
  })

  it('keeps reasoning_content separate from the visible answer', () => {
    const events: SSEChatEvent[] = []
    consumeSSEText(
      'data: {"choices":[{"delta":{"reasoning_content":"Thinking"},"finish_reason":null}]}\n\n' +
        'data: {"choices":[{"delta":{"reasoning_content":" hard"},"finish_reason":null}]}\n\n' +
        'data: {"choices":[{"delta":{"content":"42"},"finish_reason":null}]}\n\n' +
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
        'data: [DONE]\n\n',
      (event) => events.push(event),
    )
    expect(events.map((event) => event.reasoning).join('')).toBe('Thinking hard')
    expect(events.map((event) => event.content).join('')).toBe('42')
  })

  it('joins multiple data lines and ignores event/id fields', () => {
    const events: SSEChatEvent[] = []
    consumeSSEText(
      'id: 1\nevent: message\ndata: {"choices":\ndata: [{"delta":{"content":"ok"},"finish_reason":null}]}\n\n',
      (event) => events.push(event),
    )
    expect(events[0]?.content).toBe('ok')
  })

  it('maps malformed JSON to BAD_RESPONSE with the raw line', () => {
    try {
      consumeSSEText('data: {not-json}\n\n', () => undefined)
      throw new Error('Expected parser to throw')
    } catch (error: unknown) {
      expect(isAppError(error) && error.kind).toBe('BAD_RESPONSE')
      expect(isAppError(error) && error.raw).toContain('{not-json}')
    }
  })

  it('throws ABORTED when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      consumeSSE(streamFromChunks([]), () => undefined, controller.signal),
    ).rejects.toMatchObject({ kind: 'ABORTED' })
  })

  it('calls the first-byte callback once', async () => {
    const onFirstByte = vi.fn()
    const bytes = new TextEncoder().encode('data: [DONE]\n\n')
    await consumeSSE(
      streamFromChunks([bytes]),
      () => undefined,
      new AbortController().signal,
      onFirstByte,
    )
    expect(onFirstByte).toHaveBeenCalledOnce()
  })
})
