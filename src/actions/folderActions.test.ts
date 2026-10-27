import { describe, expect, it } from 'vitest'
import {
  listNames,
  readDirectory,
  revertWrite,
  writeTextFile,
  ensureWritable,
  type WriteOutcome,
} from './folderActions'
import { FakeDirectory, OVERWRITE, RENAME, SKIP } from '../test/fakedirectory'

const LIMITS = { maxFiles: 50, maxTotalBytes: 1024 * 1024 }

const write = async (
  dir: FakeDirectory,
  name: string,
  text: string,
  policy = RENAME,
): Promise<WriteOutcome> => writeTextFile(dir.asHandle(), name, text, policy)

/**
 * This is the part that touches the user's disk, so it is tested against a
 * directory that records every call. A real disk cannot tell you that no path
 * was ever assembled from segments; this one can.
 */
describe('writeTextFile', () => {
  it('creates the file when it is not there', async () => {
    const dir = new FakeDirectory()
    const result = await write(dir, 'risultato.txt', 'il testo')
    expect(result.status).toBe('written')
    expect(dir.files.get('risultato.txt')).toBe('il testo')
  })

  it('looks the file up as a single name, never as a path', async () => {
    // A path would have to be split and walked. There is no code here that can,
    // and the fake records every lookup so this is checked rather than assumed.
    const dir = new FakeDirectory()
    await write(dir, 'risultato.txt', 'x')
    expect(dir.lookups.length).toBeGreaterThan(0)
    for (const lookup of dir.lookups) {
      expect(lookup).not.toContain('/')
      expect(lookup).not.toContain('\\')
      expect(lookup).not.toBe('..')
    }
  })

  it('renames rather than overwriting even when the caller passes no taken set', async () => {
    // The bug this guards: an earlier version only renamed when the caller
    // supplied the set of occupied names, so the default `rename` policy
    // overwrote silently whenever that set was missing.
    const dir = new FakeDirectory()
    dir.files.set('relazione.txt', 'originale')
    const result = await write(dir, 'relazione.txt', 'nuovo', RENAME)
    expect(result.status).toBe('renamed')
    expect(dir.files.get('relazione.txt')).toBe('originale')
  })

  it('points the undo at the name it actually wrote', async () => {
    const dir = new FakeDirectory()
    dir.files.set('a.txt', 'originale')
    const result = await write(dir, 'a.txt', 'nuovo', RENAME)
    expect(result.undo.path).toBe(result.name)
    expect(result.undo.existed).toBe(false)
  })

  it('records that the file did not exist, so the write can be undone', async () => {
    const dir = new FakeDirectory()
    const result = await write(dir, 'nuovo.txt', 'x')
    expect(result.undo.existed).toBe(false)
    expect(result.undo.previousText).toBeNull()
  })

  it('renames instead of overwriting, and says so', async () => {
    const dir = new FakeDirectory()
    dir.files.set('relazione.txt', 'originale')
    const result = await write(dir, 'relazione.txt', 'nuovo', RENAME)
    expect(result.status).toBe('renamed')
    expect(result.name).toBe('relazione (1).txt')
    expect(dir.files.get('relazione.txt')).toBe('originale')
    expect(dir.files.get('relazione (1).txt')).toBe('nuovo')
  })

  it('overwrites when told to, and remembers the old contents', async () => {
    const dir = new FakeDirectory()
    dir.files.set('relazione.txt', 'originale')
    const result = await write(dir, 'relazione.txt', 'nuovo', OVERWRITE)
    expect(result.status).toBe('written')
    expect(dir.files.get('relazione.txt')).toBe('nuovo')
    expect(result.undo.existed).toBe(true)
    expect(result.undo.previousText).toBe('originale')
  })

  it('skips when told to, and leaves the file exactly as it was', async () => {
    const dir = new FakeDirectory()
    dir.files.set('relazione.txt', 'originale')
    const result = await write(dir, 'relazione.txt', 'nuovo', SKIP)
    expect(result.status).toBe('skipped')
    expect(dir.files.get('relazione.txt')).toBe('originale')
  })

  it('counts up when several renames collide', async () => {
    const dir = new FakeDirectory()
    dir.files.set('a.txt', '1')
    dir.files.set('a (1).txt', '2')
    const result = await write(dir, 'a.txt', '3', RENAME)
    expect(result.name).toBe('a (2).txt')
  })

  it('respects a set of names already taken', async () => {
    // The set stands for names the run is about to use, so a name in it clashes
    // even when nothing is on disk yet.
    const dir = new FakeDirectory()
    const taken = new Set(['a.txt', 'a (1).txt'])
    const result = await writeTextFile(dir.asHandle(), 'a.txt', 'x', RENAME, taken)
    expect(result.name).toBe('a (2).txt')
  })

  it('writes nothing when the disk refuses', async () => {
    const dir = new FakeDirectory()
    dir.failNextWrite = 'Spazio esaurito'
    const result = await write(dir, 'a.txt', 'x')
    expect(result.status).toBe('failed')
    expect(result.reason).toContain('Spazio esaurito')
    // A failed write must leave nothing behind that looks like a result.
    expect(dir.files.get('a.txt')).toBe('')
    expect(result.undo.path).toBe('')
  })

  it('reports how many bytes it wrote', async () => {
    const dir = new FakeDirectory()
    const result = await write(dir, 'a.txt', 'cinque')
    expect(result.bytes).toBe(6)
  })
})

