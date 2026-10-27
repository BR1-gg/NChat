import { FolderOpen, RefreshCw, Trash2 } from 'lucide-react'
import { memo, useEffect, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
  attachDirectory,
  directoryOf,
  readGrantedFolder,
} from '../../actions/folderActions'
import { folderBlock } from '../../logic/filetext'
import { formatBytes } from '../../logic/media'
import { estimateTokens } from '../../llm/tokens'
import { zoomSummary } from '../../logic/zoomSummary'
import { useNodeData, useNodeHasExplicitSize } from '../../hooks/useNodeData'
import { supportsDirectories } from '../../persistence/handles'
import { useUiStore } from '../../store/uiStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import type { FolderNode as FolderNodeType, FolderNodeData } from '../../types/document'
import { Button, IconButton } from '../common/Button'
import { NodeShell } from './NodeShell'

/**
 * A real folder on disk, given to the model.
 *
 * There is **one** way to fill this node, and it is a granted directory handle.
 * An earlier version had two: a one-off copy from `<input webkitdirectory>`, and
 * the handle. Two routes produced the same thing, so there were two buttons, and
 * the copy route appeared to do nothing. One route, one button.
 *
 * The handle is also what lets a Brain read the same folder, which is why the
 * grant is not optional decoration: without it the node is a snapshot and the
 * Brain is blind.
 */
