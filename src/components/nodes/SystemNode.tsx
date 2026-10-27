import { Settings2 } from 'lucide-react'
import { memo, useEffect, useRef } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { AUTO_FIT, autoFitHeight } from '../../logic/autoFit'
import { zoomSummary } from '../../logic/zoomSummary'
import {
  useFocusOnCreate,
  useNodeData,
  useNodeDraft,
  useNodeHasExplicitSize,
} from '../../hooks/useNodeData'
import { useUiStore } from '../../store/uiStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import type { SystemNode as SystemNodeType, SystemNodeData } from '../../types/document'
import { NodeShell } from './NodeShell'

export const SystemNode = memo(function SystemNode({
  id,
  selected,
}: NodeProps<SystemNodeType>) {
  const hasExplicitSize = useNodeHasExplicitSize(id)
  const data = useNodeData<SystemNodeData>(id, 'system')
  const draft = useNodeDraft(id, data?.text ?? '')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const usedBy = useWorkspaceStore(
    (state) => state.edges.filter((edge) => edge.kind === 'system' && edge.source === id).length,
  )
  useFocusOnCreate(id)

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    /*
     * Un nodo che l'utente ha ridimensionato possiede la sua disposizione: la
     * casella riempie quello che c'e e scorre, invece di crescere col testo.
     *
     * La decisione viene da `useNodeHasExplicitSize` e non dal `height` di React
     * Flow, che c'e **sempre** perche e la misura: con quello, questa condizione
     * era vera per ogni nodo e la casella non cresceva mai.
     */
    if (hasExplicitSize) {
      textarea.style.height = '100%'
      return
    }
    textarea.style.height = '0px'
    textarea.style.height = `${autoFitHeight(textarea.scrollHeight, {
      min: AUTO_FIT.minSystemHeight,
      max: AUTO_FIT.maxSystemHeight,
    })}px`
  }, [draft.value, hasExplicitSize])

  if (!data) return null
  return (
    <NodeShell
      zoomSummary={zoomSummary(data)}
      id={id}
      explicitSize={hasExplicitSize}
      nodeKind="system"
      icon={<Settings2 size={12} />}
      title={data.title || 'System'}
      subtitle={usedBy === 0 ? 'unused' : undefined}
      selected={selected}
      collapsed={data.collapsed === true}
      collapsedPreview={draft.value}
      className={usedBy === 0 ? 'is-unused' : ''}
      footer={
        <span>
          Used by {usedBy} {usedBy === 1 ? 'prompt' : 'prompts'}
        </span>
      }
    >
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        className="handle-system"
        aria-label="Connect to a prompt system input"
      />
      <textarea
        ref={textareaRef}
        className="node-textarea"
        value={draft.value}
        placeholder="Set instructions for downstream prompts…"
        aria-label="System prompt"
        onFocus={() => useUiStore.getState().setSelectedNode(id)}
        onChange={(event) => draft.setValue(event.currentTarget.value)}
      />
    </NodeShell>
  )
})
