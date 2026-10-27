import {
  checkTextFile,
  MAX_TEXT_CHARS,
  type FileKind,
  type FolderResult,
} from '../logic/filetext'
import { safeRelativePath } from '../logic/paths'
import {
  canRead,
  canWrite,
  forgetDirectory,
  loadDirectory,
  requestPermission,
  saveDirectory,
  supportsDirectories,
} from '../persistence/handles'

/**
 * Reading and writing inside a directory the user granted.
 *
 * Two properties are enforced here and nowhere else, so there is one place to
 * read when asking "what can this touch?":
 *
 * 1. **A handle only ever reaches its own directory.** That is the browser's
 *    guarantee, not ours, and it is the outer wall. The handle is never passed
 *    to anything, never stored in the document, and never reconstructed.
 * 2. **Every name is checked before it is used.** Names from the model go
 *    through `logic/paths`, and a path is never assembled from segments: the
 *    write is a single `getFileHandle(name)` on the granted directory.
 *
 * There is no function here that takes a path. That is on purpose.
 */

export interface ReadEntry {
  /** Path relative to the granted directory, always sanitised. */
  path: string
  name: string
  kind: FileKind
  sizeBytes: number
  text: string
  truncated: boolean
}

export interface ReadResult {
  entries: ReadEntry[]
  /** Named by path, because a refused file is identified by where it was. */
  refused: Array<{ name: string; reason: string }>
  truncated: boolean
  /** How many files were looked at, including the ones refused. */
  seen: number
}

export interface WritePolicy {
  /**
   * What to do when a file with that name already exists.
   *
   * This is the setting the user asked to own, and it is the only thing standing
   * between a rerun and a folder full of overwritten work, so it lives in the
   * node and is stated on the face of it.
   */
  onExisting: 'rename' | 'overwrite' | 'skip'
}

export interface WriteOutcome {
  status: 'written' | 'skipped' | 'renamed' | 'failed'
  name: string
  bytes: number
  reason?: string
  /**
   * What was there before, so the write can be undone. The document's own undo
   * cannot do this: it puts nodes back, it cannot put a file on disk back.
   */
  undo: UndoEntry
}

export interface UndoEntry {
  path: string
  existed: boolean
  previousText: string | null
  previousSize: number | null
}

const EMPTY_UNDO: UndoEntry = { path: '', existed: false, previousText: null, previousSize: null }

/** True when this browser can be given a directory at all. */
export { supportsDirectories }

/**
 * Asks the user for a directory. Only callable from a click, by design: the
 * browser requires a gesture and there is no honest way around it.
 */
export async function chooseDirectory(): Promise<{
  handle: FileSystemDirectoryHandle
  path: string
} | null> {
  if (!supportsDirectories()) return null
  const picker = (globalThis as { showDirectoryPicker?: (options?: unknown) => Promise<FileSystemDirectoryHandle> })
    .showDirectoryPicker
  if (!picker) return null
  try {
    const handle = await picker({ mode: 'readwrite' })
    return { handle, path: handle.name }
  } catch {
    // The user dismissed the picker. Normal, not an error.
    return null
  }
}

/**
 * Grants a directory to a node, or explains why it could not.
 *
 * The save can fail, and a failure here is the worst kind: the user has just
 * clicked a button that says "grant", nothing appears to happen, and the only
 * sign is a Brain run that later does nothing for no visible reason. So the
 * reason comes back instead of being thrown away.
 */
export async function attachDirectory(
  nodeId: string,
): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  const chosen = await chooseDirectory()
  if (!chosen) return { ok: false, reason: 'No folder was chosen.' }
  try {
    await saveDirectory(nodeId, chosen.handle, chosen.path)
    return { ok: true, path: chosen.path }
  } catch (error: unknown) {
    // Only the first line of the reason: the browser's own message about a
    // structured-clone failure is a paragraph of internals that tells a person
    // nothing they can act on.
    const detail = error instanceof Error ? error.message.split('\n')[0]?.trim() ?? '' : ''
    return {
      ok: false,
      reason: detail
        ? `The browser would not keep access to that folder, so it was not granted. (${detail})`
        : 'The browser would not keep access to that folder, so it was not granted.',
    }
  }
}

