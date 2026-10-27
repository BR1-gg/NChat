import { DOC_VERSION } from '../types/document'

type UnknownRecord = Record<string, unknown>

export type Migration = (document: UnknownRecord) => UnknownRecord

function asRecord(value: unknown): UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {}
}

const MIGRATIONS: Record<number, Migration> = {
  1: (document) => {
    const nodes = Array.isArray(document.nodes) ? document.nodes : []
    const migratedNodes = nodes.map((raw) => {
      const node = asRecord(raw)
      const style = asRecord(node.style)
      const legacyWidth = typeof style.width === 'number' ? style.width : undefined
      const { style: _style, ...withoutStyle } = node
      return {
        ...withoutStyle,
        ...(legacyWidth && typeof node.width !== 'number' ? { width: legacyWidth } : {}),
        ...(Object.keys(style).some((key) => key !== 'width') ? { style } : {}),
      }
    })
    return {
      ...document,
      docVersion: 2,
      nodes: migratedNodes,
    }
  },
}

export function migrate(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
  let document = value as UnknownRecord
  const visited = new Set<UnknownRecord>()

  while (typeof document.docVersion === 'number' && document.docVersion < DOC_VERSION) {
    const migration = MIGRATIONS[document.docVersion]
    if (!migration || visited.has(document)) break
    visited.add(document)
    document = migration(document)
  }
  return document
}
