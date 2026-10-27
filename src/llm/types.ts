import type { FinishReason, ResolvedGenerationParams } from '../types/document'

export type ChatRole = 'system' | 'user' | 'assistant'

/**
 * One piece of a multimodal message. This is the OpenAI-compatible shape, which
 * is what LM Studio speaks: text parts and inline image parts on one message.
 */
export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export interface ChatMessage {
  role: ChatRole
  /**
   * A plain string, or parts when the message carries an image. A union rather
   * than always-parts so the common case stays a plain string on the wire and in
   * the snapshots.
   */
  content: string | ChatContentPart[]
}

export interface Usage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  temperature?: number
  topP?: number
  maxTokens?: number | null
  stop?: string[]
  stream: boolean
  /** 'none' asks a reasoning model to answer without thinking first. */
  reasoningEffort?: 'none'
}

export type ModelType = 'llm' | 'embedding' | 'other'
export type ModelLoadState = 'loading' | 'loaded' | 'not-loaded' | 'unknown'

export interface ModelInfo {
  id: string
  displayName?: string
  ownedBy?: string
  contextLength?: number
  loadedContextLength?: number
  sizeBytes?: number
  quantization?: string
  architecture?: string
  type: ModelType
  state: ModelLoadState
  instanceIds: string[]
}

export interface ModelCapabilities {
  nativeLoad: boolean
  listsUnloaded: boolean
  level: 'native-v1' | 'beta-v0' | 'openai-compatible'
}

export interface CompletionHandlers {
  onChunk: (delta: string) => void
  /** Chain-of-thought text emitted by reasoning models, kept out of the answer. */
  onReasoning?: (delta: string) => void
  onUsage?: (usage: Usage) => void
}

export interface CompletionResult {
  finishReason: FinishReason
  usage?: Usage
}

export interface LLMClient {
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>
  listAvailableModels(signal?: AbortSignal): Promise<ModelInfo[]>
  loadModel(id: string, signal?: AbortSignal, timeoutMs?: number): Promise<void>
  unloadModel(id: string, signal?: AbortSignal): Promise<void>
  capabilities(): Promise<ModelCapabilities>
  chatCompletionStream(
    request: ChatRequest,
    handlers: CompletionHandlers,
    signal: AbortSignal,
  ): Promise<CompletionResult>
}

export interface WireRequest extends ChatRequest {
  top_p?: number
  max_tokens?: number
  stream_options?: { include_usage: true }
  /** Sent verbatim so a reasoning model can skip the thinking phase. */
  reasoning_effort?: 'none'
}

export function toWireRequest(request: ChatRequest, includeUsage: boolean): WireRequest {
  const wire: WireRequest = {
    model: request.model,
    messages: request.messages,
    stream: request.stream,
  }

  if (typeof request.temperature === 'number') wire.temperature = request.temperature
  if (typeof request.topP === 'number') wire.top_p = request.topP
  if (typeof request.maxTokens === 'number' && request.maxTokens > 0) {
    wire.max_tokens = request.maxTokens
  }
  if (request.stop && request.stop.length > 0) wire.stop = request.stop
  if (request.reasoningEffort) wire.reasoning_effort = request.reasoningEffort
  if (request.stream && includeUsage) {
    wire.stream_options = { include_usage: true }
  }
  return wire
}

export function resolvedParams(params: ResolvedGenerationParams): {
  temperature: number | undefined
  topP: number | undefined
  maxTokens: number | null
  stop: string[] | undefined
} {
  return {
    temperature: params.temperature ?? undefined,
    topP: params.topP ?? undefined,
    maxTokens: params.maxTokens,
    stop: params.stop ?? undefined,
  }
}
