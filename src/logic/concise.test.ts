import { describe, expect, it } from 'vitest'
import { CONCISE_INSTRUCTION, CONCISE_MAX_TOKENS, makeConcise } from './concise'

const params = { temperature: 0.7, topP: 1, maxTokens: 4096, stop: null }

describe('makeConcise', () => {
  it('adds the instruction when there is no system message', () => {
    const result = makeConcise([{ role: 'user', content: 'ciao' }], params)
    expect(result.messages[0]?.role).toBe('system')
    expect(result.messages[0]?.content).toBe(CONCISE_INSTRUCTION)
    expect(result.messages).toHaveLength(2)
  })

  it('merges into the existing system message instead of adding a second one', () => {
    const result = makeConcise(
      [
        { role: 'system', content: 'Sei un ingegnere.' },
        { role: 'user', content: 'ciao' },
      ],
      params,
    )
    expect(result.messages.filter((message) => message.role === 'system')).toHaveLength(1)
    expect(result.messages[0]?.content).toContain('Sei un ingegnere.')
    expect(result.messages[0]?.content).toContain(CONCISE_INSTRUCTION)
  })

  it('lowers the output ceiling', () => {
    expect(makeConcise([], params).params.maxTokens).toBe(CONCISE_MAX_TOKENS)
  })

  it('never raises a ceiling that was already lower', () => {
    const result = makeConcise([], { ...params, maxTokens: 50 })
    expect(result.params.maxTokens).toBe(50)
  })

  it('copes with a null ceiling, which means "use the default"', () => {
    expect(makeConcise([], { ...params, maxTokens: null }).params.maxTokens).toBe(CONCISE_MAX_TOKENS)
  })

  it('does not modify what the caller passed in', () => {
    // The assembled messages are also the ones kept in the snapshot, so mutating
    // them here would rewrite history.
    const messages = [{ role: 'user' as const, content: 'ciao' }]
    const before = JSON.stringify(messages)
    makeConcise(messages, params)
    expect(JSON.stringify(messages)).toBe(before)
    expect(params.maxTokens).toBe(4096)
  })

  it('survives a system message whose content is a multimodal array', () => {
    // The content type is a union; interpolating an array would produce "a,b".
    const result = makeConcise(
      [
        { role: 'system', content: [{ type: 'text', text: 'preciso' }] },
        { role: 'user', content: 'ciao' },
      ],
      params,
    )
    expect(typeof result.messages[0]?.content).toBe('string')
  })
})
