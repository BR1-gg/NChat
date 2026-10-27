import { FileText, FolderOpen, Trash2, Upload } from 'lucide-react'
import { memo, useRef } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { readTextFile } from '../../logic/filetext'
import { formatBytes } from '../../logic/media'
import { estimateTokens } from '../../llm/tokens'
import { zoomSummary } from '../../logic/zoomSummary'
import { useNodeData, useNodeHasExplicitSize } from '../../hooks/useNodeData'
import { useUiStore } from '../../store/uiStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import type { FileNode as FileNodeType, FileNodeData } from '../../types/document'
import { Button, IconButton } from '../common/Button'
import { NodeShell } from './NodeShell'

const FILE_ACCEPT_ATTRIBUTE =
  '.txt,.md,.markdown,.json,.jsonl,.ndjson,.csv,.tsv,.yaml,.yml,.toml,.ini,.cfg,.conf,.xml,.html,.htm,.log,.ts,.tsx,.js,.jsx,.mjs,.cjs,.py,.rb,.go,.rs,.java,.kt,.c,.h,.cpp,.hpp,.cs,.php,.sh,.bash,.ps1,.sql,.css,.scss,.less,.vue,.svelte,.r,.jl,.lua,.swift,.dart,.gradle,.tex,.bib,.srt,.vtt'

/**
 * A text file the model can read.
 *
 * The node says what it cannot do. PDF and Word are refused on the way in with a
 * reason, because a text extractor is not something this app ships and a
 * half-broken one would return confident nonsense. The node also states that the
 * text is a copy: a browser cannot watch a file on disk, so editing the file
 * later changes nothing here.
 */
export const FileNode = memo(function FileNode({
  id,
  selected,
}: NodeProps<FileNodeType>) {
  const hasExplicitSize = useNodeHasExplicitSize(id)
  const data = useNodeData<FileNodeData>(id, 'file')
  const fileRef = useRef<HTMLInputElement>(null)
  const store = useWorkspaceStore.getState()

  if (!data) return null

  const load = async (file: File | undefined): Promise<void> => {
    if (!file) return
    try {
      const read = await readTextFile(file)
      store.updateNodeData(id, {
        name: read.name,
        format: read.kind,
        sizeBytes: read.sizeBytes,
        text: read.text,
        truncated: read.truncated,
        error: undefined,
      })
      if (read.truncated) {
        useUiStore.getState().addToast({
          tone: 'info',
          title: `${read.name} was cut at ${read.text.length.toLocaleString()} characters.`,
          message: 'The node says so, and the model is told the text is incomplete.',
        })
      }
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : 'Unknown error.'
      store.updateNodeData(id, { name: file.name, error: reason })
      useUiStore.getState().addToast({ tone: 'warning', title: `${file.name} was not read.`, message: reason })
    }
  }

  const tokens = estimateTokens(data.text)

  return (
    <NodeShell
      zoomSummary={zoomSummary(data)}
      id={id}
      explicitSize={hasExplicitSize}
      nodeKind="file"
      icon={<FileText size={12} />}
      title={data.title || data.name || 'File'}
      subtitle={
        data.name
          ? `${data.format} · ${formatBytes(data.sizeBytes)} · ~${tokens} tok`
          : 'No file chosen yet'
      }
      selected={selected}
      collapsed={data.collapsed === true}
      collapsedPreview={data.name}
      className="file-node"
      actions={
        <>
          <IconButton label="Choose another file" onClick={() => fileRef.current?.click()}>
            <Upload size={11} />
          </IconButton>
          <IconButton label="Remove the file" danger onClick={() => store.removeNodes([id])}>
            <Trash2 size={11} />
          </IconButton>
        </>
      }
      footer={
        <>
          <span>
            {data.error
              ? 'Not sent to the model'
              : data.truncated
                ? 'Sent truncated, and the model is told'
                : 'Sent as context text'}
          </span>
          <div className="node-footer-actions">
            <Button size="small" onClick={() => fileRef.current?.click()}>
              {data.name ? 'Replace' : 'Choose file'}
            </Button>
          </div>
        </>
      }
    >
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        aria-label="Send this file to a prompt as context"
      />
      <div className="file-body">
        {data.error ? (
          <p className="file-error">
            <strong>{data.name}</strong> was not read.
            <span>{data.error}</span>
          </p>
        ) : data.text ? (
          <>
            <pre className="file-preview">{data.text.slice(0, 4000)}</pre>
            {data.text.length > 4000 ? <p className="file-note">Showing the first 4,000 characters.</p> : null}
            <p className="file-note">
              This is a copy taken when the file was chosen. A browser cannot follow a file
              on disk, so editing it later changes nothing here.
            </p>
          </>
        ) : (
          <div className="file-empty">
            <FolderOpen size={16} />
            <p>Choose a text file to send with a prompt.</p>
            <Button size="small" onClick={() => fileRef.current?.click()}>
              Choose file
            </Button>
          </div>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={FILE_ACCEPT_ATTRIBUTE}
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          void load(file)
        }}
      />
    </NodeShell>
  )
})
