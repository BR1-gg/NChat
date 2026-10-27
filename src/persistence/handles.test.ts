import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from './db'
import {
  canRead,
  canWrite,
  forgetDirectory,
  loadDirectory,
  permissionOf,
  requestPermission,
  saveDirectory,
  supportsDirectories,
} from './handles'

/**
 * A directory handle is a live capability, and that is why it has its own table.
 * Put it in the document and `JSON.stringify` reduces it to `{}`, and the export
 * carries a node that looks authorised and is not.
 *
 * **What cannot be tested here.** A real `FileSystemDirectoryHandle` is stored by
 * IndexedDB through a browser-internal serialisation, and a plain object cannot
 * imitate it: a function is not cloneable, so any stand-in with an `entries`
 * method is rejected by `DataCloneError` before the code under test ever runs.
 * The accept branch is therefore exercised by stubbing the row that comes back,
 * which tests the guard itself, and the rows that are written are checked on the
 * real database.
 */

/** Cloneable, and therefore what a handle wrongly put in a document looks like. */
const plainData = (name: string) => ({ kind: 'directory', name }) as unknown as FileSystemDirectoryHandle

/** A real handle's shape, used only where nothing is cloned. */
const shaped = (name: string, state: PermissionState = 'granted') =>
  ({
    kind: 'directory',
    name,
    entries: () => (async function* () { /* empty */ })(),
    queryPermission: () => Promise.resolve(state),
    requestPermission: () => Promise.resolve('granted'),
  }) as unknown as FileSystemDirectoryHandle

const stubRow = (row: unknown): void => {
  vi.spyOn(db.directories, 'get').mockResolvedValue(row as never)
}

describe('directory handles', () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    await db.directories.clear()
  })

  it('writes the row under the node, with the path as text', async () => {
    // The path is what the document and the export carry, because a handle is not
    // serialisable and must never be asked to be.
    await saveDirectory('n1', plainData('ingresso'), 'ingresso')
    const row = await db.directories.get('n1')
    expect(row?.path).toBe('ingresso')
    expect(row?.grantedAt).toBeGreaterThan(0)
  })

  it('keys the row by node, so two folders do not collide', async () => {
    await saveDirectory('n1', plainData('a'), 'a')
    await saveDirectory('n2', plainData('b'), 'b')
    expect((await db.directories.get('n1'))?.path).toBe('a')
    expect((await db.directories.get('n2'))?.path).toBe('b')
  })

  it('accepts a value that really is a handle', async () => {
    stubRow({ nodeId: 'n1', handle: shaped('ingresso'), path: 'ingresso', grantedAt: 1 })
    const stored = await loadDirectory('n1')
    expect(stored?.path).toBe('ingresso')
    expect(stored?.handle.name).toBe('ingresso')
  })

  it('reports nothing for a node that was never granted', async () => {
    stubRow(undefined)
    expect(await loadDirectory('missing')).toBeNull()
  })

  it('forgets a grant, so a folder can be ungranted', async () => {
    await saveDirectory('n1', plainData('a'), 'a')
    await forgetDirectory('n1')
    expect(await db.directories.get('n1')).toBeUndefined()
  })

  it('treats a value that came back as plain data as no handle at all', async () => {
    // The failure mode this guards: a handle that went through a JSON round trip
    // keeps its name and loses every ability, and a node that believes it still
    // holds a grant is worse than one that admits it does not.
    await db.directories.put({
      nodeId: 'n1',
      handle: plainData('rotto'),
      path: 'rotto',
      grantedAt: 1,
    })
    expect(await loadDirectory('n1')).toBeNull()
  })

  it('refuses a value that is not a directory at all', async () => {
    await db.directories.put({
      nodeId: 'n2',
      handle: { kind: 'file', name: 'x' } as unknown as FileSystemDirectoryHandle,
      path: 'x',
      grantedAt: 1,
    })
    expect(await loadDirectory('n2')).toBeNull()
  })

  it('refuses a value that is not an object', async () => {
    stubRow({ nodeId: 'n3', handle: 'nope', path: 'nope', grantedAt: 1 })
    expect(await loadDirectory('n3')).toBeNull()
  })
})

describe('permission', () => {
  it('reports granted without asking again', async () => {
    expect(await permissionOf(shaped('a', 'granted'), 'readwrite')).toBe('granted')
    expect(await canRead(shaped('a', 'granted'))).toBe(true)
    expect(await canWrite(shaped('a', 'granted'))).toBe(true)
  })

  it('reports prompt, which is the case that needs a click', async () => {
    // This is why the permission request lives on the Run button: that button is
    // the gesture the browser asks for.
    expect(await canWrite(shaped('a', 'prompt'))).toBe(false)
    expect(await requestPermission(shaped('a', 'prompt'), 'readwrite')).toBe('granted')
  })

  it('reports denied as denied rather than throwing', async () => {
    const denying = {
      kind: 'directory',
      name: 'a',
      queryPermission: () => Promise.resolve('denied'),
      requestPermission: () => Promise.reject(new Error('no')),
    } as unknown as FileSystemDirectoryHandle
    expect(await permissionOf(denying, 'read')).toBe('denied')
    expect(await requestPermission(denying, 'read')).toBe('denied')
  })

  it('treats a handle with no permission API as usable', async () => {
    // The older handle model has nothing to ask about, so refusing would throw
    // away grants that still work.
    const plain = { kind: 'directory', name: 'x' } as unknown as FileSystemDirectoryHandle
    expect(await permissionOf(plain, 'read')).toBe('unsupported')
    expect(await canRead(plain)).toBe(true)
  })
})

describe('supportsDirectories', () => {
  it('answers from the environment rather than guessing', () => {
    // The test environment is not a browser, so this documents the branch
    // instead of asserting a value that would differ in Edge.
    expect(typeof supportsDirectories()).toBe('boolean')
  })
})