export const FolderNode = memo(function FolderNode({
  id,
  selected,
}: NodeProps<FolderNodeType>) {
  const hasExplicitSize = useNodeHasExplicitSize(id)
  const data = useNodeData<FolderNodeData>(id, 'folder')
  const store = useWorkspaceStore.getState()
  const edges = useWorkspaceStore((state) => state.edges)
  const [granted, setGranted] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)

  const reads = edges.some((edge) => edge.source === id && edge.targetHandle === 'in')
  const writes = edges.some((edge) => edge.target === id && edge.targetHandle === 'in')

  useEffect(() => {
    let live = true
    void directoryOf(id).then((handle) => {
      if (!live) return
      setGranted(handle ? handle.name : null)
      setReady(true)
    })
    return () => {
      live = false
    }
  }, [id])

  if (!data) return null

  /** Fills the node from the folder that is already granted, if any. */
  const refresh = async (): Promise<void> => {
    setBusy(true)
    try {
      const handle = await directoryOf(id)
      if (!handle) {
        store.updateNodeData(id, {
          error: 'This browser no longer grants access to that folder. Choose it again.',
        })
        setGranted(null)
        return
      }
      const folder = await readGrantedFolder(handle, {
        maxFiles: 200,
        maxTotalBytes: 8 * 1024 * 1024,
      })
      store.updateNodeData(id, {
        name: folder.name,
        fileCount: folder.files.length,
        totalBytes: folder.totalBytes,
        text: folderBlock(folder),
        truncated: folder.truncated,
        refused: folder.refused,
        error: undefined,
      })
      const ui = useUiStore.getState()
      if (folder.files.length === 0) {
        ui.addToast({
          tone: 'warning',
          title: `Nothing readable in ${folder.name}.`,
          message: folder.refused[0]?.reason ?? 'The folder holds no text files this app can read.',
        })
      } else {
        ui.addToast({
          tone: folder.refused.length > 0 || folder.truncated ? 'info' : 'success',
          title: `${folder.files.length} file${folder.files.length === 1 ? '' : 's'} read from ${folder.name}.`,
          ...(folder.refused.length > 0
            ? { message: `${folder.refused.length} skipped, listed on the node.` }
            : {}),
        })
      }
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : 'Unknown error.'
      store.updateNodeData(id, { error: reason })
      useUiStore.getState().addToast({ tone: 'error', title: 'The folder could not be read.', message: reason })
    } finally {
      setBusy(false)
    }
  }

  /**
   * The one action of this node: pick a folder, or read the picked one again.
   *
   * The pick needs a click on a system dialog, which is why it is a button and
   * not something a run does on its own. A refusal says so on the node, because a
   * button that silently does nothing is the failure mode worth designing away.
   */
  const choose = async (): Promise<void> => {
    if (granted) {
      await refresh()
      return
    }
    if (!supportsDirectories()) {
      const reason =
        'This browser cannot be given a folder. NCHAT needs the File System Access API, which Edge, Chrome and other Chromium browsers have.'
      store.updateNodeData(id, { error: reason })
      useUiStore.getState().addToast({ tone: 'warning', title: 'Not supported here.', message: reason })
      return
    }
    setBusy(true)
    const result = await attachDirectory(id)
    setBusy(false)
    if (!result.ok) {
      if (result.reason !== 'No folder was chosen.') {
        store.updateNodeData(id, { error: result.reason })
        useUiStore
          .getState()
          .addToast({ tone: 'warning', title: 'The folder was not granted.', message: result.reason })
      }
      return
    }
    setGranted(result.path)
    store.updateNodeData(id, { name: result.path, error: undefined })
    await refresh()
  }

  const tokens = estimateTokens(data.text)

  return (
    <NodeShell
      zoomSummary={zoomSummary(data)}
      id={id}
      explicitSize={hasExplicitSize}
      nodeKind="folder"
      icon={<FolderOpen size={12} />}
      title={data.title || data.name || 'Folder'}
      subtitle={
        ready && !granted
          ? 'No folder chosen yet'
          : data.fileCount > 0
            ? `${data.fileCount} file${data.fileCount === 1 ? '' : 's'} · ${formatBytes(data.totalBytes)} · ~${tokens} tok`
            : granted
              ? 'Folder granted, nothing readable inside'
              : 'No folder chosen yet'
      }
      selected={selected}
      collapsed={data.collapsed === true}
      collapsedPreview={data.name}
      className="folder-node"
      actions={
        <>
          <IconButton
            label={granted ? 'Read the folder again' : 'Choose a folder'}
            disabled={busy}
            onClick={() => void choose()}
          >
            {granted ? <RefreshCw size={11} /> : <FolderOpen size={11} />}
          </IconButton>
          <IconButton label="Remove the folder" danger onClick={() => store.removeNodes([id])}>
            <Trash2 size={11} />
          </IconButton>
        </>
      }
      footer={
        <>
          {/*
            What this node can do is the thing worth stating: whether the folder
            is really reachable, and whether a Brain reads it or writes into it.
          */}
          <span>
            {data.error
              ? data.error
              : granted && reads && writes
                ? 'A Brain reads and writes here'
                : granted && reads
                  ? 'A Brain reads this folder'
                  : granted && writes
                    ? 'A Brain writes here'
                    : granted
                      ? 'Reachable, and sent as context text'
                      : ready
                        ? 'Choose a folder to fill this node'
                        : 'Checking the grant'}
          </span>
        </>
      }
    >
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        className="handle-flow"
        aria-label="Send this folder to a prompt as context, or to a Brain to work through"
      />
      {/*
        Always present, on the left. The only thing the graph allows to arrive
        here is a Brain, and anything else is refused with a message, so a
        permanent handle cannot be misused: it can only be wired one way.
      */}
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        className="handle-flow"
        aria-label="A Brain writes its results into this folder"
      />
      <div className="file-body">
        {data.error ? (
          <p className="file-error">
            <strong>{data.name || 'Questa cartella'}</strong>
            <span>{data.error}</span>
          </p>
        ) : data.text ? (
          <>
            <pre className="file-preview">{data.text.slice(0, 4000)}</pre>
            {data.text.length > 4000 ? <p className="file-note">Showing the first 4,000 characters.</p> : null}
            {data.refused.length > 0 ? (
              <div className="folder-refused">
                <strong>Not read ({data.refused.length})</strong>
                <ul>
                  {data.refused.slice(0, 6).map((entry) => (
                    <li key={entry.name} title={entry.reason}>
                      {entry.name}
                    </li>
                  ))}
                </ul>
                {data.refused.length > 6 ? <p>+{data.refused.length - 6} more</p> : null}
              </div>
            ) : null}
            <p className="file-note">
              Read from the folder you granted. Re-read it with the button above after changing
              something on disk.
            </p>
          </>
        ) : (
          <div className="file-empty">
            <FolderOpen size={16} />
            <p>
              Choose a folder. Its text files are read and sent with the prompt, and a Brain
              connected to this node reads the same folder.
            </p>
            <Button size="small" onClick={() => void choose()} disabled={busy}>
              Choose folder
            </Button>
          </div>
        )}
      </div>
      <span className="visually-hidden">
        {granted ? `Folder ${granted}` : 'No folder chosen'}, {data.fileCount} files read
      </span>
    </NodeShell>
  )
})