export async function directoryOf(nodeId: string): Promise<FileSystemDirectoryHandle | null> {
  const stored = await loadDirectory(nodeId)
  return stored?.handle ?? null
}

export async function detachDirectory(nodeId: string): Promise<void> {
  await forgetDirectory(nodeId)
}

/**
 * Makes sure the handle may be used for writing, asking the browser if needed.
 *
 * Must be called from a user gesture, which is why the Brain's Run button does
 * it: the button press is the gesture, and after this the run proceeds without
 * further prompts.
 */
export async function ensureWritable(
  handle: FileSystemDirectoryHandle,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (await canWrite(handle)) return { ok: true }
  const state = await requestPermission(handle, 'readwrite')
  if (state === 'granted' || state === 'unsupported') return { ok: true }
  return {
    ok: false,
    reason:
      state === 'denied'
        ? 'The browser refused access to this folder. Choose it again to grant it.'
        : 'Access to this folder needs your confirmation. Press Run again and accept the prompt.',
  }
}

export async function ensureReadable(
  handle: FileSystemDirectoryHandle,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (await canRead(handle)) return { ok: true }
  const state = await requestPermission(handle, 'read')
  if (state === 'granted' || state === 'unsupported') return { ok: true }
  return { ok: false, reason: 'The browser refused to read this folder. Choose it again.' }
}

/**
 * Walks a granted directory and reads the text files inside it.
 *
 * Only files this module's own check accepts are read; the rest are reported by
 * name. A file whose path cannot be made safe is refused, not sanitised: a path
 * that looks wrong is a reason to stop, not to fix up.
 */
export async function readDirectory(
  handle: FileSystemDirectoryHandle,
  limits: { maxFiles: number; maxTotalBytes: number },
): Promise<ReadResult> {
  const entries: ReadEntry[] = []
  const refused: Array<{ name: string; reason: string }> = []
  let totalBytes = 0
  let seen = 0
  let truncated = false

  const walk = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
    for await (const [rawName, child] of (
      dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }
    ).entries()) {
      if (seen >= limits.maxFiles) {
        truncated = true
        return
      }
      const relative = safeRelativePath(`${prefix}${rawName}`)
      if (relative === null) {
        refused.push({ name: `${prefix}${rawName}`, reason: 'The path could not be made safe.' })
        continue
      }
      if (child.kind === 'directory') {
        await walk(child as FileSystemDirectoryHandle, `${relative}/`)
        continue
      }
      seen += 1
      const file = await (child as FileSystemFileHandle).getFile()
      const verdict = checkTextFile(relative, file.size)
      if (!verdict.ok) {
        refused.push({ name: relative, reason: verdict.reason })
        continue
      }
      if (totalBytes + file.size > limits.maxTotalBytes) {
        truncated = true
        continue
      }
      const raw = await file.text()
      const text = verdict.kind === 'markup' ? raw : raw
      const cut = text.length > MAX_TEXT_CHARS
      entries.push({
        path: relative,
        name: relative.split('/').pop() ?? relative,
        kind: verdict.kind,
        sizeBytes: file.size,
        text: cut ? text.slice(0, MAX_TEXT_CHARS) : text,
        truncated: cut,
      })
      totalBytes += file.size
    }
  }

  await walk(handle, '')
  return { entries, refused, truncated, seen }
}

/**
 * Reads a granted directory into the same shape the picker used to produce.
 *
 * There used to be two ways to fill a folder node: a one-off copy from
 * `<input webkitdirectory>`, and a granted handle. They produced the same thing
 * by different routes, which meant two buttons and a user who could not tell
 * which one to press — and the copy route is the one that appeared to do nothing.
 * Now the grant is the only route, and this function is the bridge, so the node
 * and every consumer of `FolderResult` stay unchanged.
 */
export async function readGrantedFolder(
  handle: FileSystemDirectoryHandle,
  limits: { maxFiles: number; maxTotalBytes: number },
): Promise<FolderResult> {
  const result = await readDirectory(handle, limits)
  return {
    name: handle.name,
    files: result.entries,
    refused: result.refused,
    totalBytes: result.entries.reduce((sum, entry) => sum + entry.sizeBytes, 0),
    truncated: result.truncated,
  }
}

