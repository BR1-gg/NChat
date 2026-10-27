import { nanoid } from 'nanoid'
import { fileBlock, folderBlock, readFolder, readTextFile } from '../logic/filetext'
import { DOC_VERSION, type AppNode } from '../types/document'
import { getActiveWorkspaceStore, type WorkspaceStoreApi } from '../store/workspaceStore'
import { useUiStore } from '../store/uiStore'
import type { XYPosition } from '@xyflow/react'

/**
 * Dropping a file or a folder on the canvas.
 *
 * A dropped `.json` is ambiguous: it can be a NCHAT export, which should
 * replace the workspace, or a data file, which should become a node. Guessing by
 * extension would make it impossible to feed a JSON file to the model at all, so
 * the file is sniffed and only a real document is treated as an import.
 */

/** True when the file is a NCHAT export rather than some other JSON. */
export async function isAppExport(file: File): Promise<boolean> {
  if (!file.name.toLowerCase().endsWith('.json')) return false
  if (file.size > 64 * 1024 * 1024) return false
  try {
    const parsed: unknown = JSON.parse(await file.text())
    if (typeof parsed !== 'object' || parsed === null) return false
    const candidate = parsed as Record<string, unknown>
    return (
      candidate.docVersion === DOC_VERSION &&
      Array.isArray(candidate.nodes) &&
      Array.isArray(candidate.edges)
    )
  } catch {
    return false
  }
}

export async function createFileNodeFromFile(
  file: File,
  position: XYPosition,
  store: WorkspaceStoreApi = getActiveWorkspaceStore(),
): Promise<string | null> {
  try {
    const read = await readTextFile(file)
    const id = store.getState().addNode('file', position, {
      name: read.name,
      format: read.kind,
      sizeBytes: read.sizeBytes,
      text: read.text,
      truncated: read.truncated,
    })
    if (read.truncated) {
      useUiStore.getState().addToast({
        tone: 'info',
        title: `${read.name} was cut at ${read.text.length.toLocaleString()} characters.`,
        message: 'The node says so, and the model is told the text is incomplete.',
      })
    }
    return id
  } catch (error: unknown) {
    // The node is still created, holding the reason. A refusal with no trace
    // would look like the drop did nothing.
    const reason = error instanceof Error ? error.message : 'Unknown error.'
    store.getState().addNode('file', position, { name: file.name, error: reason })
    useUiStore.getState().addToast({ tone: 'warning', title: `${file.name} was not read.`, message: reason })
    return null
  }
}

export async function createFolderNodeFromFiles(
  files: File[],
  folderName: string,
  position: XYPosition,
  store: WorkspaceStoreApi = getActiveWorkspaceStore(),
): Promise<string | null> {
  const folder = await readFolder(files, folderName)
  const id = store.getState().addNode('folder', position, {
    name: folder.name,
    fileCount: folder.files.length,
    totalBytes: folder.totalBytes,
    text: folderBlock(folder),
    truncated: folder.truncated,
    refused: folder.refused,
  })
  const ui = useUiStore.getState()
  if (folder.files.length === 0) {
    ui.addToast({
      tone: 'warning',
      title: `Nothing readable in ${folder.name}.`,
      message: folder.refused[0]?.reason,
    })
  } else if (folder.refused.length > 0 || folder.truncated) {
    ui.addToast({
      tone: 'info',
      title: `${folder.files.length} file${folder.files.length === 1 ? '' : 's'} read from ${folder.name}.`,
      message: `${folder.refused.length} skipped. The node lists them by name.`,
    })
  }
  return id
}

/**
 * Flattens a dropped directory into a file list.
 *
 * `DataTransfer.files` is empty for a folder, and the only way in is the
 * non-standard `webkitGetAsEntry`. The path is rebuilt here because the entries
 * carry it, and a folder whose files arrive without their relative paths would
 * lose the subdirectory structure the model needs to make sense of them.
 */
export async function readDroppedDirectory(entry: FileSystemDirectoryEntry): Promise<File[]> {
  const out: File[] = []
  const walk = async (dir: FileSystemDirectoryEntry, prefix: string): Promise<void> => {
    const reader = dir.createReader()
    // readEntries returns at most 100 at a time and must be called again.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve) => {
        reader.readEntries(
          (entries) => resolve(entries),
          () => resolve([]),
        )
      })
      if (batch.length === 0) break
      for (const child of batch) {
        if (child.isFile) {
          const file = await new Promise<File | null>((resolve) => {
            ;(child as FileSystemFileEntry).file(resolve, () => resolve(null))
          })
          if (!file) continue
          Object.defineProperty(file, 'webkitRelativePath', {
            value: `${prefix}${file.name}`,
            configurable: true,
          })
          out.push(file)
        } else if (child.isDirectory) {
          await walk(child as FileSystemDirectoryEntry, `${prefix}${child.name}/`)
        }
      }
    }
  }
  await walk(entry, `${entry.name}/`)
  return out
}

export function droppedEntryOf(items: DataTransferItemList): FileSystemEntry | null {
  for (const item of Array.from(items)) {
    if (item.kind !== 'file') continue
    const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null
    if (entry) return entry
  }
  return null
}

/** Re-exported so the canvas does not need to know where the block comes from. */
export { fileBlock }
export type { AppNode }
export const newFolderNodeId = (): string => nanoid(12)
