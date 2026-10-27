import { NotebookPen } from 'lucide-react'
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
import type { NoteNode as NoteNodeType, NoteNodeData } from '../../types/document'
import { NodeShell } from './NodeShell'

export const NoteNode = memo(function NoteNode({ id, selected }: NodeProps<NoteNodeType>) {
  const hasExplicitSize = useNodeHasExplicitSize(id)
  const data = useNodeData<NoteNodeData>(id, 'note')
  const draft = useNodeDraft(id, data?.text ?? '')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
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
     * era vera per ogni nodo e il nodo non cresceva mai. Ecco il motivo per cui
     * scrivere un prompt lungo non allargava niente.
     */
    if (hasExplicitSize) {
      textarea.style.height = '100%'
      return
    }
    textarea.style.height = '0px'
    textarea.style.height = `${autoFitHeight(textarea.scrollHeight, {
      min: AUTO_FIT.minNoteHeight,
      max: AUTO_FIT.maxNoteHeight,
    })}px`
  }, [draft.value, hasExplicitSize])

  if (!data) return null
  return (
    <NodeShell
      zoomSummary={zoomSummary(data)}
      id={id}
      explicitSize={hasExplicitSize}
      nodeKind="note"
      icon={<NotebookPen size={12} />}
      title="Note"
      selected={selected}
      collapsed={data.collapsed === true}
      collapsedPreview={draft.value}
      className={`note-node note-${data.color ?? 'default'}`}
      footer={<span>Markdown annotation</span>}
    >
      {/*
        Una maniglia in uscita, perche' il testo di una nota e' contesto utilizzabile.

        Senza, una nota era solo un foglio sulla tela: si scriveva qualcosa e non
        poteva arrivare da nessuna parte. Ora va nel contesto di un prompt come
        qualsiasi altro testo, e dentro un gruppo come risposta.
      */}
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        aria-label="Send this note to a prompt as context"
      />
      <textarea
        ref={textareaRef}
        className="node-textarea"
        value={draft.value}
        placeholder="Annotate your graph…"
        aria-label="Note text"
        onFocus={() => useUiStore.getState().setSelectedNode(id)}
        onChange={(event) => draft.setValue(event.currentTarget.value)}
      />
    </NodeShell>
  )
})