describe('revertWrite', () => {
  it('puts back a file it overwrote', async () => {
    const dir = new FakeDirectory()
    dir.files.set('a.txt', 'originale')
    const written = await write(dir, 'a.txt', 'nuovo', OVERWRITE)
    const reverted = await revertWrite(dir.asHandle(), written.undo)
    expect(reverted).toEqual({ ok: true })
    expect(dir.files.get('a.txt')).toBe('originale')
  })

  it('removes a file it created', async () => {
    const dir = new FakeDirectory()
    const written = await write(dir, 'nuovo.txt', 'x')
    const reverted = await revertWrite(dir.asHandle(), written.undo)
    expect(reverted).toEqual({ ok: true })
    expect(dir.files.has('nuovo.txt')).toBe(false)
  })

  it('removes a renamed file rather than filling it with the old contents', async () => {
    // The bug this guards: a rename writes to a name that did not exist, so its
    // undo must describe an absent file. Reusing the original's `existed` made
    // the revert write the previous text into the renamed file, leaving a copy of
    // the old work behind under a new name.
    const dir = new FakeDirectory()
    dir.files.set('a.txt', 'originale')
    const written = await write(dir, 'a.txt', 'nuovo', RENAME)
    expect(written.name).toBe('a (1).txt')
    await revertWrite(dir.asHandle(), written.undo)
    expect(dir.files.get('a.txt')).toBe('originale')
    expect(dir.files.has('a (1).txt')).toBe(false)
  })

  it('does nothing for a write that never happened', async () => {
    const dir = new FakeDirectory()
    expect(await revertWrite(dir.asHandle(), { path: '', existed: false, previousText: null, previousSize: null })).toEqual({
      ok: true,
    })
    expect(dir.removals).toEqual([])
  })

  it('says so when the file to restore is already gone', async () => {
    const dir = new FakeDirectory()
    const result = await revertWrite(dir.asHandle(), {
      path: ' sparito.txt',
      existed: false,
      previousText: null,
      previousSize: null,
    })
    expect(result.ok).toBe(false)
  })

  it('survives a full round trip', async () => {
    // The promise the Brain makes to the user: a run can be taken back.
    const dir = new FakeDirectory()
    dir.files.set('a.txt', 'prima')
    dir.files.set('b.txt', 'intatto')
    const written = await write(dir, 'a.txt', 'dopo', OVERWRITE)
    const created = await write(dir, 'c.txt', 'nuovo')
    await revertWrite(dir.asHandle(), written.undo)
    await revertWrite(dir.asHandle(), created.undo)
    expect([...dir.files.entries()].sort()).toEqual([
      ['a.txt', 'prima'],
      ['b.txt', 'intatto'],
    ])
  })
})

