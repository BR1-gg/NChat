import { describe, expect, it } from 'vitest'
import { migrate } from './migrations'
import { createEmptyDocument } from '../types/document'

describe('document migrations', () => {
  it('migrates a v1 document to v2 and moves note style width', () => {
    const v1 = createEmptyDocument()
    v1.docVersion = 1
    v1.nodes = [{
      id: 'n1',
      type: 'note',
      position: { x: 1, y: 2 },
      style: { width: 400 },
      data: { kind: 'note', text: 'legacy', color: 'default' },
    }]
    const migrated = migrate(v1) as typeof v1
    expect(migrated.docVersion).toBe(2)
    expect(migrated.nodes[0]?.width).toBe(400)
    expect(migrated.nodes[0]?.style?.width).toBeUndefined()
  })
})
