import type { WritePolicy } from '../actions/folderActions'

/**
 * An in-memory stand-in for a granted directory.
 *
 * The Brain writes real files on the user's disk, and a test that only checks
 * the pure helpers leaves the part that actually writes untested. This fake is
 * small enough to be obviously correct and records every call, so a test can
 * assert things a real disk cannot tell you: that no path was ever assembled
 * from segments, and that a name with `..` in it never reached a lookup.
 */
export class FakeDirectory {
  /** Matches the real API, where a reader tells files from folders by this. */
  readonly kind = 'directory' as const
  files = new Map<string, string>()
  directories = new Map<string, FakeDirectory>()
  /** Every name passed to `getFileHandle`, in order. */
  readonly lookups: string[] = []
  /** Every name passed to `removeEntry`, in order. */
  readonly removals: string[] = []
  /** Set to make the next write fail, as a full disk would. */
  failNextWrite: string | null = null
  readonly name: string

  constructor(name = 'cartella') {
    this.name = name
  }

  async *entries(): AsyncIterable<[string, FakeEntry]> {
    for (const [fileName, contents] of this.files) {
      yield [fileName, new FakeFileHandle(fileName, contents, this)]
    }
    for (const [dirName, child] of this.directories) {
      yield [dirName, child as unknown as FakeEntry]
    }
  }

  async getFileHandle(fileName: string, options?: { create?: boolean }): Promise<FakeEntry> {
    this.lookups.push(fileName)
    const existing = this.files.get(fileName)
    if (existing === undefined) {
      if (!options?.create) throw new DOMException('Not found', 'NotFoundError')
      this.files.set(fileName, '')
      return new FakeFileHandle(fileName, '', this)
    }
    return new FakeFileHandle(fileName, existing, this)
  }

  async getDirectoryHandle(): Promise<never> {
    throw new DOMException('Directories are not created by the writer', 'NotSupportedError')
  }

  async removeEntry(name: string): Promise<void> {
    this.removals.push(name)
    if (!this.files.delete(name)) throw new DOMException('Not found', 'NotFoundError')
  }

  queryPermission(): Promise<PermissionState> {
    return Promise.resolve('granted')
  }

  requestPermission(): Promise<PermissionState> {
    return Promise.resolve('granted')
  }

  asHandle(): FileSystemDirectoryHandle {
    return this as unknown as FileSystemDirectoryHandle
  }
}

/** What `entries()` yields: a file handle or a directory handle. */
export type FakeEntry = {
  kind: 'file' | 'directory'
  getFile?: () => Promise<File>
  createWritable?: () => Promise<{
    write: (data: string) => Promise<void>
    close: () => Promise<void>
    abort?: () => Promise<void>
  }>
}

class FakeFileHandle implements FakeEntry {
  kind = 'file' as const
  private contents: string
  private readonly fileName: string
  private readonly owner: FakeDirectory

  constructor(fileName: string, contents: string, owner: FakeDirectory) {
    this.fileName = fileName
    this.contents = contents
    this.owner = owner
  }

  async getFile(): Promise<File> {
    return new File([this.contents], this.fileName)
  }

  async createWritable(): Promise<{
    write: (data: string) => Promise<void>
    close: () => Promise<void>
    abort: () => Promise<void>
  }> {
    let staged = ''
    return {
      write: async (data: string) => {
        if (this.owner.failNextWrite) {
          throw new DOMException(this.owner.failNextWrite, 'QuotaExceededError')
        }
        staged = data
      },
      close: async () => {
        this.owner.files.set(this.fileName, staged)
      },
      abort: async () => {
        // Nothing is committed until close, which is the real behaviour too.
      },
    }
  }
}

export const RENAME: WritePolicy = { onExisting: 'rename' }
export const OVERWRITE: WritePolicy = { onExisting: 'overwrite' }
export const SKIP: WritePolicy = { onExisting: 'skip' }