describe('readDirectory', () => {
  it('reads the text files and refuses the rest, by name', async () => {
    const dir = new FakeDirectory()
    dir.files.set('a.txt', 'uno')
    dir.files.set('b.md', 'due')
    dir.files.set('c.pdf', 'tre')
    const result = await readDirectory(dir.asHandle(), LIMITS)
    expect(result.entries.map((entry) => entry.path)).toEqual(['a.txt', 'b.md'])
    expect(result.refused).toEqual([
      { name: 'c.pdf', reason: expect.stringContaining('text extractor') },
    ])
  })

  it('keeps the count of everything it looked at, not just what it read', async () => {
    const dir = new FakeDirectory()
    dir.files.set('a.txt', 'uno')
    dir.files.set('c.pdf', 'tre')
    const result = await readDirectory(dir.asHandle(), LIMITS)
    expect(result.seen).toBe(2)
  })

  it('stops at the file limit and says the read was incomplete', async () => {
    const dir = new FakeDirectory()
    for (let index = 0; index < 10; index += 1) dir.files.set(`f${index}.txt`, 'x')
    const result = await readDirectory(dir.asHandle(), { maxFiles: 4, maxTotalBytes: LIMITS.maxTotalBytes })
    expect(result.entries).toHaveLength(4)
    expect(result.truncated).toBe(true)
  })

  it('stops at the byte limit and says the read was incomplete', async () => {
    const dir = new FakeDirectory()
    dir.files.set('a.txt', 'x'.repeat(100))
    dir.files.set('b.txt', 'x'.repeat(100))
    const result = await readDirectory(dir.asHandle(), { maxFiles: 50, maxTotalBytes: 150 })
    expect(result.entries).toHaveLength(1)
    expect(result.truncated).toBe(true)
  })

  it('descends into subdirectories and keeps the relative path', async () => {
    const dir = new FakeDirectory()
    const child = new FakeDirectory('src')
    child.files.set('main.ts', 'codice')
    dir.directories.set('src', child)
    const result = await readDirectory(dir.asHandle(), LIMITS)
    expect(result.entries[0]?.path).toBe('src/main.ts')
  })

  it('does not read anything twice when a subdirectory repeats a name', async () => {
    const dir = new FakeDirectory()
    const a = new FakeDirectory('a')
    a.files.set('x.txt', '1')
    const b = new FakeDirectory('b')
    b.files.set('x.txt', '2')
    dir.directories.set('a', a)
    dir.directories.set('b', b)
    const result = await readDirectory(dir.asHandle(), LIMITS)
    expect(result.entries.map((entry) => entry.path)).toEqual(['a/x.txt', 'b/x.txt'])
  })
})

describe('listNames', () => {
  it('lists the files, not the directories', async () => {
    const dir = new FakeDirectory()
    dir.files.set('a.txt', 'x')
    dir.directories.set('sub', new FakeDirectory('sub'))
    expect([...(await listNames(dir.asHandle()))]).toEqual(['a.txt'])
  })

  it('is empty rather than throwing when the folder cannot be listed', async () => {
    const broken = {
      entries: () => {
        throw new DOMException('no', 'NotAllowedError')
      },
    } as unknown as FileSystemDirectoryHandle
    expect([...(await listNames(broken))]).toEqual([])
  })
})

describe('ensureWritable', () => {
  it('passes when the permission is already granted', async () => {
    expect(await ensureWritable(new FakeDirectory().asHandle())).toEqual({ ok: true })
  })

  it('explains what to do when the browser needs a gesture', async () => {
    // The permission exists but the browser wants a click before using it, and
    // the click is the Run button itself.
    const prompting = {
      queryPermission: () => Promise.resolve('prompt'),
      requestPermission: () => Promise.resolve('prompt'),
    } as unknown as FileSystemDirectoryHandle
    const result = await ensureWritable(prompting)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('Run again')
  })

  it('explains a refusal as needing the folder chosen again', async () => {
    const denied = {
      queryPermission: () => Promise.resolve('denied'),
      requestPermission: () => Promise.resolve('denied'),
    } as unknown as FileSystemDirectoryHandle
    const result = await ensureWritable(denied)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('Choose it again')
  })
})
