import { db } from './db'

/**
 * Storing and recovering a directory the user granted.
 *
 * The rule that shapes this file: **a handle is never written into the
 * document.** The document is JSON, a handle is a live capability, and
 * `JSON.stringify` reduces it to `{}`. So the grant lives in its own table and
 * the document keeps only the path as text, which is what export carries and what
 * a reader on another machine can actually understand.
 *
 * Losing a grant is not an error to hide. A grant can be revoked by the browser,
 * expire when the profile is cleared, or simply not exist on another machine
 * after an import, and every one of those cases ends the same way: the node says
 * the folder needs to be chosen again and offers the button that does it.
 */

export interface StoredDirectory {
  handle: FileSystemDirectoryHandle
  path: string
  grantedAt: number
}

export async function saveDirectory(
  nodeId: string,
  handle: FileSystemDirectoryHandle,
  path: string,
): Promise<void> {
  await db.directories.put({ nodeId, handle, path, grantedAt: Date.now() })
}

export async function loadDirectory(nodeId: string): Promise<StoredDirectory | null> {
  try {
    const row = await db.directories.get(nodeId)
    if (!row?.handle || !isDirectoryHandle(row.handle)) return null
    return { handle: row.handle, path: row.path, grantedAt: row.grantedAt }
  } catch {
    // A handle that cannot be deserialised is treated as no handle at all.
    return null
  }
}

/**
 * Whether a stored value is a handle this code can actually use.
 *
 * The test looks for a method every `FileSystemDirectoryHandle` has, and not for
 * the permission ones: those are missing on the older handle model, and rejecting
 * on them would throw away grants that still work. What this catches is a value
 * that came back as plain data, which is exactly what a handle wrongly put in the
 * document looks like after a round trip.
 */
function isDirectoryHandle(value: unknown): value is FileSystemDirectoryHandle {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { kind?: string; entries?: unknown }
  if (candidate.kind !== 'directory') return false
  return typeof candidate.entries === 'function'
}

export async function forgetDirectory(nodeId: string): Promise<void> {
  await db.directories.delete(nodeId)
}

export type PermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported'

/** Whether this browser can be given a directory at all. */
export function supportsDirectories(): boolean {
  return typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
}

/**
 * The current permission on a handle.
 *
 * `prompt` is the interesting one: the grant exists but the browser wants a user
 * gesture before using it again. That is why the Brain's Run button re-requests
 * it, being itself a click.
 */
export async function permissionOf(
  handle: FileSystemDirectoryHandle,
  mode: 'read' | 'readwrite' = 'read',
): Promise<PermissionState> {
  const candidate = handle as FileSystemDirectoryHandle & {
    queryPermission?: (descriptor: { mode: string }) => Promise<PermissionState>
  }
  if (typeof candidate.queryPermission !== 'function') return 'unsupported'
  try {
    return await candidate.queryPermission({ mode })
  } catch {
    return 'denied'
  }
}

/**
 * Asks for the permission, which only works inside a user gesture.
 *
 * Returns the resulting state instead of throwing, because "the user dismissed
 * the prompt" is a normal outcome and not something to throw about.
 */
export async function requestPermission(
  handle: FileSystemDirectoryHandle,
  mode: 'read' | 'readwrite' = 'read',
): Promise<PermissionState> {
  const candidate = handle as FileSystemDirectoryHandle & {
    requestPermission?: (descriptor: { mode: string }) => Promise<PermissionState>
  }
  if (typeof candidate.requestPermission !== 'function') return 'unsupported'
  try {
    return await candidate.requestPermission({ mode })
  } catch {
    return 'denied'
  }
}

/** True when the handle can be used for reading right now. */
export async function canRead(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const state = await permissionOf(handle, 'read')
  return state === 'granted' || state === 'unsupported'
}

/** True when the handle can be used for writing right now. */
export async function canWrite(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const state = await permissionOf(handle, 'readwrite')
  return state === 'granted' || state === 'unsupported'
}
