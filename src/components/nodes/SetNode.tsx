import { Layers3 } from 'lucide-react'
import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useNodeData, useNodeHasExplicitSize } from '../../hooks/useNodeData'
import { aggregateText } from '../../actions/setActions'
import { getActiveWorkspaceStore, useWorkspace } from '../../store/workspaceStore'
import type { SetNode as SetNodeType, SetNodeData } from '../../types/document'
import { workspaceDocumentFromState } from '../../store/workspaceStore'
import { Button } from '../common/Button'
import { NodeShell } from './NodeShell'

/**
 * Legacy renderer for documents saved before grouping moved to the output
 * node. It is not in the palette and cannot be created any more; it only keeps
 * older workspaces readable, and offers a one-click conversion.
 */
export const SetNode = memo(function SetNode({
  id,
  selected,
}: NodeProps<SetNodeType>) {
  const hasExplicitSize = useNodeHasExplicitSize(id)
  const data = useNodeData<SetNodeData>(id, 'set')
  const allNodes = useWorkspace((state) => state.nodes)
  if (!data) return null
  const document = workspaceDocumentFromState(getActiveWorkspaceStore().getState())
  let text = ''
  try {
    text = aggregateText(document, data.memberIds, data.format, data.includePromptText)
  } catch {
    text = ''
  }
  return (
    <NodeShell
      id={id}
      explicitSize={hasExplicitSize}
      nodeKind="set"
      icon={<Layers3 size={12} />}
      title={data.title || 'Set (legacy)'}
      subtitle={`${data.memberIds.length} members`}
      selected={selected}
      collapsed={data.collapsed === true}
      collapsedPreview={text}
      className="set-node legacy-set-node"
    >
      <Handle type="source" position={Position.Right} id="out" aria-label="Aggregated results" />
      <div className="response-body">
        {text ? <pre className="legacy-set-text">{text}</pre> : <span className="empty-usage">No answers in this group.</span>}
      </div>
      <div className="node-actions-row">
        <Button
          size="small"
          onClick={() => {
            const store = getActiveWorkspaceStore()
            store.getState().addNode(
              'output',
              { x: (store.getState().nodes.find((n) => n.id === id)?.position.x ?? 0) + 460, y: store.getState().nodes.find((n) => n.id === id)?.position.y ?? 0 },
              { title: data.title || 'Output', sourceNodeIds: data.memberIds, format: data.format, includePromptText: data.includePromptText, text },
            )
            store.getState().removeNodes([id])
          }}
        >
          Convert to output
        </Button>
      </div>
      <span className="visually-hidden">{allNodes.length} nodes in workspace</span>
    </NodeShell>
  )
})
