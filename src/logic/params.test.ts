import { describe, expect, it } from 'vitest'
import { buildChatRequest, resolveParams } from './params'
import { toWireRequest } from '../llm/types'
import { cloneSettings, DEFAULT_SETTINGS } from '../types/settings'
import type { RequiredGenerationParams } from './params-types'

const params: RequiredGenerationParams = {
  temperature: 0.7,
  topP: 0.9,
  maxTokens: 512,
  stop: null,
}

/**
 * Generation parameters are workspace-wide: a prompt has no per-node override
 * any more, so the values always come from the global defaults.
 */
describe('global generation parameters', () => {
  it('falls back to the settings for every unset value', () => {
    const settings = cloneSettings(DEFAULT_SETTINGS)
    settings.defaults.temperature = 0.3
    settings.defaults.topP = 0.8
    settings.defaults.maxTokens = 1024
    const resolved = resolveParams(
      { temperature: null, topP: null, maxTokens: null, stop: null },
      settings,
    )
    expect(resolved).toMatchObject({ temperature: 0.3, topP: 0.8, maxTokens: 1024 })
  })
})

/**
 * Thinking is the one per-prompt switch. It is sent as `reasoning_effort:
 * 'none'`, which LM Studio honours; `chat_template_kwargs.enable_thinking`
 * is ignored by the server, so it is not sent.
 */
describe('thinking switch', () => {
  it('sends no reasoning_effort while thinking is on', () => {
    const request = buildChatRequest('m', [{ role: 'user', content: 'x' }], params, true, true)
    expect(request.reasoningEffort).toBeUndefined()
    expect(toWireRequest(request, true).reasoning_effort).toBeUndefined()
  })

  it('sends reasoning_effort: none while thinking is off', () => {
    const request = buildChatRequest('m', [{ role: 'user', content: 'x' }], params, true, false)
    expect(request.reasoningEffort).toBe('none')
    expect(toWireRequest(request, true).reasoning_effort).toBe('none')
  })

  it('defaults to thinking on when the flag is absent', () => {
    const request = buildChatRequest('m', [{ role: 'user', content: 'x' }], params, false)
    expect(request.reasoningEffort).toBeUndefined()
  })
})
