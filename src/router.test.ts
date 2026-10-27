import { describe, expect, it } from 'vitest'
import { parseHash, formatHash } from './router'

describe('hash router', () => {
  it('parses home and workspace routes', () => {
    expect(parseHash('')).toEqual({ name: 'home' })
    expect(parseHash('#/')).toEqual({ name: 'home' })
    expect(parseHash('#/w/abc123')).toEqual({ name: 'workspace', workspaceId: 'abc123' })
  })

  it('formats and escapes ids', () => {
    expect(formatHash({ name: 'home' })).toBe('#/')
    expect(formatHash({ name: 'workspace', workspaceId: 'a b' })).toBe('#/w/a%20b')
  })
})
