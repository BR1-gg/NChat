import { Download, FileOutput, RefreshCw, Sparkles, X } from 'lucide-react'
import { memo, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { exportOutputMarkdown, refreshOutputs, synthesizeOutput } from '../../actions/setActions'
import { estimateTokens } from '../../llm/tokens'
import { useNodeData, useNodeStoredSize } from '../../hooks/useNodeData'
import { useWorkspaceStore } from '../../store/workspaceStore'
import type { OutputNode as OutputNodeType, OutputNodeData } from '../../types/document'
import { copyToClipboard } from '../../utils/clipboard'
import { Button, IconButton } from '../common/Button'
import { MarkdownView } from '../common/MarkdownView'

/**
 * A group, drawn as the frame around its answers.
 *
 * There is no card: the dashed rectangle you drew around the selection *is* the
 * group, and the aggregated text is what that rectangle carries. The node exists
 * only because React Flow needs one to own a connection handle, and its position
 * and size are kept on the answers by `computeGroupFrame`.
 *
 * The text is one click away on the label, so the canvas is not covered by a
 * panel nobody asked for.
 */
export const OutputNode = memo(function OutputNode({
  id,
  selected,
}: NodeProps<OutputNodeType>) {
  const data = useNodeData<OutputNodeData>(id, 'output')
  const [open, setOpen] = useState(false)
  /*
   * La misura viene dal documento anche qui, per lo stesso motivo del gruppo solo
   * visivo: il riquadro e' grande quanto i nodi che circonda, e quella e' una misura
   * **calcolata**. React Flow misura invece il contenuto e usa la sua, quindi prendere
   * `width` dalle props faceva disegnare il riquadro a una misura e il calcolo ne
   * richiedeva un'altra — la cornice respirava. Vedi `useNodeStoredSize`.
   */
  const { width, height } = useNodeStoredSize(id)
  // Narrow selector: only the member count, so unrelated edits do not re-render.
  const memberCount = useWorkspaceStore((state) => {
    const node = state.nodes.find((candidate) => candidate.id === id)
    return node?.data.kind === 'output' ? (node.data.sourceNodeIds?.length ?? 0) : 0
  })

  if (!data) return null
  const grouped = memberCount > 0
  const synthesizing = data.synthesis?.status === 'streaming'
  const text = data.synthesis?.status === 'done' ? data.synthesis.text : data.text

  // The group frame is left sharp on purpose: it is a dashed outline drawn
  // **around** other nodes, so blurring it would blur the answers it encloses,
  // which already show their own summary. There is nothing of its own to lose.
  return (
    <section
      className={`group-frame ${selected ? 'is-selected' : ''} ${grouped ? '' : 'is-empty'}`}
      style={{ width: width ?? undefined, height: height ?? undefined }}
      aria-label={data.title || 'Group'}
    >
      <Handle
        type="source"
        position={Position.Right}
        id="context"
        className="handle-context"
        aria-label="Send the grouped answers to a prompt"
      />
      {/* The bar is the group's handle: dragging it moves every answer inside.
          It must not be `nodrag`, or the group could only be grabbed by a
          1.5px border. The click on the label still works, because React Flow
          only treats it as a drag once the pointer actually moves. */}
      <div className="group-frame-bar">
        <button
          type="button"
          className="group-frame-label nodrag"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          title={grouped ? 'Show the grouped answers' : 'This group has no answers'}
        >
          <FileOutput size={11} />
          <span>{grouped ? `${memberCount} answers` : 'Empty group'}</span>
          {data.text ? <span className="group-frame-tokens">~{estimateTokens(text)} tok</span> : null}
        </button>
        <span className="group-frame-actions nodrag">
          {grouped ? (
            <>
              <IconButton label="Recompute the grouped text" onClick={() => refreshOutputs()}>
                <RefreshCw size={10} />
              </IconButton>
              <IconButton
                label="Ask the model for one merged answer"
                disabled={synthesizing || !text.trim()}
                onClick={() => void synthesizeOutput(id)}
              >
                <Sparkles size={10} />
              </IconButton>
            </>
          ) : null}
          <IconButton
            label="Remove the group"
            danger
            onClick={() => useWorkspaceStore.getState().removeNodes([id])}
          >
            <X size={10} />
          </IconButton>
        </span>
      </div>

      {open ? (
        <div className="group-frame-panel nodrag">
          <div className="group-frame-panel-body">
            {text ? <MarkdownView text={text} /> : <p className="empty-usage">No answers yet.</p>}
          </div>
          <div className="group-frame-panel-actions">
            <Button size="small" onClick={() => void copyToClipboard(text)} disabled={!text}>
              Copy
            </Button>
            <Button
              size="small"
              icon={<Download size={10} />}
              onClick={() => exportOutputMarkdown(id, text)}
              disabled={!text}
            >
              Export .md
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  )
})
