import { describe, expect, it } from 'vitest'
import { nextActiveTab } from './tabsStore'

describe('tab reducer helper', () => {
  it('activates the right neighbour, then the left, then home', () => {
    const tabs = ['a', 'b', 'c']
    expect(nextActiveTab(tabs, 'b', 'b')).toBe('c')
    expect(nextActiveTab(tabs, 'c', 'c')).toBe('b')
    expect(nextActiveTab(tabs, 'a', 'a')).toBe('b')
    expect(nextActiveTab(['a'], 'a', 'a')).toBe('home')
  })
})
