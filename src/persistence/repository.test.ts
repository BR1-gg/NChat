import { beforeEach, describe, expect, it } from 'vitest'
import { createEmptyDocument } from '../types/document'
import { DexieWorkspaceRepository } from './repository'
import { db } from './db'
import { WORKSPACE_KEY } from './storage'

async function freshRepository(): Promise<DexieWorkspaceRepository> {
  await db.delete()
  const repository = new DexieWorkspaceRepository()
  await repository.init()
  return repository
}

describe('DexieWorkspaceRepository', () => {
  beforeEach(async () => {
    localStorage.clear()
    await db.delete()
  })

  it('creates, lists, loads and deletes lightweight workspace metadata', async () => {
    const repository = await freshRepository()
    const created = await repository.create('First')
    created.document.name = 'First'
    await repository.save(created.id, created.document, 0)
    await repository.create('Second')

    const meta = await repository.listMeta()
    expect(meta.map((item) => item.name).sort()).toEqual(['First', 'Second'])
    expect(meta.every((item) => item.id === '' ? false : true)).toBe(true)
    expect((await repository.load(created.id))?.document.name).toBe('First')
    await repository.delete(created.id)
    expect(await repository.load(created.id)).toBeNull()
  })

  it('rejects an optimistic save when another window advanced the revision', async () => {
    const repository = await freshRepository()
    const created = await repository.create('Conflict')
    const first = await repository.save(created.id, created.document, 0)
    expect(first.ok).toBe(true)

    const second = await repository.save(created.id, created.document, 0)
    expect(second.ok).toBe(false)
    if (!second.ok && 'conflict' in second) {
      expect(second.currentRevision).toBe(1)
    }
  })

  it('keeps at most five snapshots for a workspace', async () => {
    const repository = await freshRepository()
    const created = await repository.create('Snapshots')
    for (let index = 0; index < 7; index += 1) {
      created.document.name = `Revision ${index}`
      await repository.save(created.id, created.document, index)
      await repository.snapshot(created.id, 'manual')
    }
    expect(await repository.listSnapshots(created.id)).toHaveLength(5)
  })

  it('migrates a legacy localStorage workspace once and keeps a legacy copy', async () => {
    const legacy = createEmptyDocument()
    legacy.docVersion = 1
    legacy.name = 'Legacy graph'
    legacy.settings.defaultModel = 'legacy-model'
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(legacy))

    const repository = await freshRepository()
    const meta = await repository.listMeta()
    expect(meta).toHaveLength(1)
    expect(meta[0]?.name).toBe('Legacy graph')
    expect(localStorage.getItem(`nchat.legacy.${WORKSPACE_KEY}`)).toContain('Legacy graph')
    expect(localStorage.getItem(WORKSPACE_KEY)).toBeNull()
    expect(await repository.getAppState<{ defaultModel: string }>('appSettings')).toMatchObject({
      defaultModel: 'legacy-model',
    })

    const second = new DexieWorkspaceRepository()
    await second.init()
    expect(await second.listMeta()).toHaveLength(1)
  })
})
