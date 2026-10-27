import { describe, expect, it } from 'vitest'
import { filterAndSortWorkspaces, nextUntitledName, relativeTime } from './home'

const meta = (name: string, values: Partial<{ updatedAt: number; lastOpenedAt: number; sizeBytes: number }> = {}) => ({
  id: name,
  name,
  createdAt: 0,
  updatedAt: values.updatedAt ?? 0,
  lastOpenedAt: values.lastOpenedAt ?? 0,
  nodeCount: 0,
  edgeCount: 0,
  sizeBytes: values.sizeBytes ?? 0,
  docVersion: 2,
  revision: 0,
})

describe('home helpers', () => {
  it('creates progressive untitled names', () => {
    expect(nextUntitledName([])).toBe('Untitled workspace')
    expect(nextUntitledName(['Untitled workspace'])).toBe('Untitled workspace 2')
    expect(nextUntitledName(['Untitled workspace', 'Untitled workspace 2'])).toBe('Untitled workspace 3')
  })

  it('filters and sorts metadata without loading documents', () => {
    const items = [meta('Beta', { lastOpenedAt: 2, sizeBytes: 10 }), meta('Alpha', { lastOpenedAt: 3, sizeBytes: 30 })]
    expect(filterAndSortWorkspaces(items, 'a', 'name').map((item) => item.name)).toEqual(['Alpha', 'Beta'])
    expect(filterAndSortWorkspaces(items, '', 'size')[0]?.name).toBe('Alpha')
    expect(relativeTime(Date.now() - 3_600_000)).toContain('h')
  })
})
