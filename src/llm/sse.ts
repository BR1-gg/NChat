import { appError, type AppError } from '../types/errors'
import type { FinishReason } from '../types/document'
import type { Usage } from './types'

export interface SSEChatEvent {
  content: string
  /**
   * Reasoning models such as Qwen3 emit their chain of thought in
   * `delta.reasoning_content` before the visible answer. It is tracked
   * separately so it is never mixed into the answer text.
   */
  reasoning: string
  finishReason?: FinishReason
  usage?: Usage
}

export type SSEEventHandler = (event: SSEChatEvent) => void

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseUsage(value: unknown): Usage | undefined {
  if (!isRecord(value)) return undefined
  const prompt = value.prompt_tokens
  const completion = value.completion_tokens
  const total = value.total_tokens
  if (
    typeof prompt !== 'number' ||
    typeof completion !== 'number' ||
    typeof total !== 'number'
  ) {
    return undefined
  }
  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: total,
  }
}

function parseFinishReason(value: unknown): FinishReason | undefined {
  if (value === 'stop' || value === 'length' || value === 'content_filter') {
    return value
  }
  if (value !== null && value !== undefined) return 'unknown'
  return undefined
}

function parseData(data: string): SSEChatEvent {
  if (data.trim() === '[DONE]') return { content: '', reasoning: '' }

  let parsed: unknown
  try {
    parsed = JSON.parse(data) as unknown
  } catch {
    /*
     * "the server", non "LM Studio".
     *
     * Questo parser non sa quale provider sta rispondendo — non riceve le
     * impostazioni e non deve leggerle — quindi nominare LM Studio qui produce un
     * suggerimento falso con un provider cloud, dove il chiamante aggiunge il
     * provider giusto al messaggio. Il dettaglio utile resta nel `raw`.
     */
    throw appError('BAD_RESPONSE', 'Unexpected response from the server.', {
      hint: 'The server sent streaming data that was not valid JSON. The raw line is in the log.',
      raw: data.slice(0, 500),
    })
  }

  if (!isRecord(parsed)) {
    throw appError('BAD_RESPONSE', 'Unexpected response from the server.', {
      raw: data.slice(0, 500),
    })
  }

  const choices = Array.isArray(parsed.choices) ? parsed.choices : []
  const firstChoice = choices[0]
  const choice = isRecord(firstChoice) ? firstChoice : undefined
  const delta = choice && isRecord(choice.delta) ? choice.delta : undefined
  const content = delta?.content
  const reasoning = delta?.reasoning_content ?? delta?.reasoning
  const message = choice && isRecord(choice.message) ? choice.message : undefined
  const finishReason = parseFinishReason(choice?.finish_reason)
  const usage = parseUsage(parsed.usage)

  return {
    content: typeof content === 'string' ? content : '',
    reasoning: typeof reasoning === 'string' ? reasoning : '',
    // Some servers send the whole payload in `message` even on a stream.
    ...(typeof content !== 'string' && typeof message?.content === 'string'
      ? { content: message.content }
      : {}),
    ...(finishReason ? { finishReason } : {}),
    ...(usage ? { usage } : {}),
  }
}

export class SSEParser {
  private buffer = ''
  private finished = false

  get done(): boolean {
    return this.finished
  }

  push(text: string): void {
    this.buffer += text
    this.drain(false)
  }

  finish(): void {
    this.drain(true)
  }

  private drain(flushRemainder: boolean): void {
    while (true) {
      const separator = /\r?\n\r?\n/.exec(this.buffer)
      if (!separator || separator.index === undefined) break

      const block = this.buffer.slice(0, separator.index)
      this.buffer = this.buffer.slice(separator.index + separator[0].length)
      this.processBlock(block)
      if (this.finished) return
    }

    if (flushRemainder && this.buffer.trim()) {
      const block = this.buffer
      this.buffer = ''
      this.processBlock(block)
    }
  }

  private processBlock(block: string): void {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n')

    if (!data) return
    if (data.trim() === '[DONE]') {
      this.finished = true
      return
    }
    this.onEvent(parseData(data))
  }

  private readonly onEvent: SSEEventHandler

  constructor(onEvent: SSEEventHandler) {
    this.onEvent = onEvent
  }
}

function abortError(): AppError {
  return appError('ABORTED', 'Generation stopped.')
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError()
}

export async function consumeSSE(
  stream: ReadableStream<Uint8Array>,
  onEvent: SSEEventHandler,
  signal: AbortSignal,
  onFirstByte?: () => void,
): Promise<void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder('utf-8')
  const parser = new SSEParser(onEvent)
  let firstByte = false

  try {
    while (!parser.done) {
      throwIfAborted(signal)
      const { done, value } = await reader.read()
      if (done) break
      if (!firstByte) {
        firstByte = true
        onFirstByte?.()
      }
      parser.push(decoder.decode(value, { stream: true }))
    }
    parser.push(decoder.decode())
    parser.finish()
  } catch (error: unknown) {
    if (signal.aborted) throw abortError()
    throw error
  } finally {
    reader.releaseLock()
  }
}

export function consumeSSEText(text: string, onEvent: SSEEventHandler): void {
  const parser = new SSEParser(onEvent)
  parser.push(text)
  parser.finish()
}
