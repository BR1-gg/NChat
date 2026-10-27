import type { ChatMessage } from '../llm/types'
import type { ResolvedGenerationParams } from '../types/document'

/**
 * "Make the output shorter", as a lever on token spending.
 *
 * Two things are needed, and only one of them is the cap. A `max_tokens` ceiling
 * on its own truncates the answer mid-sentence: the model was going to write an
 * essay and simply stops. The instruction is what actually makes it write less,
 * and the cap is what stops a model that ignores the instruction from spending
 * the whole budget. Neither alone does the job.
 */

/** The ceiling applied when a prompt asks for a short answer. */
export const CONCISE_MAX_TOKENS = 400

export const CONCISE_INSTRUCTION = [
  'Answer briefly.',
  'Give only what was asked: no preamble, no closing summary, no restating the question.',
  'Prefer a sentence or a short list over an essay.',
].join(' ')

/** What the chip says it does, so the node never lies about the effect. */
export const CONCISE_SUMMARY = `at most ${CONCISE_MAX_TOKENS} tokens, with a brevity instruction`

/**
 * Returns the request with the brevity instruction in place and the ceiling
 * applied. The caller's arrays and objects are not modified.
 */
export function makeConcise(
  messages: ChatMessage[],
  params: ResolvedGenerationParams,
): { messages: ChatMessage[]; params: ResolvedGenerationParams } {
  const next = messages.map((message) => ({ ...message }))
  const firstSystem = next.find((message) => message.role === 'system')
  // The content type is a union, and a system message is always plain text here,
  // but normalising keeps a stray array from being interpolated as "a,b".
  if (firstSystem) {
    const existing = typeof firstSystem.content === 'string' ? firstSystem.content : ''
    firstSystem.content = `${existing}\n\n${CONCISE_INSTRUCTION}`.trim()
  } else {
    next.unshift({ role: 'system', content: CONCISE_INSTRUCTION })
  }
  return {
    messages: next,
    // Only ever lowers the ceiling. A prompt that was already capped tighter than
    // this keeps its own limit, and a null ceiling is resolved elsewhere.
    params: {
      ...params,
      maxTokens:
        params.maxTokens === null ? CONCISE_MAX_TOKENS : Math.min(params.maxTokens, CONCISE_MAX_TOKENS),
    },
  }
}