/** What is currently in the output folder, so collisions can be spotted. */
export async function listNames(handle: FileSystemDirectoryHandle): Promise<Set<string>> {  const names = new Set<string>()
  try {
    for await (const [name, child] of (
      handle as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }
    ).entries()) {
      if (child.kind === 'file') names.add(name)
    }
  } catch {
    // An unreadable folder is treated as empty: the write then simply reports a
    // collision it cannot see, which is safer than pretending it is free.
  }
  return names
}

async function readIfPresent(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<{ text: string | null; size: number | null }> {
  try {
    const handle = await dir.getFileHandle(name)
    const file = await handle.getFile()
    return { text: await file.text(), size: file.size }
  } catch {
    return { text: null, size: null }
  }
}

/**
 * Writes one file, honouring the policy, and records what was there before.
 *
 * The name must already have been through `safeFileName`. It is written with a
 * single `getFileHandle` call on the granted directory, so there is no path to
 * get wrong.
 */
export async function writeTextFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  contents: string,
  policy: WritePolicy,
  taken?: ReadonlySet<string>,
): Promise<WriteOutcome> {
  const existing = await readIfPresent(dir, name)
  const undo: UndoEntry = {
    path: name,
    existed: existing.text !== null,
    previousText: existing.text,
    previousSize: existing.size,
  }
  if (existing.text !== null && policy.onExisting === 'skip') {
    return { status: 'skipped', name, bytes: 0, reason: 'A file with that name is already there.', undo }
  }
  // A rename is needed when the file is already there, and also when the caller
  // says the name is spoken for. Deriving the taken set here rather than
  // requiring it is deliberate: an earlier version renamed only when the caller
  // passed the set, so a `rename` policy with no set overwrote silently, which
  // is the one thing this policy exists to prevent.
  const occupied = taken ?? (await listNames(dir))
  const clashes = existing.text !== null || occupied.has(name)
  const finalName = clashes && policy.onExisting === 'rename' ? nextFreeName(name, occupied) : name
  // A rename writes to a name that did not exist, so its undo must describe an
  // absent file. Reusing the original's `existed` would make the revert write
  // the old contents into the renamed file instead of deleting it, leaving a
  // copy of the previous work behind under a new name.
  const effectiveUndo: UndoEntry =
    finalName === name
      ? undo
      : { path: finalName, existed: false, previousText: null, previousSize: null }
  const handle = await dir.getFileHandle(finalName, { create: true })
  const writable = await handle.createWritable()
  try {
    await writable.write(contents)
    await writable.close()
  } catch (error: unknown) {
    // close() is what commits; a failure before it means nothing was written.
    try {
      await writable.abort?.()
    } catch {
      // Nothing more to do: the file was never committed.
    }
    return {
      status: 'failed',
      name: finalName,
      bytes: 0,
      reason: error instanceof Error ? error.message : 'The write failed.',
      undo: EMPTY_UNDO,
    }
  }
  return {
    status: finalName !== name ? 'renamed' : 'written',
    name: finalName,
    bytes: contents.length,
    undo: effectiveUndo,
  }
}

function nextFreeName(name: string, taken: ReadonlySet<string>): string {
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const extension = dot > 0 ? name.slice(dot) : ''
  for (let index = 1; index < 10_000; index += 1) {
    const candidate = `${stem} (${index})${extension}`
    if (!taken.has(candidate)) return candidate
  }
  return `${stem}-${Date.now()}${extension}`
}

/**
 * Puts back what a write replaced, or removes what it created.
 *
 * This is the reason the Brain keeps its log. The document's undo restores nodes;
 * nothing in a browser can restore a file that was overwritten on disk unless
 * something kept a copy first, and this is that something.
 */
export async function revertWrite(
  dir: FileSystemDirectoryHandle,
  undo: UndoEntry,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (undo.path === '') return { ok: true }
  try {
    if (!undo.existed) {
      await dir.removeEntry(undo.path)
      return { ok: true }
    }
    const handle = await dir.getFileHandle(undo.path, { create: true })
    const writable = await handle.createWritable()
    await writable.write(undo.previousText ?? '')
    await writable.close()
    return { ok: true }
  } catch (error: unknown) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'The file could not be restored.',
    }
  }
}
